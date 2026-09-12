import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { bookUcpa, cancelUcpa, reconcileUcpaBooking, showUcpaReservation, ucpaActionStore, ucpaBookingKey, UCPA_CREATE_URL, UCPA_CANCEL_URL } from '../lib/ucpa-actions.js'
import { createUcpaAccountClient, UCPA_API, normalizeUcpaReservation } from '../lib/ucpa-account.js'

const customer = 'customer_fixture'
const contact = 'horanet_id_fixture'
const date = '2099-09-21'
const start = Date.parse(`${date}T05:00:00Z`) / 1000
const request = { date, startTime: '07:00', durationsMinutes: [60], courtEnvironment: ['indoor'], maxPricePerHourEUR: 38 }
const raw = id => ({ id, name: 'Terrain 6 Padel HC', isTerrainSession: true, start_time: start, end_time: start + 3599, max_participant: 4, captain: { uuid: 'list_contact_reference', horanet_id: contact }, sessionBooking: { price: 950, offerFilliere: 'Padel', haveSubscription: false } })
const reservation = { ...normalizeUcpaReservation(raw('123'), customer, { contactId: contact }), canCancelPart: true }
const offer = { ...request, sessionId: '123', court: reservation.court, durationMinutes: 60, participationEUR: 9.5, totalEUR: 38, status: 'checkout_ready' }
const reply = body => ({ ok: () => true, status: () => 200, json: async () => body })
const directory = t => {
  const path = mkdtempSync(join(tmpdir(), 'ucpa-actions-'))
  t.after(() => rmSync(path, { recursive: true, force: true }))
  return path
}

test('UCPA account paginates all sessions, binds account identity, and excludes other sports without losing pagination', async () => {
  const pages = []
  let wrongIdentity = false
  let missingSport = false
  const context = { request: {
    get: async url => reply(url.endsWith('/site') ? { success: true, data: { workspace: 'alpha_hp', code_site_comptage: '300001419', is_internal_session: false } } : { success: true, data: { uuid: wrongIdentity ? 'customer_other' : customer, horanet_id: contact, email: 'fixture@example.test' } }),
    post: async (url, { data }) => {
      assert.equal(url, `${UCPA_API}/amplify/kala/reservedSession`)
      assert.deepEqual(data.contacts, [contact])
      pages.push(data.page)
      const sessions = data.page === 1 ? ['1', '2', '3', '4', '5'].map(raw) : [raw('6')]
      if (data.page === 1) sessions[0].sessionBooking.offerFilliere = 'Squash'
      if (missingSport) delete sessions[0].sessionBooking.offerFilliere
      return reply({ success: true, data: [{ uuid: contact, total: 6, sessions }] })
    },
  } }
  const client = await createUcpaAccountClient(context)
  const rows = await client.list()
  assert.deepEqual(pages, [1, 2])
  assert.deepEqual(rows.map(r => r.id), ['2', '3', '4', '5', '6'])
  assert.equal(rows[0].totalEUR, 38)
  assert.equal(rows[0].isCaptain, true)
  assert.equal(normalizeUcpaReservation(raw('123'), 'customer_other', { contactId: 'horanet_id_other' }).isCaptain, false)
  missingSport = true
  await assert.rejects(client.list(), /partial list/)
  wrongIdentity = true
  await assert.rejects(client.list(), /identity changed/)
})

test('UCPA account accepts the observed empty response but rejects duplicate/incomplete pages', async () => {
  let mode = 'empty'
  const context = { request: {
    get: async url => reply({ success: true, data: url.endsWith('/site') ? { workspace: 'alpha_hp', code_site_comptage: '300001419', is_internal_session: false } : { uuid: customer, horanet_id: contact, email: 'fixture@example.test' } }),
    post: async () => reply({ success: true, data: [{ uuid: contact, ...(mode === 'empty' ? { sessions: [] } : { total: 2, sessions: mode === 'duplicate' ? [raw('1')] : [] }) }] }),
  } }
  const client = await createUcpaAccountClient(context)
  assert.deepEqual(await client.list(), [])
  mode = 'duplicate'
  await assert.rejects(client.list(), /duplicates/)
  mode = 'incomplete'
  await assert.rejects(client.list(), /incomplete/)
})

const withBrowser = async (t, run, { wrongPrice = false, lostResponse = false, paidCancellation = false } = {}) => {
  const browser = await chromium.launch()
  const store = ucpaActionStore(directory(t))
  try {
    const context = await browser.newContext({ serviceWorkers: 'block' })
    const state = { rows: [], bookCalls: 0, cancelCalls: 0, previewCalls: 0 }
    const client = { customerUuid: customer, assertIdentity: async () => {}, list: async () => state.rows, detail: async () => reservation, detailUrl: id => `https://www.ucpa.com/sport-station/espacepersonnel/paris-19/scheduled-reservations/${id}/${customer}` }
    const formatted = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris' }).format(new Date(`${date}T12:00:00Z`))
    const summary = `<p>Capitaine</p><p>Non abonné(e)</p><p>${formatted}</p><p>07:00 à 08:00</p><p>${reservation.court}</p><p>Padel</p><p>Ma participation: 9.50 €</p><p>Places réservées</p><p>1 / 4</p><p>Garantie du Capitaine</p><p>Règlement le jour J</p>`
    const payload = { body: { sessionId: '123', isInternalSession: false, haveSubscription: false, reservationInfo: { isPlaying: true }, details: { quantity: 1, price: wrongPrice ? 1000 : 950, offerFilliere: 'Padel' }, options: [] } }
    const payment = `${summary}<p>Carte enregistrée</p><p>Carte Bancaire XXXX 0000</p><input id="cgi" type="checkbox"><button id="book">Réserver</button><script>document.querySelector('#book').onclick=()=>fetch(${JSON.stringify(UCPA_CREATE_URL)},{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(${JSON.stringify(payload)})}).catch(()=>{});</script>`
    const terms = paidCancellation ? 'En confirmant, 38 € restent à payer.' : 'Les autres joueurs seront informés. En confirmant l’annulation, tu n’auras rien à payer, les autres joueurs non plus.'
    const dialog = `<p>Tu es sur le point d'annuler la partie.</p><p>${terms}</p><button>Garder ma partie</button><button id="confirm">Confirmer l'annulation</button>`
    const detail = `<p>${reservation.court}</p><button id="cancel">Annuler la partie</button><div id="dialog"></div><script>document.querySelector('#cancel').onclick=()=>{document.querySelector('#dialog').innerHTML=${JSON.stringify(dialog)};document.querySelector('#confirm').onclick=()=>fetch(${JSON.stringify(UCPA_CANCEL_URL)},{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sessionId:'123',uuid:${JSON.stringify(customer)}})}).catch(()=>{});};</script>`
    // Catch ALL traffic in tests. The guard must fall back here, never hit UCPA.
    await context.route('**/*', async route => {
      const url = route.request().url()
      if (url === UCPA_CREATE_URL) {
        state.bookCalls++
        state.rows = [reservation]
        if (lostResponse) return route.abort()
        return route.fulfill({ json: { success: true } })
      }
      if (url === UCPA_CANCEL_URL) {
        state.cancelCalls++
        state.rows = []
        if (lostResponse) return route.abort()
        return route.fulfill({ json: { success: true } })
      }
      return route.fulfill({ contentType: 'text/html; charset=utf-8', body: url.endsWith('/payment') ? payment : detail })
    })
    const preview = async page => {
      state.previewCalls++
      page.setDefaultTimeout(800)
      await page.goto('https://www.ucpa.com/loisirs-reservation/reservation-terrain/payment')
      return offer
    }
    await run({ session: { context }, client, store, state, preview })
  } finally { await browser.close() }
}

test('real browser book clicks once, checks whole-court price and confirms through account; repeated command never resubmits', t => withBrowser(t, async ({ session, client, store, state, preview }) => {
  const result = await bookUcpa(session, client, store, request, { confirm: true, preview })
  assert.equal(result.status, 'booked')
  assert.equal(state.bookCalls, 1)
  assert.equal((await bookUcpa(session, client, store, request, { confirm: true, preview })).status, 'booked')
  assert.equal(state.bookCalls, 1)
  assert.equal(state.previewCalls, 1)
}))

test('book preview never checks terms or submits and an existing slot prevents a new attempt', t => withBrowser(t, async ({ session, client, store, state, preview }) => {
  assert.equal((await bookUcpa(session, client, store, request, { preview })).status, 'checkout_ready')
  assert.equal(state.bookCalls, 0)
  state.rows = [reservation]
  assert.equal((await bookUcpa(session, client, store, request, { confirm: true, preview })).status, 'already_reserved')
  assert.equal(state.bookCalls, 0)
}))

test('guard rejects a changed amount before the booking endpoint and preserves uncertainty', t => withBrowser(t, async ({ session, client, store, state, preview }) => {
  const result = await bookUcpa(session, client, store, request, { confirm: true, preview })
  assert.equal(result.status, 'booking_unverified')
  assert.equal(state.bookCalls, 0)
  assert.equal((await bookUcpa(session, client, store, request, { confirm: true, preview })).status, 'booking_unverified')
  assert.equal(state.previewCalls, 1)
}, { wrongPrice: true }))

test('lost booking response is reconciled from account without a second submission', t => withBrowser(t, async ({ session, client, store, state, preview }) => {
  assert.equal((await bookUcpa(session, client, store, request, { confirm: true, preview })).status, 'booked')
  assert.equal(state.bookCalls, 1)
}, { lostResponse: true }))

test('cancellation requires a matching preview, cancels the whole party once and verifies response plus absence', t => withBrowser(t, async ({ session, client, store, state }) => {
  state.rows = [reservation]
  const quote = await cancelUcpa(session, client, store, '123')
  assert.equal(quote.feeEUR, 0)
  assert.equal(state.cancelCalls, 0)
  await assert.rejects(cancelUcpa(session, client, store, '123', { confirm: true, expectedVersion: 'bad' }), /terms changed/)
  assert.equal(state.cancelCalls, 0)
  const result = await cancelUcpa(session, client, store, '123', { confirm: true, expectedVersion: quote.version })
  assert.equal(result.status, 'cancelled')
  assert.equal(result.verified, true)
  assert.equal(state.cancelCalls, 1)
  assert.equal((await cancelUcpa(session, client, store, '123', { confirm: true, expectedVersion: quote.version })).status, 'cancelled')
  assert.equal((await showUcpaReservation(client, store, '123')).status, 'cancelled')
  assert.equal(state.cancelCalls, 1)
}))

test('lost cancellation response is not proved by absence alone and cannot be clicked twice', t => withBrowser(t, async ({ session, client, store, state }) => {
  state.rows = [reservation]
  const quote = await cancelUcpa(session, client, store, '123')
  // Shorter timeout for the simulated lost response.
  const newPage = session.context.newPage.bind(session.context)
  session.context.newPage = async () => { const page = await newPage(); const set = page.setDefaultTimeout.bind(page); page.setDefaultTimeout = () => set(800); return page }
  assert.equal((await cancelUcpa(session, client, store, '123', { confirm: true, expectedVersion: quote.version })).status, 'cancellation_unverified')
  assert.equal((await cancelUcpa(session, client, store, '123', { confirm: true, expectedVersion: quote.version })).status, 'cancellation_unverified')
  assert.equal(state.cancelCalls, 1)
}, { lostResponse: true }))

test('past/late and participant-only reservations cannot trigger a whole-party cancellation', t => withBrowser(t, async ({ session, client, store, state }) => {
  state.rows = [reservation]
  client.detail = async () => ({ ...reservation, isCaptain: false })
  await assert.rejects(cancelUcpa(session, client, store, '123'), /not available/)
  client.detail = async () => ({ ...reservation, startTimestamp: Date.now() / 1000 + 47 * 3600 })
  await assert.rejects(cancelUcpa(session, client, store, '123'), /48 hours/)
  assert.equal(state.cancelCalls, 0)
}))

test('journals are private and reconciliation does not equate a missing booking with cancellation', async t => {
  const path = directory(t)
  const store = ucpaActionStore(path)
  store.save(ucpaBookingKey(request), { status: 'booking_started', offer, baselineIds: [] })
  assert.equal(statSync(join(path, `${ucpaBookingKey(request)}.json`)).mode & 0o777, 0o600)
  assert.throws(() => store.read('../other'))
  assert.equal((await reconcileUcpaBooking({ list: async () => [] }, store, request)).status, 'booking_unverified')
  assert.equal((await showUcpaReservation({ list: async () => [] }, store, '999')).status, 'not_found')
})

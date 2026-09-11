import test from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { decodeActionResponse, readMatchesPage } from '../lib/anybuddy-actions.js'
import { normalizeReservation, listReservations, cancelReservation, cancellationDialog, readCancelledReservation } from '../lib/account-reservations.js'
const now = new Date('2026-09-11T12:00:00Z')
const match = (overrides = {}) => ({ id: 'match-1', centerService: { centerName: 'Club test', serviceName: 'Court 2', activityId: 'padel' }, dateTime: '2026-09-21T20:00', dateFMT: 'lundi 21 septembre 2026', timeFMT: '20:00 - 21:30', duration: 90, status: 'confirmed', isBooked: true, isCancellableNow: true, cancellationCondition: 'Annulation possible', refundCondition: 'Remboursement selon conditions du club', myReservation: { reservationId: 'own-1', status: 'confirmed', totalPrice: '90 €', pricePaidByCard: '90 €' }, ...overrides })
const normalized = overrides => normalizeReservation(match(overrides), { now })
const cancelled = () => normalized({ status: 'cancelled' })
const terms = 'Annulation possible\nRemboursement selon conditions du club'
const preview = () => cancelReservation({ id: 'match-1', read: async () => [normalized()], openDialog: async () => terms, submit: () => assert.fail('Preview submitted') })

test('Next action decoding handles UTF-8 byte-counted text, references and malformed responses', () => {
  const text = 'Réservation remboursable €\n1:{"success":false}'
  const buffer = Buffer.from(`0:{"a":"$@1"}\n2:T${Buffer.byteLength(text).toString(16)},${text}1:{"success":true,"condition":"$2","amount":"$$20"}\n`)
  assert.deepEqual(decodeActionResponse(buffer), { success: true, condition: text, amount: '$20' })
  for (const invalid of ['{}', '0:{"a":"$@1"}\n', '0:{"a":"$@1"}\n1:{"field":"$2"}\n', '0:{"a":"$@1"}\n1:E{"error":"no"}\n', '0:{"a":"$@1"}\n2:Tff,short']) assert.throws(() => decodeActionResponse(invalid))
})

test('listing uses only the discovered read action, paginates and distinguishes HTTP failures', async () => {
  const calls = []
  const context = { request: { post: async (url, options) => {
    calls.push({ url, options })
    return { ok: () => true, body: async () => Buffer.from('0:{"a":"$@1"}\n1:{"success":true,"matches":{"data":[],"paging":{"hasNextPage":false}}}\n') }
  } } }
  await readMatchesPage(context, 'a'.repeat(40), 50)
  assert.deepEqual(JSON.parse(calls[0].options.data), [{ limit: 50, after: 50 }])
  assert.equal(calls[0].options.maxRedirects, 0)
  assert.equal(calls[0].options.headers['Next-Action'], 'a'.repeat(40))
  await assert.rejects(readMatchesPage({ request: { post: async () => ({ ok: () => false, status: () => 429 }) } }, 'a'.repeat(40)), /429/)
})

test('normalization excludes other players and access secrets, classifies pending/past/own cancellations', () => {
  const result = normalizeReservation(match({ players: [{ email: 'private', name: 'Private' }], instructionDetails: { accessCode: 'secret' } }), { now })
  assert.equal(result.category, 'upcoming')
  assert.equal(result.durationMinutes, 90)
  assert.equal(result.cancellable, true)
  assert.ok(!JSON.stringify(result).includes('secret'))
  assert.ok(!JSON.stringify(result).includes('Private'))
  assert.equal(normalized({ myReservation: { reservationId: 'own-1', status: 'pending' } }).category, 'pending')
  assert.equal(normalized({ myReservation: { reservationId: 'own-1', status: 'cancelled' } }).category, 'cancelled')
  assert.equal(normalized({ dateTime: '2026-09-01T20:00' }).cancellable, false)
  assert.equal(normalized({ myReservation: null }).cancellable, false)
  assert.equal(normalized({ isCancellableNow: false }).cancellable, false)
  assert.throws(() => normalized({ dateTime: '2026-02-30T20:00' }))
})

test('pagination accumulates all pages and rejects duplicate or nonadvancing pages', async () => {
  const offsets = []
  const rows = await listReservations(async after => {
    offsets.push(after)
    return { data: [match({ id: after ? 'match-2' : 'match-1' })], paging: { hasNextPage: after === 0 } }
  }, { now })
  assert.deepEqual(offsets, [0, 1])
  assert.equal(rows.length, 2)
  await assert.rejects(listReservations(async () => ({ data: [match()], paging: { hasNextPage: true } })), /pagination changed/)
  await assert.rejects(listReservations(async () => ({ data: [], paging: { hasNextPage: true } })), /no progress/)
})

test('cancellation preview never submits; unavailable and missing targets cannot reach the dialog', async () => {
  assert.equal((await preview()).status, 'cancellation_preview')
  assert.equal((await cancelReservation({ id: 'match-1', read: async () => [normalized({ isCancellableNow: false })], openDialog: () => assert.fail('Uncancellable dialog opened') })).status, 'not_cancellable')
  assert.equal((await cancelReservation({ id: 'match-1', read: async () => [cancelled()] })).status, 'already_cancelled')
  await assert.rejects(cancelReservation({ id: 'match-1', read: async () => [] }), /no longer found/)
})

test('confirmation is bound to the exact reservation and freshly displayed terms', async () => {
  const { version } = await preview()
  for (const change of [{ read: async () => [normalized({ duration: 60 })], openDialog: async () => terms }, { read: async () => [normalized()], openDialog: async () => 'No refund' }]) {
    await assert.rejects(cancelReservation({ id: 'match-1', confirm: true, expectedVersion: version, ...change, submit: () => assert.fail('Changed cancellation submitted') }), /changed/)
  }
})

test('only a fresh cancelled status confirms success; timeout checks once and never resubmits', async () => {
  const { version } = await preview()
  for (const timeout of [false, true]) {
    let reads = 0
    let submits = 0
    const result = await cancelReservation({ id: 'match-1', confirm: true, expectedVersion: version, read: async () => [reads++ ? cancelled() : normalized()], openDialog: async () => terms, submit: async () => { submits++; if (timeout) throw new Error('timeout') } })
    assert.equal(result.status, 'cancelled')
    assert.equal(result.verified, true)
    assert.equal(submits, 1)
    assert.equal(reads, 2)
  }
  let reads = 0
  const uncertain = await cancelReservation({ id: 'match-1', confirm: true, expectedVersion: version, read: async () => reads++ ? [] : [normalized()], openDialog: async () => terms, submit: async () => {} })
  assert.equal(uncertain.status, 'cancellation_unverified')
  assert.equal(uncertain.verified, false)
})

test('a pre-submit session or uncertain-journal guard prevents all mutation', async () => {
  const { version } = await preview()
  await assert.rejects(cancelReservation({ id: 'match-1', confirm: true, expectedVersion: version, read: async () => [normalized()], openDialog: async () => terms, beforeSubmit: async () => { throw new Error('Reconciliation required') }, submit: () => assert.fail('Guarded action submitted') }), /Reconciliation/)
})

test('a booking removed from the list requires explicit detail cancellation evidence', async () => {
  const { version } = await preview()
  for (const timeout of [false, true]) {
    let reads = 0
    let submitted = 0
    const result = await cancelReservation({ id: 'match-1', confirm: true, expectedVersion: version,
      read: async () => reads++ ? [] : [normalized()], openDialog: async () => terms,
      submit: async () => { submitted++; if (timeout) throw new Error('timeout') },
      readCancelled: async reservation => { assert.equal(reservation.id, 'match-1'); return cancelled() },
    })
    assert.equal(result.status, 'cancelled')
    assert.equal(result.verified, true)
    assert.equal(submitted, 1)
  }
})

test('cancelled detail verification requires the exact booking identity and explicit status', async () => {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    page.setDefaultTimeout(300)
    let status = 'Confirmé'
    await page.route('**/fr/compte/reservations/match-1', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<main><h1>Club test</h1><p>lundi 21 septembre 2026</p><p>20:00 - 21:30</p><span>${status}</span></main>` }))
    await assert.rejects(readCancelledReservation(page, normalized()))
    status = 'Annulé'
    await assert.rejects(readCancelledReservation(page, { ...normalized(), club: 'Wrong club' }))
    const result = await readCancelledReservation(page, normalized())
    assert.equal(result.category, 'cancelled')
    assert.equal(result.verificationSource, 'reservation_detail')
    assert.equal(result.cancellable, false)
  } finally { await browser.close() }
})

test('Playwright cancellation uses the exact detail identity and dialog button; preview does not click confirmation', async () => {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    let submitted = 0
    await page.route('**/cancel-test', route => { submitted++; return route.fulfill({ json: { success: true } }) })
    await page.route('**/fr/compte/reservations/match-1', route => route.fulfill({ contentType: 'text/html', body: '<main><h1>Club test</h1><p>lundi 21 septembre 2026</p><p>20:00 - 21:30</p><button onclick="document.querySelector(\'[role=alertdialog]\').hidden=false">Annuler le match</button></main><div role="alertdialog" hidden><div data-slot="alert-dialog-description">Annulation possible<br>Remboursement selon conditions du club</div><button onclick="this.parentElement.hidden=true">Retour</button><button onclick="fetch(\'/cancel-test\',{method:\'POST\'}).then(()=>this.parentElement.hidden=true)">Confirmer l\'annulation</button></div>' }))
    page.setDefaultTimeout(300)
    await assert.rejects(cancellationDialog(page, { ...normalized(), club: 'Wrong club' }))
    assert.equal(submitted, 0)
    page.setDefaultTimeout(5000)
    const dialog = await cancellationDialog(page, normalized())
    assert.equal(dialog.terms, terms)
    assert.equal(submitted, 0)
    await dialog.submit()
    assert.equal(submitted, 1)
  } finally { await browser.close() }
})

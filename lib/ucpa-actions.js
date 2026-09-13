import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as pause } from 'node:timers/promises'
import { installUcpaPreviewGuard, inspectUcpaSummary, normalizeUcpaRequest, previewUcpaBooking } from './ucpa-booking.js'
import { inspectUcpaCancellationDialog, clickUcpaCancellation } from './ucpa-confirmation.js'
import { UCPA_API, validUcpaId } from './ucpa-account.js'

export const UCPA_CREATE_URL = 'https://www.ucpa.com/loisirs-reservation/api/users/createCourtBooking'
export const UCPA_CANCEL_URL = `${UCPA_API}/cancel-court-session`
export const ucpaActionStore = directory => {
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const pathFor = key => {
    if (!/^[a-z0-9_-]+$/.test(key)) throw new Error('Invalid UCPA journal key')
    return join(directory, `${key}.json`)
  }
  return {
    read: key => existsSync(pathFor(key)) ? JSON.parse(readFileSync(pathFor(key), 'utf8')) : null,
    save: (key, value) => {
      const file = pathFor(key)
      const temporary = `${file}.${randomUUID()}.tmp`
      writeFileSync(temporary, JSON.stringify({ ...value, updatedAt: new Date().toISOString() }, null, 2), { mode: 0o600, flag: 'wx' })
      renameSync(temporary, file)
    },
  }
}
export const ucpaBookingKey = request => `book-${request.date}-${request.startTime.replace(':', '')}`
const sameTime = (row, request) => row.dateTime === `${request.date}T${request.startTime}`
export const matchesUcpaOffer = (row, offer) => row.id === offer.sessionId && sameTime(row, offer) && row.court === offer.court && row.durationMinutes === offer.durationMinutes && row.isCaptain
export const ucpaCreatePayloadMatches = (payload, offer) => {
  let body = payload?.body
  if (typeof body === 'string') { try { body = JSON.parse(body) } catch { return false } }
  return body?.sessionId === offer.sessionId && body.isInternalSession === false && body.haveSubscription === false && body.reservationInfo?.isPlaying === true && body.details?.quantity === 1 && body.details?.price === Math.round(offer.participationEUR * 100) && body.details?.offerFilliere === 'Padel' && body.details?.haveSubscription !== true && Array.isArray(body.options) && body.options.length === 0
}

const waitMutation = (page, url) => {
  const response = page.waitForResponse(r => r.url() === url && r.request().method() === 'POST')
  response.catch(() => {})
  return response
}
const successResponse = async pending => {
  const response = await pending
  const body = await response.json()
  return response.ok() && body?.success === true
}

export const reconcileUcpaBooking = async (client, store, request) => {
  const key = ucpaBookingKey(request)
  const journal = store.read(key)
  if (!journal) return { provider: 'ucpa', status: 'no_attempt' }
  const rows = await client.list()
  const matching = rows.filter(row => matchesUcpaOffer(row, journal.offer))
  if (matching.length === 1 && !journal.baselineIds.includes(matching[0].id)) {
    const result = { provider: 'ucpa', status: 'booked', reservation: matching[0], reservationConfirmed: true, paymentTiming: 'session_day' }
    store.save(key, { ...journal, ...result })
    return result
  }
  const cancellation = journal.offer.sessionId && store.read(`cancel-${journal.offer.sessionId}`)
  if (cancellation?.status === 'cancelled' && cancellation.responseConfirmed === true && !rows.some(row => row.id === journal.offer.sessionId)) {
    const result = { provider: 'ucpa', status: 'cancelled', reservation: cancellation.reservation, verified: true }
    store.save(key, { ...journal, ...result })
    return result
  }
  return { provider: 'ucpa', status: 'booking_unverified', reservationConfirmed: false, submissionStarted: true, lastStatus: journal.status }
}

export const waitForUcpaSavedCard = async page => {
  // UCPA renders desktop and mobile copies with surrounding whitespace.
  const card = page.getByText(/^\s*Carte Bancaire\s+[Xx*•\s]+\d{4}\s*$/i).and(page.locator(':visible'))
  try {
    await page.getByText('Carte enregistrée', { exact: true }).waitFor({ state: 'visible' })
    await card.waitFor({ state: 'visible' })
  } catch (error) {
    if (error.name !== 'TimeoutError') throw error
    throw new Error('UCPA saved card could not be verified; card entry is not implemented', { cause: error })
  }
}

export const bookUcpa = async (session, client, store, input, { confirm = false, onStage = () => {}, preview = previewUcpaBooking } = {}) => {
  const request = normalizeUcpaRequest(input)
  const key = ucpaBookingKey(request)
  const previous = store.read(key)
  if (confirm && previous) return reconcileUcpaBooking(client, store, request)
  const baseline = await client.list()
  const existing = baseline.filter(row => sameTime(row, request))
  if (existing.length) return { provider: 'ucpa', status: 'already_reserved', reservations: existing, submissionStarted: false }
  const page = await session.context.newPage()
  page.setDefaultTimeout(45000)
  const guard = await installUcpaPreviewGuard(session.context)
  try {
    const offer = await preview(page, request, { guard, onStage })
    if (!confirm || offer.status !== 'checkout_ready') return offer
    onStage('booking_confirmation')
    await client.assertIdentity()
    if (new URL(page.url()).pathname !== '/loisirs-reservation/reservation-terrain/payment') throw new Error('UCPA payment page changed')
    const price = inspectUcpaSummary(await page.locator('body').innerText(), request, offer.durationMinutes, offer.court)
    if (!price.withinBudget || price.totalEUR !== offer.totalEUR) throw new Error('UCPA final price changed')
    await waitForUcpaSavedCard(page)
    const latest = await client.list()
    if (latest.some(row => sameTime(row, request))) return { provider: 'ucpa', status: 'already_reserved', submissionStarted: false }
    await page.locator('#cgi').check()
    const journal = { provider: 'ucpa', status: 'booking_started', offer, baselineIds: baseline.map(row => row.id), startedAt: new Date().toISOString() }
    store.save(key, journal)
    guard.arm(UCPA_CREATE_URL, payload => ucpaCreatePayloadMatches(payload, offer))
    const pending = waitMutation(page, UCPA_CREATE_URL)
    let responseConfirmed = false
    try {
      await page.getByRole('button', { name: 'Réserver', exact: true }).click()
      responseConfirmed = await successResponse(pending)
    } catch { /* Never repeat a reservation click after uncertainty. */ }
    store.save(key, { ...journal, responseConfirmed, status: 'booking_unverified' })
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const result = await reconcileUcpaBooking(client, store, request)
        if (result.status === 'booked') return result
      } catch { /* Account verification may lag the submission. */ }
      if (attempt < 2) await pause(400)
    }
    return { provider: 'ucpa', status: 'booking_unverified', responseConfirmed, submissionStarted: true, reservationConfirmed: false }
  } finally { await page.close(); await guard.dispose() }
}

export const ucpaCancellationVersion = (reservation, terms) => createHash('sha256').update(JSON.stringify({ id: reservation.id, dateTime: reservation.dateTime, court: reservation.court, durationMinutes: reservation.durationMinutes, isCaptain: reservation.isCaptain, terms })).digest('hex')
export const assertUcpaFreeCancellation = (reservation, now = new Date()) => {
  if (!reservation.isCaptain || !reservation.canCancelPart) throw new Error('UCPA whole-party cancellation is not available for this account')
  if (reservation.startTimestamp * 1000 - new Date(now).getTime() <= 48 * 3600000) throw new Error('UCPA cancellation is within 48 hours; this command only supports free cancellation')
}

export const showUcpaReservation = async (client, store, id) => {
  if (!validUcpaId(id)) throw new Error('Use a UCPA reservation ID returned by list')
  const rows = await client.list({ scope: 'all' })
  if (rows.some(row => row.id === id)) return { provider: 'ucpa', status: 'ok', reservation: await client.detail(id) }
  const cancellation = store.read(`cancel-${id}`)
  if (cancellation?.status === 'cancelled' && cancellation.responseConfirmed === true) return { provider: 'ucpa', status: 'cancelled', reservation: cancellation.reservation, verified: true, verificationSource: 'cancellation_receipt_and_account_absence' }
  return { provider: 'ucpa', status: 'not_found' }
}

export const cancelUcpa = async (session, client, store, id, { confirm = false, expectedVersion } = {}) => {
  if (!validUcpaId(id)) throw new Error('Use a UCPA reservation ID returned by list')
  const key = `cancel-${id}`
  const previous = store.read(key)
  const rows = await client.list()
  if (previous?.responseConfirmed === true && !rows.some(row => row.id === id)) {
    const result = { ...previous, status: 'cancelled', verified: true }
    store.save(key, result)
    return result
  }
  if (previous && previous.status !== 'cancellation_preview') return { provider: 'ucpa', status: 'cancellation_unverified', submissionStarted: true, verified: false }
  if (!rows.some(row => row.id === id)) return { provider: 'ucpa', status: 'not_found', submissionStarted: false }
  const reservation = await client.detail(id)
  assertUcpaFreeCancellation(reservation)
  const page = await session.context.newPage()
  page.setDefaultTimeout(45000)
  const guard = await installUcpaPreviewGuard(session.context)
  try {
    await page.setViewportSize({ width: 1280, height: 900 })
    const reject = page.getByRole('button', { name: 'Refuser', exact: true })
    await page.addLocatorHandler(reject, button => button.click())
    await page.goto(client.detailUrl(id), { waitUntil: 'domcontentloaded' })
    await page.getByText(reservation.court, { exact: true }).waitFor()
    if (page.url() !== client.detailUrl(id)) throw new Error('UCPA reservation detail changed')
    await page.getByRole('button', { name: 'Annuler la partie', exact: true }).click()
    const { terms } = await inspectUcpaCancellationDialog(page)
    const version = ucpaCancellationVersion(reservation, terms)
    if (!confirm) return { provider: 'ucpa', status: 'cancellation_preview', reservation, terms, feeEUR: 0, version, submissionStarted: false }
    if (!expectedVersion || expectedVersion !== version) throw new Error('UCPA cancellation terms changed or missing --expected-version; preview again')
    await client.assertIdentity()
    const fresh = await client.detail(id)
    assertUcpaFreeCancellation(fresh)
    if (ucpaCancellationVersion(fresh, terms) !== version) throw new Error('UCPA reservation changed before cancellation')
    const journal = { provider: 'ucpa', status: 'cancellation_started', reservation, terms, feeEUR: 0, version, startedAt: new Date().toISOString() }
    const pending = waitMutation(page, UCPA_CANCEL_URL)
    let responseConfirmed = false
    try {
      await clickUcpaCancellation(page, async () => {
        store.save(key, journal)
        guard.arm(UCPA_CANCEL_URL, payload => String(payload?.sessionId) === id && payload?.uuid === client.customerUuid)
      })
      responseConfirmed = await successResponse(pending)
    } catch { /* No second click, including after a timeout. */ }
    store.save(key, { ...journal, status: 'cancellation_unverified', responseConfirmed })
    let absent = false
    try { absent = !(await client.list()).some(row => row.id === id) } catch { /* Keep uncertainty. */ }
    const result = { ...journal, status: responseConfirmed && absent ? 'cancelled' : 'cancellation_unverified', responseConfirmed, verified: responseConfirmed && absent, submissionStarted: true }
    if (result.verified) result.reservation = { ...reservation, status: 'cancelled', reservationConfirmed: false, canCancelPart: false }
    store.save(key, result)
    return result
  } finally { await page.close(); await guard.dispose() }
}

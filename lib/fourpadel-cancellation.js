import { createHash } from 'node:crypto'
import { listFourPadelReservations, FOURPADEL_ACCOUNT_URL } from './fourpadel-account.js'
import { fourPadelPreviewRequestAllowed } from './fourpadel-booking.js'
import { parisTime } from './availability.js'

export const inspectFourPadelCancellation = (text, reservation, now = new Date()) => {
  const date = reservation.dateTime.slice(0, 10).split('-').reverse().join('/')
  const time = reservation.dateTime.slice(11).replace(':', 'h')
  const expected = `Confirmez-vous l'annulation de la réservation prévue le ${date} à ${time} sur ${reservation.court} au centre ${reservation.club} ?`
  const deadline = text.match(/Annulable jusqu'à (\d{2})\/(\d{2})\/(\d{4}) (\d{2})h(\d{2})/)
  if (!text.includes(expected) || !text.includes('Un remboursement sera effectué en cas d\'annulation dans les délais.') || !deadline) throw new Error('4PADEL cancellation identity or terms changed')
  const cutoff = `${deadline[3]}-${deadline[2]}-${deadline[1]}T${deadline[4]}:${deadline[5]}`
  if (parisTime(now).slice(0, 16) >= cutoff) throw new Error('4PADEL cancellation deadline has passed')
  const result = { reservation, cutoff, refundType: 'credit', refundAmountVerified: false }
  return { ...result, version: createHash('sha256').update(JSON.stringify(result)).digest('hex') }
}

export const isFourPadelCancellationRequest = (request, id) => {
  const url = new URL(request.url())
  if (url.origin !== 'https://api-front.lefive.fr' || url.pathname !== `/splf/v1/bookings/${id}` || request.method() !== 'POST' || url.searchParams.get('appId') !== '2' || url.searchParams.get('isChannelWeb') !== 'true') return false
  let body
  try { body = request.postDataJSON() } catch { return false }
  return body?.booking_status === 'Cancelled' && body.isChannelWeb === true && body.channel === '2'
}

export const cancelFourPadel = async (session, store, id, { confirm = false, expectedVersion } = {}) => {
  if (!/^\d+$/.test(id)) throw new Error('Invalid 4PADEL reservation ID')
  const reservations = (await listFourPadelReservations(session)).reservations
  const reservation = reservations.find(row => row.id === id)
  if (!reservation) return { provider: '4padel', status: 'not_found', id }
  if (['Cancelled', 'Canceled'].includes(reservation.status)) return { provider: '4padel', status: 'cancelled', reservation, verified: true }
  const key = `cancel-${id}`
  if (confirm && store.read(key)) return { provider: '4padel', status: 'cancellation_unverified', reservation, repeatedSubmission: false }
  const page = await session.context.newPage()
  page.setDefaultTimeout(20000)
  let armed = false
  let submitted = false
  const guard = route => {
    const request = route.request()
    if (armed && !submitted && isFourPadelCancellationRequest(request, id)) {
      submitted = true
      return route.fallback()
    }
    return fourPadelPreviewRequestAllowed(request.url(), request.method()) ? route.fallback() : route.abort('blockedbyclient')
  }
  await session.context.route('**/*', guard)
  try {
    await page.goto(FOURPADEL_ACCOUNT_URL, { waitUntil: 'domcontentloaded' })
    const row = page.locator('.lf-my-booking-column').filter({ has: page.getByText(`#${id}`, { exact: true }) })
    const accountLoaded = page.locator('.lf-my-booking-column').first()
    await accountLoaded.waitFor()
    if (reservation.status === 'Pending' && reservation.paidParts === 0 && !await row.count()) return { provider: '4padel', status: 'pending_not_visible_in_portal', reservation, submitted: false }
    await row.getByRole('button', { name: 'Annuler', exact: true }).click()
    await page.getByText('Annuler la réservation', { exact: true }).waitFor()
    // Include only this booking's deadline; other rows can have different conditions.
    const details = inspectFourPadelCancellation(`${await row.innerText()}\n${await page.locator('body').innerText()}`, reservation)
    if (!confirm) return { provider: '4padel', status: 'cancellation_preview', ...details, submitted: false }
    if (expectedVersion !== details.version) throw new Error('Use the current cancellation preview version with --expected-version')
    store.save(key, { status: 'cancellation_started', ...details, startedAt: new Date().toISOString() })
    const pending = page.waitForResponse(response => isFourPadelCancellationRequest(response.request(), id)).then(async response => ({ ok: response.ok(), body: await response.json() }))
    pending.catch(() => {})
    armed = true
    let responseConfirmed = false
    try {
      await page.getByRole('button', { name: /^Oui$/i }).click()
      const response = await pending
      responseConfirmed = response.ok && response.body.ifIncompleteBooking === 'Cancelled'
    } catch { /* Preserve the attempt; reconcile instead of repeating the click. */ }
    armed = false
    store.save(key, { status: 'cancellation_unverified', ...details, submitted, responseConfirmed })
    await session.context.unroute('**/*', guard)
    const latest = (await listFourPadelReservations(session)).reservations.find(row => row.id === id)
    const verified = latest && ['Cancelled', 'Canceled'].includes(latest.status)
    const result = { provider: '4padel', status: verified ? 'cancelled' : 'cancellation_unverified', reservation: latest || reservation, verified: Boolean(verified), responseConfirmed, refundType: 'credit', refundAmountVerified: false }
    store.save(key, result)
    return result
  } finally {
    await session.context.unroute('**/*', guard)
    await page.close()
  }
}

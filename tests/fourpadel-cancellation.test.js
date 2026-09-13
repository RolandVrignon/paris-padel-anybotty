import assert from 'node:assert/strict'
import { test } from 'node:test'
import { inspectFourPadelCancellation, isFourPadelCancellationRequest, cancelFourPadel } from '../lib/fourpadel-cancellation.js'
import { providerScope } from '../lib/provider-session.js'
import { chromium } from 'playwright'

const reservation = { id: '123', club: 'LE FIVE Saint-Louis - Bâle', court: 'ID Verde', dateTime: '2026-09-16T14:00', durationMinutes: 90, totalEUR: 36, status: 'Pending', paidParts: 1 }
const text = `Annulable jusqu'à 14/09/2026 14h00
Confirmez-vous l'annulation de la réservation prévue le 16/09/2026 à 14h00 sur ID Verde au centre LE FIVE Saint-Louis - Bâle ?
Un remboursement sera effectué en cas d'annulation dans les délais.`
const now = new Date('2026-09-13T08:00:00Z')
test('cancellation matches the exact club, court, date and deadline without promising an unverified refund', () => {
  const result = inspectFourPadelCancellation(text, reservation, now)
  assert.equal(result.cutoff, '2026-09-14T14:00')
  assert.equal(result.refundAmountVerified, false)
  assert.equal(result.version.length, 64)
  assert.throws(() => inspectFourPadelCancellation(text.replace('ID Verde', 'Piste 5'), reservation, now))
  assert.throws(() => inspectFourPadelCancellation(text, reservation, new Date('2026-09-14T12:00:00Z')), /deadline/)
  assert.notEqual(result.version, inspectFourPadelCancellation(text.replace('14/09', '15/09'), reservation, now).version)
})

test('an already cancelled reservation reconciles without another cancellation or payment', async () => {
  const browser = await chromium.launch()
  const context = await browser.newContext()
  let writes = 0
  await context.route('**/*', route => {
    if (!['GET', 'OPTIONS'].includes(route.request().method())) writes++
    const headers = { 'access-control-allow-origin': '*' }
    if (new URL(route.request().url()).pathname === '/splf/v1/bookings') return route.fulfill({ headers, contentType: 'application/json', body: JSON.stringify([{ id: 123, owner: { email: 'test@example.com' }, sportType: { id: 3 }, center: { id: 61, centerName: reservation.club }, field: { name: reservation.court }, startingDateZuluTime: '2026-09-16T12:00:00Z', duration: 90, price: 36, booking_status: 'Cancelled', capacity: 4 }]) })
    return route.fulfill({ contentType: 'text/html', body: '<script>fetch("https://api-front.lefive.fr/splf/v1/bookings?owner_like=fixture&_limit=15&appId=2")</script>' })
  })
  try {
    const result = await cancelFourPadel({ context, accountScope: providerScope('test@example.com') }, { read() { throw new Error('Should reconcile first') } }, '123', { confirm: true })
    assert.equal(result.status, 'cancelled')
    assert.equal(result.verified, true)
    assert.equal(writes, 0)
  } finally { await browser.close() }
})


test('native cancellation guard binds query, ID, method and cancellation body', () => {
  const request = { url: () => 'https://api-front.lefive.fr/splf/v1/bookings/123?appId=2&isChannelWeb=true', method: () => 'POST', postDataJSON: () => ({ booking_status: 'Cancelled', isChannelWeb: true, channel: '2' }) }
  assert.equal(isFourPadelCancellationRequest(request, '123'), true)
  assert.equal(isFourPadelCancellationRequest(request, '456'), false)
  assert.equal(isFourPadelCancellationRequest({ ...request, postDataJSON: () => ({ paidCredit: 9 }) }, '123'), false)
  assert.equal(isFourPadelCancellationRequest({ ...request, url: () => request.url().replace('appId=2', 'appId=1') }, '123'), false)
})

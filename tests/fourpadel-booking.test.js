import assert from 'node:assert/strict'
import { test } from 'node:test'
import { chromium } from 'playwright'
import { normalizeFourPadelRequest, assertFourPadelBrowserIdentity, selectFourPadelOffer, inspectFourPadelCheckout, installFourPadelPreviewGuard, fourPadelPreviewRequestAllowed } from '../lib/fourpadel-booking.js'
import { normalizeFourPadelReservations } from '../lib/fourpadel-account.js'
import { providerScope } from '../lib/provider-session.js'

const request = { clubId: '4padel-paris-20', date: '2026-09-21', startTime: '13:00', durationsMinutes: [60, 90, 120], courtEnvironment: ['indoor', 'outdoor'], maxPricePerHourEUR: 40 }
const field = (patch = {}) => ({ id: 681, name: 'Piste 3', center: { id: 79 }, fieldType: { name: 'Extérieur' }, canBookOnline: true, webPrice: 60, ...patch })
const rows = [{ startingDateZuluTime: '2026-09-21T11:00:00Z', duration: 90, fields: [field()] }, { startingDateZuluTime: '2026-09-21T11:00:00Z', duration: 120, fields: [field({ webPrice: 80 })] }]
const summary = '4PADEL Paris 20 en Extérieur\nle 21/09/2026\nde 13h00 à 14h30\nUn avoir sera généré en cas d\'annulation plus de 24 h avant la réservation.\nPAYER MAINTENANT 15.00€\ncomplément sur ta CB'

test('4PADEL keeps duration and environment preference order with a whole-court hourly budget', () => {
  assert.equal(selectFourPadelOffer(rows, request).durationMinutes, 90)
  assert.equal(selectFourPadelOffer(rows, { ...request, durationsMinutes: [120, 90] }).durationMinutes, 120)
  assert.equal(selectFourPadelOffer(rows, { ...request, durationsMinutes: [60] }), null)
  assert.equal(selectFourPadelOffer(rows, { ...request, courtEnvironment: ['indoor'] }), null)
  assert.equal(selectFourPadelOffer(rows, { ...request, maxPricePerHourEUR: 39.99 }), null)
  const mixed = [{ ...rows[0], fields: [field(), field({ id: 682, name: 'Piste 4', fieldType: { name: 'Intérieur' } })] }]
  assert.equal(selectFourPadelOffer(mixed, request).courtId, 682)
  assert.equal(selectFourPadelOffer(mixed, { ...request, courtEnvironment: ['outdoor', 'indoor'] }).courtId, 681)
  assert.throws(() => selectFourPadelOffer([{ ...rows[0], fields: [field({ center: { id: 117 } })] }], request), /cannot be verified/)
})

test('checkout verifies the date, duration, whole-court total, share and credit cancellation terms', () => {
  const offer = selectFourPadelOffer(rows, request)
  const result = inspectFourPadelCheckout(summary, offer)
  assert.equal(result.totalEUR, 60)
  assert.equal(result.amountDueEUR, 15)
  assert.equal(result.captainGuaranteesWholeCourt, true)
  assert.equal(result.cancellation.refundType, 'credit')
  assert.equal(result.cancellation.cutoffHours, 24)
  for (const text of [summary.replace('21/09', '22/09'), summary.replace('14h30', '15h00'), summary.replace('15.00', '21.00'), summary.replace('24 h', 'demain'), summary.replace('Paris 20', 'Saint-Ouen')]) assert.throws(() => inspectFourPadelCheckout(text, offer))
  assert.equal(inspectFourPadelCheckout(summary.replace('15.00', '60.00'), offer, 4).amountDueEUR, 60)
  assert.throws(() => normalizeFourPadelRequest({ ...request, date: '2026-02-30' }))
})

test('preview guard permits observed calendar reads and blocks reservation/payment mutations in a real browser', async () => {
  assert.equal(fourPadelPreviewRequestAllowed('https://api2-front.lefive.fr/bookingrules/me/visibility', 'POST'), true)
  assert.equal(fourPadelPreviewRequestAllowed('https://evil.example/bookingrules/me/visibility', 'POST'), false)
  const browser = await chromium.launch()
  const context = await browser.newContext({ serviceWorkers: 'block' })
  let mutations = 0
  await context.route('**/*', route => {
    if (route.request().method() === 'PUT') mutations++
    return route.fulfill({ status: 200, contentType: 'text/html', body: '<html></html>' })
  })
  const dispose = await installFourPadelPreviewGuard(context)
  try {
    const page = await context.newPage()
    await page.goto('https://api-front.lefive.fr/')
    const result = await page.evaluate(async () => {
      try { await fetch('/splf/v1/bookings', { method: 'PUT', body: '{}' }); return 'submitted' } catch { return 'blocked' }
    })
    assert.equal(result, 'blocked')
    assert.equal(mutations, 0)
  } finally { await dispose(); await browser.close() }
})

test('account list distinguishes pending from confirmed and rejects wrong identity or truncation', () => {
  const scope = providerScope('test@example.com')
  const booking = { id: 123, owner: { email: 'test@example.com' }, sportType: { id: 3 }, center: { id: 79, centerName: '4PADEL Paris 20' }, field: { name: 'Piste 3' }, startingDateZuluTime: '2026-09-21T11:00:00Z', duration: 90, price: 60, booking_status: 'Pending', nbOfPaidParticipations: 0, capacity: 4, paid: false }
  assert.equal(normalizeFourPadelReservations([booking], scope)[0].reservationConfirmed, false)
  assert.equal(normalizeFourPadelReservations([{ ...booking, booking_status: 'Confirmed' }], scope)[0].reservationConfirmed, true)
  assert.throws(() => normalizeFourPadelReservations([booking], providerScope('other@example.com')), /identity/)
  assert.throws(() => normalizeFourPadelReservations(Array(15).fill(booking), scope), /truncated/)
  assert.throws(() => normalizeFourPadelReservations([booking, booking], scope), /identity/)
})


test('an unavailable browser identity stops the checkout before any reservation action', async () => {
  const browser = await chromium.launch()
  const context = await browser.newContext({ serviceWorkers: 'block' })
  await context.route('**/*', route => {
    const url = new URL(route.request().url())
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization' } })
    if (url.pathname === '/splf/v1/users/me') return route.fulfill({ status: 503, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{}' })
    return route.fulfill({ contentType: 'text/html', body: '<html></html>' })
  })
  try {
    const page = await context.newPage()
    await page.goto('https://www.4padel.fr/')
    await assert.rejects(assertFourPadelBrowserIdentity(page, 'Bearer fixture', providerScope('test@example.com')), /browser identity unavailable \(HTTP 503\)/)
  } finally { await browser.close() }
})

test('browser identity can be checked with a restored session without an automatic users/me request', async () => {
  const browser = await chromium.launch()
  const context = await browser.newContext()
  await context.route('**/*', route => {
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization' }
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
    if (new URL(route.request().url()).pathname === '/splf/v1/users/me') return route.fulfill({ headers, contentType: 'application/json', body: JSON.stringify({ email: 'test@example.com' }) })
    return route.fulfill({ contentType: 'text/html', body: '<html></html>' })
  })
  try {
    const page = await context.newPage()
    await page.goto('https://www.4padel.fr/')
    await assertFourPadelBrowserIdentity(page, 'Bearer fixture', providerScope('test@example.com'))
    await assert.rejects(assertFourPadelBrowserIdentity(page, 'Bearer fixture', providerScope('other@example.com')), /does not match/)
  } finally { await browser.close() }
})

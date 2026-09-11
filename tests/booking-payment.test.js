import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { paymentStore, payBookingOffer, inspectFinalPayment, clickFinalPayment, reconcilePayment, verifyPaymentSummary } from '../lib/booking-payment.js'
import { installPaymentGuard } from '../lib/checkout.js'

const request = { date: '2026-09-19', startTime: '07:00', maxPricePerHourEUR: 80, durationsMinutes: [60], courtEnvironment: ['any'] }
const offer = { ...request, clubId: 'ucpa-paris', clubName: 'UCPA Sport Station Hostel Paris', court: 'Terrain 6', durationMinutes: 60, totalCents: 3800 }
const reservation = { id: 'new-booking', club: offer.clubName, court: offer.court, dateTime: '2026-09-19T07:00', durationMinutes: 60, hasOwnReservation: true, category: 'upcoming', reservationConfirmed: true }
const fakeContext = () => {
  const context = new EventEmitter()
  context.route = async (pattern, handler) => { context.handler = handler }
  context.send = async (url, method = 'POST', data = {}) => {
    let outcome
    await context.handler({ request: () => ({ url: () => url, method: () => method }), abort: () => { outcome = 'blocked' }, continue: () => { outcome = 'allowed'; context.emit('response', { url: () => url, json: async () => data }) } })
    return outcome
  }
  return context
}
const url = 'https://api.stripe.com/v1/payment_intents/pi_fixture/confirm'
const storeFor = t => {
  const root = mkdtempSync(join(tmpdir(), 'anybotty-payment-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return { root, store: paymentStore(root, 'fixture@example.test', request) }
}

test('default guard is reused, allows one armed intent, blocks wallets/setup/second confirms', async () => {
  const context = fakeContext()
  const guard = await installPaymentGuard(context)
  assert.equal(await context.send(url), 'blocked')
  assert.equal(await installPaymentGuard(context), guard)
  guard.arm()
  assert.equal(await context.send('https://api.stripe.com/v1/setup_intents/seti_fixture/confirm'), 'blocked')
  assert.equal(await context.send('https://api.stripe.com/v1/charges'), 'blocked')
  assert.equal(await context.send('https://other.stripe.com/v1/payment_intents/pi_fixture/confirm'), 'blocked')
  assert.equal(await context.send(url), 'allowed')
  assert.equal(await context.send(url), 'blocked')
  assert.equal(await context.send(url.replace('pi_fixture', 'pi_second')), 'blocked')
  assert.throws(() => guard.arm())
})

test('durable journal groups alternative clubs and contains no credentials', t => {
  const { store, root } = storeFor(t)
  store.save({ status: 'payment_started', offer, baselineIds: [] })
  const other = paymentStore(root, 'FIXTURE@example.test', { ...request, clubs: ['other'], durationsMinutes: [120] })
  assert.equal(other.read().status, 'payment_started')
  assert.ok(!JSON.stringify(other.read()).includes('fixture@example.test'))
  assert.equal(statSync(root).mode & 0o777, 0o700)
})

test('real mode journals before one click, waits for confirmed booking, and a rerun only reconciles', async t => {
  const { store } = storeFor(t)
  const context = fakeContext()
  let clicked = 0
  let readsAfterClick = 0
  const deps = {
    store, payment: {}, timeoutMs: 100, pollMs: 1,
    readReservations: async () => clicked ? [++readsAfterClick > 1 ? reservation : { ...reservation, reservationConfirmed: false, category: 'pending' }] : [],
    verifySummary: async () => {}, prepare: async () => {}, fill: async () => {}, inspect: async () => ({}),
    click: async () => { assert.equal(store.read().status, 'payment_started'); clicked++; await context.send(url, 'POST', { status: 'requires_capture', amount: 3800, currency: 'eur' }) },
  }
  const result = await payBookingOffer({ context: () => context, url: () => 'https://www.anybuddyapp.com/fr/club/ucpa-paris/padel' }, offer, request, deps)
  assert.equal(result.status, 'booked')
  assert.equal(result.reservation.id, reservation.id)
  assert.equal(clicked, 1)
  assert.equal((await payBookingOffer({ context: () => context, url: () => 'https://www.anybuddyapp.com/fr/club/ucpa-paris/padel' }, offer, request, { ...deps, click: () => assert.fail('Repeat payment') })).status, 'booked')
  assert.equal(clicked, 1)
})

test('decline, 3DS, amount mismatch and unknown outcome stop without retry or invented success', async t => {
  for (const [stripeStatus, amount, expected] of [['requires_payment_method', 3800, 'payment_failed'], ['requires_action', 3800, 'payment_action_required'], ['succeeded', 4000, 'payment_unverified'], ['requires_capture', 3800, 'payment_unverified']]) {
    const { store } = storeFor(t)
    const context = fakeContext()
    let clicks = 0
    const result = await payBookingOffer({ context: () => context, url: () => 'https://www.anybuddyapp.com/fr/club/ucpa-paris/padel' }, offer, request, {
      store, payment: {}, timeoutMs: 5, pollMs: 1, readReservations: async () => [], verifySummary: async () => {}, prepare: async () => {}, fill: async () => {}, inspect: async () => ({}),
      click: async () => { clicks++; await context.send(url, 'POST', { status: stripeStatus, amount, currency: 'eur' }); throw new Error('Transport interrupted after click') },
    })
    assert.equal(result.status, expected)
    assert.equal(result.reservationConfirmed, false)
    assert.equal(result.paymentSubmitted, true)
    assert.equal(clicks, 1)
    assert.equal((await reconcilePayment(store.read(), async () => [])).reservationConfirmed, false)
  }
})

test('existing booking and preflight failures cannot submit; wrong date/court/club cannot confirm', async t => {
  const { store } = storeFor(t)
  const context = fakeContext()
  const base = { store, verifySummary: async () => {}, readReservations: async () => [reservation], prepare: () => assert.fail('Existing booking paid') }
  assert.equal((await payBookingOffer({ context: () => context, url: () => 'https://www.anybuddyapp.com/fr/club/ucpa-paris/padel' }, offer, request, base)).status, 'existing_reservation')
  assert.equal(store.read(), null)
  await assert.rejects(payBookingOffer({ context: () => context, url: () => 'https://www.anybuddyapp.com/fr/club/ucpa-paris/padel' }, offer, request, { ...base, readReservations: async () => [], prepare: async () => { throw new Error('Conditions changed') } }))
  assert.equal(store.read(), null)
  for (const changed of [{ court: 'Wrong' }, { club: 'Wrong' }, { dateTime: '2026-09-20T07:00' }, { durationMinutes: 90 }, { hasOwnReservation: false }]) {
    assert.equal((await reconcilePayment({ offer, baselineIds: [] }, async () => [{ ...reservation, ...changed }])).reservationConfirmed, false)
  }
  assert.equal((await reconcilePayment({ offer, baselineIds: [reservation.id] }, async () => [reservation])).reservationConfirmed, false)
})

test('final DOM click targets exact price button, never Revolut; changed total/identity blocks it', async () => {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    page.setDefaultTimeout(1000)
    await page.route('https://js.stripe.com/fixture', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<input autocomplete="cc-number" value="4242424242424242"><input autocomplete="cc-exp" value="1229"><input autocomplete="cc-csc" value="123"><button onclick="globalThis.wallet=true">Revolut Pay</button>' }))
    await page.setContent('<section data-testid="booking-sheet"><p>Entrez vos informations de paiement</p><p>UCPA Sport Station Hostel Paris</p><p>19 septembre 2026</p><p>07:00 (60 min)</p><p>Terrain 6</p><p>Total à payer 38 €</p><iframe src="https://js.stripe.com/fixture"></iframe><button onclick="globalThis.paid=(globalThis.paid||0)+1">Payer 38 €</button><button onclick="globalThis.wallet=true">Revolut Pay</button></section>')
    await verifyPaymentSummary(page, offer, request)
    await assert.rejects(verifyPaymentSummary(page, { ...offer, court: 'Other court' }, request))
    await page.getByTestId('booking-sheet').locator('p').filter({ hasNotText: 'Entrez vos informations de paiement' }).evaluateAll(nodes => nodes.forEach(node => node.remove()))
    const button = await inspectFinalPayment(page, offer, request)
    await assert.rejects(inspectFinalPayment(page, { ...offer, totalCents: 4000 }, request))
    await assert.rejects(inspectFinalPayment(page, offer, { ...request, maxPricePerHourEUR: 30 }))
    await clickFinalPayment(button, 3800)
    assert.equal(await page.evaluate(() => globalThis.paid), 1)
    assert.equal(await page.evaluate(() => globalThis.wallet), undefined)
    await button.evaluate(el => { el.textContent = 'Payer 39 €' })
    await assert.rejects(clickFinalPayment(button, 3800))
    assert.equal(await page.evaluate(() => globalThis.paid), 1)
  } finally { await browser.close() }
})

test('headless requires_action keeps the browser flow alive until confirmation without a second payment', async t => {
  const { store } = storeFor(t)
  const context = fakeContext()
  let clicked = 0
  let afterClickReads = 0
  const events = []
  const result = await payBookingOffer({ context: () => context, url: () => 'https://www.anybuddyapp.com/fr/club/ucpa-paris/padel' }, offer, request, {
    store, payment: {}, headed: false, timeoutMs: 500, pollMs: 1,
    verifySummary: async () => {}, prepare: async () => {}, fill: async () => {}, inspect: async () => ({}),
    readReservations: async () => clicked && ++afterClickReads >= 3 ? [reservation] : [],
    onEvent: event => events.push(event),
    click: async () => {
      clicked++
      await context.send(url, 'POST', { status: 'requires_action', amount: 3800, currency: 'eur', next_action: { type: 'use_stripe_sdk', use_stripe_sdk: { type: 'three_d_secure_2_fingerprint', secret: 'never-log-this' }, secret: 'never-log-this' } })
    },
  })
  assert.equal(result.status, 'booked')
  assert.equal(clicked, 1)
  assert.ok(afterClickReads >= 3)
  assert.equal(events[0].authentication.nextActionType, 'use_stripe_sdk')
  assert.equal(events[0].authentication.sdkActionType, 'three_d_secure_2_fingerprint')
  assert.equal(events[0].authentication.notificationSent, null)
  assert.ok(!JSON.stringify(events).includes('never-log-this'))
  assert.ok(!JSON.stringify(store.read()).includes('never-log-this'))
})

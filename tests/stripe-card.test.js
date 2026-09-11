import test from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { fillStripeCard, findStripeCardFrame, validateCardConfig } from '../lib/stripe-card.js'
const card = { cardNumber: '4242 4242 4242 4242', expiryMonth: '12', expiryYear: '2029', cvc: '123', billingCountry: 'FR', cardholderName: 'Test Person', billingPostalCode: '75019' }
const form = '<label>Numéro de carte<input id="payment-numberInput" name="number" autocomplete="cc-number"></label><label>Date d\'expiration<input id="payment-expiryInput" autocomplete="cc-exp"></label><label>Code de sécurité<input id="payment-cvcInput" autocomplete="cc-csc"></label><select autocomplete="billing country"><option value="US">United States</option><option value="FR">France</option></select><button onclick="globalThis.submitted=true">Payer</button>'
const withPage = async (run, html = form) => {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    page.setDefaultTimeout(2000)
    await page.route('https://js.stripe.com/test-form', route => route.fulfill({ contentType: 'text/html', body: html }))
    await page.route('https://js.stripe.com/telemetry', route => route.fulfill({ contentType: 'text/html', body: '<p>Telemetry</p>' }))
    await page.setContent('<iframe src="https://js.stripe.com/telemetry"></iframe><section data-testid="booking-sheet"><iframe title="Cadre de saisie sécurisé pour le paiement" src="https://js.stripe.com/telemetry"></iframe><iframe src="https://js.stripe.com/test-form"></iframe><button onclick="globalThis.submitted=true">Payer 38 €</button></section>')
    await run(page)
  } finally { await browser.close() }
}

test('card preparation validates without echoing values and preserves leading zeroes', () => {
  assert.equal(validateCardConfig({ ...card, cvc: '001' }).cvc, '001')
  assert.equal(validateCardConfig(card).expiry, '1229')
  for (const invalid of [{ ...card, expiryMonth: '13' }, { ...card, cardNumber: 'private-value' }, { ...card, cvc: '1' }, {}]) assert.throws(() => validateCardConfig(invalid), error => !error.message.includes('private-value') && !error.message.includes('4242'))
})

test('finds the checkout card frame among telemetry frames and fills without clicking or leaking values', async () => {
  await withPage(async page => {
    const result = await fillStripeCard(page, card)
    assert.deepEqual(result.filledFields, ['cardNumber', 'expiry', 'cvc', 'billingCountry'])
    assert.deepEqual(result.absentFields, ['cardholderName', 'billingPostalCode'])
    assert.equal(result.paymentSubmitted, false)
    const frame = await findStripeCardFrame(page)
    assert.equal(await frame.locator('[autocomplete=cc-number]').inputValue(), '4242424242424242')
    assert.equal(await frame.evaluate(() => globalThis.submitted), undefined)
    assert.equal(await page.evaluate(() => globalThis.submitted), undefined)
    for (const secret of ['4242', '123', 'Test Person', '75019']) assert.ok(!JSON.stringify(result).includes(secret))
  })
})

test('waits for asynchronous form mounting and fills optional billing fields when present', async () => {
  const fields = form + '<input autocomplete="cc-name"><input autocomplete="billing postal-code">'
  await withPage(async page => {
    const result = await fillStripeCard(page, card)
    assert.deepEqual(result.absentFields, [])
    assert.ok(result.filledFields.includes('billingPostalCode'))
  }, `<script>setTimeout(()=>document.body.innerHTML=${JSON.stringify(fields)},250)</script>`)
})

test('duplicate forms and fields outside the checkout are never filled', async () => {
  await withPage(async page => {
    const attached = page.waitForEvent('frameattached')
    await page.locator('[data-testid=booking-sheet]').evaluate(node => { node.appendChild(node.querySelector('iframe[src$="test-form"]').cloneNode()) })
    const second = await attached
    await second.locator('input[autocomplete=cc-number]').waitFor()
    await page.waitForLoadState('load')
    await assert.rejects(findStripeCardFrame(page), /Multiple/)
    await page.locator('[data-testid=booking-sheet]').evaluate(node => node.replaceWith(...node.childNodes))
    await assert.rejects(findStripeCardFrame(page, { timeoutMs: 300 }), /unavailable/)
  })
})

test('field rejection strips Playwright values and leaves the final payment untouched', async () => {
  await withPage(async page => {
    await assert.rejects(fillStripeCard(page, card), error => !error.message.includes('4242') && error.message.includes('could not be verified'))
    assert.equal(await page.evaluate(() => globalThis.submitted), undefined)
  }, form.replace('name="number"', 'name="number" aria-invalid="true"'))
})

test('detects direct card entry without clicking payment method or Link buttons', async () => {
  await withPage(async page => {
    let detected
    await findStripeCardFrame(page, { onDetected: result => { detected = result } })
    assert.equal(detected.route, 'direct_card')
    assert.equal(await page.evaluate(() => globalThis.submitted), undefined)
  })
})

test('opens only Carte bancaire when methods are collapsed, then reports the selectable path', async () => {
  const choices = `<button onclick='globalThis.cardClicks=(globalThis.cardClicks||0)+1;document.querySelector("#fields").hidden=false'>Carte bancaire</button><button onclick='globalThis.wallet=true'>Revolut Pay</button><button onclick='globalThis.wallet=true'>Satispay</button><div id="fields" hidden>${form}</div>`
  await withPage(async page => {
    let detected
    const frame = await findStripeCardFrame(page, { onDetected: result => { detected = result } })
    assert.equal(detected.route, 'select_card')
    assert.deepEqual(detected.observedMethodButtons, ['Carte bancaire', 'Revolut Pay', 'Satispay'])
    assert.equal(await frame.evaluate(() => globalThis.cardClicks), 1)
    assert.equal(await frame.evaluate(() => globalThis.wallet), undefined)
    assert.equal(await frame.evaluate(() => globalThis.submitted), undefined)
    assert.equal(await frame.locator('[autocomplete=cc-number]').inputValue(), '')
  }, choices)
})

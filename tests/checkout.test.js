import test from 'node:test'
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { selectCourtIfOffered } from '../lib/court-selection.js'
import { chromium } from 'playwright'
import { TERMS_LABEL, MARKETING_OPT_OUT_LABEL, inspectCheckout, prepareStripeCheckout, isPaymentConfirmation } from '../lib/checkout.js'

const fixture = (extra = '') => `<section data-testid="booking-sheet"><div>Confirmer et Payer</div><p>Paris Padel</p><p>Total à payer 70 €</p><p>09:00 (60 min)</p><label><input type="checkbox">${TERMS_LABEL}</label>${extra}<button id="pay">Payer 70 €</button></section><script>globalThis.payClicks=0; document.querySelector('#pay').onclick=()=>{payClicks++;document.querySelector('section').innerHTML='<p>Entrez vos informations de paiement</p><iframe title="Cadre de saisie sécurisé pour le paiement" src="https://js.stripe.com/v3/fixture"></iframe><button onclick="globalThis.payClicks++">Payer 70 €</button>'}</script>`

test('preview accepts known terms, preserves marketing, stops before final payment and refuses reentry', async () => {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    await page.route('https://js.stripe.com/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<label>Numéro de carte<input autocomplete="cc-number"></label>' }))
    await page.setContent(fixture(`<label><input id="marketing" type="checkbox" checked onchange="globalThis.marketingChanged=true">${MARKETING_OPT_OUT_LABEL}</label>`))
    const before = await inspectCheckout(page, 'paris-padel')
    assert.equal(before.checkboxes.find(box => box.label === MARKETING_OPT_OUT_LABEL).checked, true)
    assert.equal(await page.getByRole('checkbox', { name: TERMS_LABEL, exact: true }).isChecked(), false)
    const result = await prepareStripeCheckout(page, 'paris-padel', { courtEnvironment: ['any'] })
    assert.equal(result.stage, 'stripe_form')
    assert.equal(result.paymentSubmitted, false)
    assert.equal(await page.evaluate(() => globalThis.payClicks), 1)
    assert.equal(await page.evaluate(() => globalThis.marketingChanged), undefined)
    await assert.rejects(prepareStripeCheckout(page, 'paris-padel'), /Already at payment/)
    assert.equal(await page.evaluate(() => globalThis.payClicks), 1)
  } finally { await browser.close() }
})

test('unknown conditions, missing terms and wrong club prevent all checkout mutations', async () => {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    for (const html of [fixture('<label><input type="checkbox">New club condition</label>'), fixture().replace(TERMS_LABEL, 'Changed terms'), fixture().replace('<p>Paris Padel</p>', '<p>Other club</p>')]) {
      await page.setContent(html)
      await assert.rejects(prepareStripeCheckout(page, 'paris-padel'), /conditions changed|does not match/)
      assert.equal(await page.evaluate(() => globalThis.payClicks), 0)
      assert.equal(await page.locator('input[type=checkbox]:checked').count(), 0)
    }
  } finally { await browser.close() }
})

test('payment guard blocks Stripe confirmations, permits initialization and unrelated domains', () => {
  for (const path of ['/v1/payment_intents/pi_test/confirm', '/v1/setup_intents/seti_test/confirm', '/v1/charges', '/v1/payment_pages/cs_test/confirm']) assert.equal(isPaymentConfirmation(`https://api.stripe.com${path}`, 'POST'), true)
  assert.equal(isPaymentConfirmation('https://api.stripe.com/v1/payment_intents/pi_test', 'GET'), false)
  assert.equal(isPaymentConfirmation('https://api.stripe.com/v1/elements/sessions', 'POST'), false)
  assert.equal(isPaymentConfirmation('https://notstripe.com/v1/charges', 'POST'), false)
})


test('checkout audit covers all nine catalogue clubs with observed Stripe evidence', () => {
  const read = path => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'))
  const catalogue = read('../data/clubs.json')
  const profiles = read('../data/checkout-requirements.json').clubs
  assert.deepEqual(profiles.map(club => club.clubId).sort(), catalogue.map(club => club.id).sort())
  for (const profile of profiles) {
    assert.equal(profile.stripeReached, true)
    assert.equal(profile.paymentSubmitted, false)
    assert.deepEqual(profile.requiredLabels, [TERMS_LABEL])
    assert.ok(Date.parse(profile.checkedAt))
  }
})

test('checkout waits for the server cart total before accepting terms or clicking Pay', async () => {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    await page.route('https://js.stripe.com/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<button>Carte bancaire</button>' }))
    await page.setContent(fixture().replace('<p>Total à payer 70 €</p>', '<p id="total">Total à payer —</p>'))
    const preparing = prepareStripeCheckout(page, 'paris-padel')
    assert.equal(await page.evaluate(() => globalThis.payClicks), 0)
    await page.evaluate(() => { globalThis.document.querySelector('#total').textContent = 'Total à payer 70 €' })
    assert.equal((await preparing).stage, 'stripe_form')
    assert.equal(await page.evaluate(() => globalThis.payClicks), 1)
  } finally { await browser.close() }
})


test('direct checkout refuses an incompatible or unknown environment before accepting terms or Pay', async () => {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    for (const features of ['Double, Extérieur', 'Intérieur, Extérieur', 'Double, Moquette']) {
      const html = fixture().replace('<p>Paris Padel</p>', `<p>Paris Padel</p><aside>Informations importantes : Intérieur</aside><div><p class="font-bold">Court</p><p class="opacity-70">${features}</p></div>`)
      await page.setContent(html)
      assert.equal((await selectCourtIfOffered(page, { durationMinutes: 60, courtEnvironment: ['indoor'] })).usedModal, false)
      await assert.rejects(prepareStripeCheckout(page, 'paris-padel', { courtEnvironment: ['indoor'] }), /does not match/)
      assert.equal(await page.evaluate(() => globalThis.payClicks), 0)
      assert.equal(await page.getByRole('checkbox', { name: TERMS_LABEL, exact: true }).isChecked(), false)
    }
  } finally { await browser.close() }
})

test('matching court environment reaches Stripe regardless of opposing words in club information', async () => {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    await page.route('https://js.stripe.com/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<button>Carte bancaire</button>' }))
    await page.setContent(fixture().replace('<p>Paris Padel</p>', '<p>Paris Padel</p><aside>Des activités Extérieur</aside><div><p class="font-bold">Court</p><p class="opacity-70">Double, Intérieur</p></div>'))
    assert.equal((await prepareStripeCheckout(page, 'paris-padel', { courtEnvironment: ['indoor'] })).stage, 'stripe_form')
    assert.equal(await page.evaluate(() => globalThis.payClicks), 1)
  } finally { await browser.close() }
})

test('direct checkout accepts either known type for preference modes when no court choice is offered', async () => {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    await page.route('https://js.stripe.com/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<button>Carte bancaire</button>' }))
    for (const courtEnvironment of [['indoor', 'outdoor'], ['outdoor', 'indoor']]) {
      for (const label of ['Intérieur', 'Extérieur']) {
        await page.setContent(fixture().replace('<p>Paris Padel</p>', `<p>Paris Padel</p><div><p class="font-bold">Court</p><p class="opacity-70">Double, ${label}</p></div>`))
        assert.equal((await selectCourtIfOffered(page, { durationMinutes: 60, courtEnvironment })).usedModal, false)
        assert.equal((await prepareStripeCheckout(page, 'paris-padel', { courtEnvironment })).stage, 'stripe_form')
        assert.equal(await page.evaluate(() => globalThis.payClicks), 1)
      }
    }
  } finally { await browser.close() }
})

test('preference mode still rejects a changed selected type or an unknown type before terms/payment', async () => {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    for (const [label, expectedEnvironment] of [['Extérieur', 'indoor'], ['Intérieur', 'outdoor'], ['Non renseigné', undefined], ['Intérieur, Extérieur', undefined]]) {
      await page.setContent(fixture().replace('<p>Paris Padel</p>', `<p>Paris Padel</p><div><p class="font-bold">Court</p><p class="opacity-70">${label}</p></div>`))
      await assert.rejects(prepareStripeCheckout(page, 'paris-padel', { courtEnvironment: ['indoor', 'outdoor'], expectedEnvironment }), /does not match/)
      assert.equal(await page.evaluate(() => globalThis.payClicks), 0)
      assert.equal(await page.getByRole('checkbox', { name: TERMS_LABEL, exact: true }).isChecked(), false)
    }
  } finally { await browser.close() }
})

test('checkout blocks excluded durations and changes from the chosen duration before terms or Pay', async () => {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    for (const options of [{ durationsMinutes: [60, 90] }, { durationsMinutes: [60, 90, 120], expectedDuration: 60 }]) {
      await page.setContent(fixture().replace('09:00 (60 min)', '09:00 (120 min)'))
      await assert.rejects(prepareStripeCheckout(page, 'paris-padel', options), /duration is excluded or differs/)
      assert.equal(await page.evaluate(() => globalThis.payClicks), 0)
      assert.equal(await page.getByRole('checkbox', { name: TERMS_LABEL, exact: true }).isChecked(), false)
    }
    await page.route('https://js.stripe.com/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<button>Carte bancaire</button>' }))
    assert.equal((await prepareStripeCheckout(page, 'paris-padel', { durationsMinutes: [60, 90, 120], expectedDuration: 120 })).stage, 'stripe_form')
    assert.equal(await page.evaluate(() => globalThis.payClicks), 1)
  } finally { await browser.close() }
})

test('a cart stuck updating produces a typed pre-payment failure and a slow cart waits safely', async () => {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    const skeleton = fixture().replace('Total à payer 70 €', 'Total à payer —').replace('Payer 70 €</button>', 'Mise à jour du panier…</button>')
    await page.setContent(skeleton)
    await assert.rejects(inspectCheckout(page, 'paris-padel', { cartTimeoutMs: 100 }), { code: 'CART_NOT_READY' })
    assert.equal(await page.evaluate(() => globalThis.payClicks), 0)
    const pending = inspectCheckout(page, 'paris-padel', { cartTimeoutMs: 2000 })
    await page.evaluate(() => {
      setTimeout(() => {
        const total = [...globalThis.document.querySelectorAll('p')].find(p => p.textContent.startsWith('Total à payer'))
        total.textContent = 'Total à payer 70 €'
        globalThis.document.querySelector('#pay').textContent = 'Payer 70 €'
      }, 200)
    })
    assert.ok((await pending).summary.includes('Total à payer 70 €'))
    assert.equal(await page.evaluate(() => globalThis.payClicks), 0)
  } finally { await browser.close() }
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { chromium } from 'playwright'
import { previewBookingOffer } from '../lib/booking-preview.js'
import { searchBooking } from '../lib/booking-search.js'
import { TERMS_LABEL, installPaymentGuard, prepareStripeCheckout } from '../lib/checkout.js'

const clubs = [
  { id: 'paris-padel', name: 'Paris Padel', url: 'https://www.anybuddyapp.com/fr/club/paris-padel/padel' },
  { id: 'ucpa-paris', name: 'UCPA Sport Station Hostel Paris', url: 'https://www.anybuddyapp.com/fr/club/ucpa-paris/padel' },
  { id: 'sportfield-bercy', name: 'Sportfield Paris 12 - Bercy', url: 'https://www.anybuddyapp.com/fr/club/sportfield-bercy/padel' },
]
const request = { date: '21/09/2026', startTime: '20:00', durationsMinutes: [60, 90, 120], courtEnvironment: ['indoor', 'outdoor'], maxPricePerHourEUR: 80, clubs: clubs.map(club => club.id) }
const offer = (court, duration, price, environment = 'Intérieur') => ({ court, duration, price, environment })
const card = item => `<button data-testid="slot-court-option" data-court="${item.court}"><p>${item.court}</p><p><span>${item.environment}</span></p><span>${item.duration}min</span><span>${item.price} €</span></button>`
const summary = (club, item) => `<section data-testid="booking-sheet"><p>Confirmer et Payer</p><p>${club.name}</p><p>21 septembre 2026</p><p>20:00 (${item.duration} min)</p><div><p class="font-bold">${item.court}</p><p class="opacity-70">Double, ${item.environment}</p></div><p>Total à payer ${item.price} €</p><label><input type="checkbox">${TERMS_LABEL}</label><button id="pay">Payer ${item.price} €</button></section>`
const fixture = (club, offers, direct = false) => `<a href="/fr/compte">Compte</a><button id="time" aria-label="20:00, disponibles">20:00</button><div id="booking"></div><script>
const offers = ${JSON.stringify(offers)};
const sheets = ${JSON.stringify(Object.fromEntries(offers.map(item => [item.court, summary(club, item)])))};
const dialog = ${JSON.stringify('<div role="dialog">'+[60, 90, 120].map(duration => `<button data-duration="${duration}">${duration}min</button>`).join('')+'<div id="cards"></div><button data-testid="slot-selection-confirm" disabled>Valider</button></div>')};
const cards = ${JSON.stringify(Object.fromEntries([60, 90, 120].map(duration => [duration, offers.filter(item => item.duration === duration).map(card).join('')])))};
let selected;
globalThis.payClicks = 0;
globalThis.termsClicks = 0;
document.addEventListener('click', event => {
 if(event.target.closest('#time')) {
  if(${direct}) { document.querySelector('#booking').innerHTML=sheets[offers[0].court]; return; }
  document.querySelector('#booking').innerHTML=dialog;
  for(const button of document.querySelectorAll('[data-duration]')) button.disabled=!cards[button.dataset.duration];
  document.querySelector('#cards').innerHTML=cards[offers[0].duration];
 }
 if(event.target.dataset.duration) document.querySelector('#cards').innerHTML=cards[event.target.dataset.duration];
 const candidate=event.target.closest('[data-court]');
 if(candidate) { selected=candidate.dataset.court; document.querySelector('[data-testid="slot-selection-confirm"]').disabled=false; }
 if(event.target.closest('[data-testid="slot-selection-confirm"]')) document.querySelector('#booking').innerHTML=sheets[selected];
 if(event.target.closest('input')) globalThis.termsClicks++;
 if(event.target.closest('#pay')) {
  globalThis.payClicks++;
  document.querySelector('[data-testid="booking-sheet"]').innerHTML='<p>Entrez vos informations de paiement</p><iframe title="Cadre de saisie sécurisé pour le paiement" src="https://js.stripe.com/v3/fixture"></iframe><button id="pay">Payer</button>';
 }
});</script>`
const withBrowser = async run => {
  const browser = await chromium.launch()
  try {
    const context = await browser.newContext({ locale: 'fr-FR', timezoneId: 'Europe/Paris' })
    context.setDefaultTimeout(1500)
    await installPaymentGuard(context)
    await run(context)
  } finally { await browser.close() }
}

test('real browser flow tries courts, environments, durations and clubs in order, then stops without terms or Pay', () => withBrowser(async context => {
  const pages = [
    fixture(clubs[0], [offer('A60', 60, 81), offer('A90', 90, 121), offer('A120', 120, 161)]),
    fixture(clubs[1], [offer('Outdoor displayed first', 60, 70, 'Extérieur'), offer('Indoor preferred', 60, 90), offer('Longer indoor', 90, 100)]),
  ]
  await context.route('https://www.anybuddyapp.com/**', route => {
    const index = clubs.findIndex(club => route.request().url().startsWith(club.url))
    assert.ok(index >= 0 && index < 2, 'Third club must never be visited')
    return route.fulfill({ contentType: 'text/html; charset=utf-8', body: pages[index] })
  })
  const tried = []
  const fetched = []
  const result = await searchBooking(request, clubs, {
    now: new Date('2026-09-11T10:00:00Z'),
    fetchAvailability: async club => {
      fetched.push(club.id)
      return { slots: [{ startDateTime: '2026-09-21T20:00', durationMinutes: 60 }] }
    },
    attempt: async (club, normalized, options) => {
      const page = await context.newPage()
      try {
        return await previewBookingOffer(page, club, normalized, { ...options, onSelected: item => { tried.push(item.court); options.onSelected(item) } })
      } finally {
        assert.equal(await page.evaluate(() => globalThis.payClicks), 0)
        assert.equal(await page.evaluate(() => globalThis.termsClicks), 0)
        await page.close()
      }
    },
  })
  assert.equal(result.status, 'checkout_ready')
  assert.equal(result.result.court, 'Outdoor displayed first')
  assert.equal(result.result.pricePerHourEUR, 70)
  assert.deepEqual(tried, ['A60', 'A90', 'A120', 'Indoor preferred', 'Outdoor displayed first'])
  assert.deepEqual(fetched, ['paris-padel', 'ucpa-paris'])
}))

test('120 minutes at 120 EUR meets an 80 EUR/hour cap; a later price increase is rejected before Stripe', () => withBrowser(async context => {
  await context.route('https://www.anybuddyapp.com/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: fixture(clubs[0], [offer('Two hours', 120, 120)], true) }))
  const page = await context.newPage()
  const normalized = { ...request, date: '2026-09-21' }
  const result = await previewBookingOffer(page, clubs[0], normalized)
  assert.equal(result.court, 'Two hours')
  assert.equal(result.totalEUR, 120)
  assert.equal(result.pricePerHourEUR, 60)
  await page.getByText('Total à payer 120 €', { exact: true }).evaluate(element => { element.textContent = 'Total à payer 161 €' })
  await assert.rejects(prepareStripeCheckout(page, clubs[0].id, { durationsMinutes: [60, 90, 120], maxPricePerHourEUR: 80 }), { code: 'PRICE_LIMIT' })
  assert.equal(await page.evaluate(() => globalThis.payClicks), 0)
  assert.equal(await page.evaluate(() => globalThis.termsClicks), 0)
  await page.getByText('Total à payer 161 €', { exact: true }).evaluate(element => { element.textContent = 'Total à payer 160 €' })
  await context.route('https://js.stripe.com/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<button>Carte bancaire</button>' }))
  assert.equal((await prepareStripeCheckout(page, clubs[0].id, { durationsMinutes: [120], maxPricePerHourEUR: 80 })).stage, 'stripe_form')
  assert.equal(await page.evaluate(() => globalThis.payClicks), 1)
}))

test('strict indoor skips outdoor offers even when cheaper; excluded durations and direct over-budget checkout are rejected', () => withBrowser(async context => {
  let direct = false
  await context.route('https://www.anybuddyapp.com/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: fixture(clubs[0], direct ? [offer('Expensive direct', 90, 121)] : [offer('Cheap outdoor', 60, 30, 'Extérieur'), offer('Indoor 90', 90, 120), offer('Excluded 120', 120, 60)], direct) }))
  const page = await context.newPage()
  const strict = { ...request, date: '2026-09-21', durationsMinutes: [60, 90], courtEnvironment: ['indoor'] }
  const result = await previewBookingOffer(page, clubs[0], strict)
  assert.equal(result.court, 'Indoor 90')
  assert.equal(result.pricePerHourEUR, 80)
  direct = true
  await assert.rejects(previewBookingOffer(page, clubs[0], strict), { code: 'PRICE_LIMIT' })
  assert.equal(await page.evaluate(() => globalThis.payClicks), 0)
}))

import assert from 'node:assert/strict'
import test from 'node:test'
import { chromium } from 'playwright'
import { advanceUcpaFunnel, previewUcpaBooking, inspectUcpaSummary, normalizeUcpaRequest, selectUcpaSlot, ucpaPreviewRequestAllowed, installUcpaPreviewGuard } from '../lib/ucpa-booking.js'

const request = { date: '2026-09-21', startTime: '07:00', durationsMinutes: [60, 90], courtEnvironment: ['any'], maxPricePerHourEUR: 38 }
const selection = '<span>Lundi 21 septembre 2026</span><span>07:00 à 08:00</span>'
const summary = `Mon moyen de paiement
Capitaine
Non abonné(e)
Lundi 21 septembre 2026
07:00 à 08:00
Terrain 6 Padel HC
Padel
Ma participation:
9.50 €
Places réservées
1 / 4
Règlement le jour J
Garantie du Capitaine`

test('UCPA validates dates and preferences and does not combine adjacent sessions', () => {
  assert.equal(normalizeUcpaRequest({ ...request, date: '21/09/2026' }).date, '2026-09-21')
  for (const date of ['2026-02-30', '2026-09-31', '', undefined]) assert.throws(() => normalizeUcpaRequest({ ...request, date }))
  assert.throws(() => normalizeUcpaRequest({ ...request, durationsMinutes: [60, 60] }))
  const week = { slots: [60, 90].map(durationMinutes => ({ startDateTime: '2026-09-21T07:00', durationMinutes })) }
  assert.equal(selectUcpaSlot(week, { ...request, durationsMinutes: [90, 60] }).durationMinutes, 90)
  assert.equal(selectUcpaSlot(week, { ...request, durationsMinutes: [120] }), null)
  assert.equal(selectUcpaSlot(week, { ...request, startTime: '20:00' }), null)
})

test('UCPA compares the whole-court exposure, not the participation, with the hourly budget', () => {
  const price = inspectUcpaSummary(summary, request, 60, 'Terrain 6 Padel HC')
  assert.equal(price.participationEUR, 9.5)
  assert.equal(price.totalEUR, 38)
  assert.equal(price.withinBudget, true)
  assert.equal(inspectUcpaSummary(summary, { ...request, maxPricePerHourEUR: 37.99 }, 60, 'Terrain 6 Padel HC').withinBudget, false)
  const longer = summary.replace('07:00 à 08:00', '07:00 à 09:00').replace('9.50 €', '30 €')
  const twoHours = inspectUcpaSummary(longer, { ...request, maxPricePerHourEUR: 80 }, 120, 'Terrain 6 Padel HC')
  assert.equal(twoHours.totalEUR, 120)
  assert.equal(twoHours.pricePerHourEUR, 60)
  assert.equal(twoHours.withinBudget, true)
})

test('UCPA rejects changed recap, discounts and ambiguous pricing instead of understating the total', () => {
  for (const invalid of [summary.replace('21 septembre', '22 septembre'), summary.replace('07:00 à 08:00', '08:00 à 09:00'), summary.replace('Non abonné(e)', 'Abonné(e)'), summary.replace('1 / 4', '2 / 4'), summary.replace('9.50 €', 'inconnu'), `${summary}\nMa participation: 9.50 €`]) assert.throws(() => inspectUcpaSummary(invalid, request, 60, 'Terrain 6 Padel HC'))
  assert.throws(() => inspectUcpaSummary(summary, request, 60, 'Terrain 7 Padel HC'))
})

test('UCPA preview permits only observed read queries and blocks booking/card/payment mutations', () => {
  assert.equal(ucpaPreviewRequestAllowed('https://www.ucpa.com/loisirs-reservation/api/amplify/customerCards', 'POST'), true)
  for (const url of ['https://www.ucpa.com/loisirs-reservation/api/amplify/createBooking', 'https://www.ucpa.com/loisirs-reservation/api/amplify/registerCard', 'https://api.stripe.com/v1/payment_intents/pi_test/confirm', 'https://untrusted.test/loisirs-reservation/api/amplify/customerCards']) assert.equal(ucpaPreviewRequestAllowed(url, 'POST'), false)
})

const withFixture = async (run, { direct = false, disabled = false, checkedPromo = false, checkedTerms = false, amount = '9.50' } = {}) => {
  const browser = await chromium.launch()
  try {
    const context = await browser.newContext()
    context.setDefaultTimeout(2000)
    const initial = direct ? 'participants' : 'sessions'
    await context.route('https://www.ucpa.com/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<main></main><script>
const selection = ${JSON.stringify(selection)};
const summary = ${JSON.stringify(summary.replace('9.50', amount))};
globalThis.finalClicks = 0;
globalThis.termsClicks = 0;
globalThis.identityChecks = 0;
globalThis.participantNext = 0;
let court = 'Terrain 6 Padel HC';
const next = '<button class="${disabled ? 'disabled' : ''}">Étape suivante</button>';
function render(step) {
 history.replaceState(null, '', '/loisirs-reservation/reservation-terrain/' + step);
 const main = document.querySelector('main');
 if(step === 'sessions') main.innerHTML = '<div>Choisis ton terrain</div>' + selection + ['Terrain 6 Padel HC','Terrain 7 Padel HC'].map(name => '<div class="card-top pointer"><div>' + name + '</div></div>').join('') + next;
 if(step === 'participants') main.innerHTML = '<div>Ma participation</div>' + selection + '<p>' + court + '</p><input type="checkbox" ${checkedPromo ? 'checked' : ''}>' + next;
 if(step === 'payment') main.innerHTML = '<h1>Mon moyen de paiement</h1><div>' + summary.replaceAll('Terrain 6 Padel HC', court).split('\\n').map(line => '<p>' + line + '</p>').join('') + '</div><div class="priceCircle">${amount} €</div><input type="checkbox" id="cgi" ${checkedTerms ? 'checked' : ''}><button>Réserver</button>';
}
document.addEventListener('click', e => {
 const card = e.target.closest('.card-top');
 if(card) court = card.textContent;
 if(e.target.textContent === 'Étape suivante') {
  if(location.pathname.endsWith('/participants')) { globalThis.participantNext++; render('payment'); }
  else render('participants');
 }
 if(e.target.textContent === 'Réserver') globalThis.finalClicks++;
 if(e.target.id === 'cgi') globalThis.termsClicks++;
});
render('${initial}');
</script>` }))
    const page = await context.newPage()
    await page.goto(`https://www.ucpa.com/loisirs-reservation/reservation-terrain/${initial}`)
    await run(page, context)
    assert.equal(await page.evaluate(() => globalThis.finalClicks), 0)
    assert.equal(await page.evaluate(() => globalThis.termsClicks), 0)
  } finally { await browser.close() }
}

test('UCPA real browser selects first court, checks identity, stops with terms unchecked and never reserves', () => withFixture(async page => {
  let identityChecks = 0
  const result = await advanceUcpaFunnel(page, request, 60, { verifyIdentity: async () => { identityChecks++ } })
  assert.equal(identityChecks, 1)
  assert.equal(result.status, 'checkout_ready')
  assert.equal(result.court, 'Terrain 6 Padel HC')
  assert.equal(result.totalEUR, 38)
  assert.equal(result.reservationSubmitted, false)
  assert.equal(await page.locator('#cgi').isChecked(), false)
}))

test('UCPA takes the first indoor court and supports a single-court direct participant step', async () => {
  await withFixture(async page => {
    const result = await advanceUcpaFunnel(page, { ...request, courtEnvironment: ['indoor'] }, 60)
    assert.equal(result.court, 'Terrain 6 Padel HC')
    assert.equal(result.environment, 'indoor')
  })
  await withFixture(async page => {
    assert.equal((await advanceUcpaFunnel(page, request, 60)).status, 'checkout_ready')
  }, { direct: true })
})

test('UCPA rejects CSS-disabled next buttons, stale options, accepted terms and wrong identity', async () => {
  await withFixture(page => assert.rejects(advanceUcpaFunnel(page, request, 60), /disabled/), { disabled: true })
  await withFixture(page => assert.rejects(advanceUcpaFunnel(page, request, 60), /options already selected/), { checkedPromo: true })
  await withFixture(page => assert.rejects(advanceUcpaFunnel(page, request, 60), /unexpectedly accepted/), { checkedTerms: true })
  await withFixture(async page => {
    await assert.rejects(advanceUcpaFunnel(page, request, 60, { verifyIdentity: async () => { throw new Error('account mismatch') } }), /account mismatch/)
    assert.equal(await page.evaluate(() => globalThis.participantNext), 0)
  })
})

test('UCPA outdoor-only requests and excessive whole-court prices return no_match without submission', async () => {
  assert.equal((await previewUcpaBooking(null, { ...request, courtEnvironment: ['outdoor'] })).reason, 'environment_excluded')
  await withFixture(async page => assert.equal((await advanceUcpaFunnel(page, request, 60)).reason, 'price_limit'), { amount: '10' })
})

test('UCPA network guard blocks an actual unexpected POST in the browser', () => withFixture(async (page, context) => {
  await installUcpaPreviewGuard(context)
  const outcome = await page.evaluate(async () => {
    try { await fetch('/loisirs-reservation/api/amplify/createBooking', { method: 'POST' }); return 'sent' } catch { return 'blocked' }
  })
  assert.equal(outcome, 'blocked')
}))

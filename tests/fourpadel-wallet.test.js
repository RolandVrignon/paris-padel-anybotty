import assert from 'node:assert/strict'
import { test } from 'node:test'
import { chromium } from 'playwright'
import { bookFourPadelWallet, fourPadelEndpointMatches, fourPadelCreateMatches, fourPadelParticipationMatches, fourPadelCreditMatches, inspectFourPadelWalletSummary, fourPadelWalletKey } from '../lib/fourpadel-wallet.js'
import { providerScope } from '../lib/provider-session.js'

const email = 'test@example.com'
const scope = providerScope(email)
const request = { clubId: '4padel-saint-louis-bale', date: '2026-09-16', startTime: '14:00', durationsMinutes: [90], courtEnvironment: ['indoor'], maxPricePerHourEUR: 24 }
const offer = { ...request, status: 'checkout_ready', durationMinutes: 90, courtId: 375, court: 'ID Verde', environment: 'indoor', totalCents: 3600, totalEUR: 36, amountDueEUR: 36, parts: 4, accountUserId: 42 }
const create = { center: { id: 61 }, field: { id: 375 }, owner: { id: 42 }, localStartingDate: '2026-09-16T14:00:00.000Z', endingDate: '2026-09-16T15:30:00.000+00:00', duration: 90, capacity: 4, price: 36, sportType: { id: 3 }, paidCredit: 0, promoCode: null, booking_status: 'Pending' }
const participant = [{ booking: { id: 123 }, email, nbSlotPaid: 4, price: 36, paidBy: 42, isChannelWeb: true, promoCode: null, gymlibCode: null, offreItemMuchoMasId: null }]
const credit = { id: 456, status: 'Confirmed', isChannelWeb: true, paidByCredit: true, paidCreditAmount: 36, nbParticipations: 4, paidBy: 42, paymentLink: false, cartId: null }
const summary = '4PADEL Saint-Louis - Bâle en ID Verde\nle 16/09/2026\nde 14h00 à 15h30\n4 parts\n36.00€'
const reservation = { id: '123', centerId: 61, dateTime: '2026-09-16T14:00', durationMinutes: 90, totalEUR: 36, status: 'Confirmed', reservationConfirmed: true, paidParts: 4, fullyPaid: true }
const memoryStore = () => {
  const map = new Map()
  return { read: k => map.get(k), save: (k, v) => map.set(k, structuredClone(v)) }
}

test('wallet mutations bind the whole-court price, account, club, booking and four shares', () => {
  assert.equal(fourPadelCreateMatches(create, offer), true)
  assert.equal(fourPadelCreateMatches({ ...create, owner: { id: 43 } }, offer), false)
  assert.equal(fourPadelCreateMatches({ ...create, price: 40 }, offer), false)
  assert.equal(fourPadelParticipationMatches(participant, offer, '123', scope), true)
  assert.equal(fourPadelParticipationMatches([{ ...participant[0], booking: { id: 124 } }], offer, '123', scope), false)
  assert.equal(fourPadelParticipationMatches(participant, offer, '123', providerScope('other@example.com')), false)
  assert.equal(fourPadelCreditMatches(credit, offer, 456), true)
  for (const patch of [{ id: 457 }, { paidByCredit: false }, { paidCreditAmount: 37 }, { nbParticipations: 1 }, { paidBy: 43 }, { cartId: 1 }]) assert.equal(fourPadelCreditMatches({ ...credit, ...patch }, offer, 456), false)
  inspectFourPadelWalletSummary(summary, offer)
  assert.throws(() => inspectFourPadelWalletSummary(summary.replace('36.00', '40.00'), offer))
})

test('native wallet flow pays four shares with no card endpoint, reconciles, and never repeats a journalled payment', async () => {
  const browser = await chromium.launch()
  const context = await browser.newContext({ serviceWorkers: 'block' })
  const writes = []
  const created = { id: 123, owner: { id: 42, email }, sportType: { id: 3 }, center: { id: 61, centerName: 'LE FIVE Saint-Louis - Bâle' }, field: { id: 375, name: 'ID Verde' }, startingDateZuluTime: '2026-09-16T12:00:00Z', duration: 90, price: 36, capacity: 4, booking_status: 'Pending' }
  const script = `
    const api='https://api-front.lefive.fr/splf/v1';
    async function send(path,method,body){return fetch(api+path,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});}
    document.querySelector('button').onclick=async()=>{
      await send('/bookings?appId=2&isChannelWeb=true','PUT',${JSON.stringify(create)});
      history.pushState({},'', '/paiement/method?bookingId=123');
      document.body.innerHTML='<pre>'+${JSON.stringify(summary)}+'</pre><button>je paye avec mon solde</button>';
      document.querySelector('button').onclick=()=>{
        document.body.innerHTML+='<h2>Confirmation de paiement</h2><p>Souhaitez-vous régler avec votre solde ? Confirmez-vous ?</p><button id="confirm">OK</button>';
        document.querySelector('#confirm').onclick=async()=>{
          await send('/userparticipations?appId=2&isChannelWeb=true&paymentLink=true&paidByCredit=true&paidCreditAmount=36&paidBy=42','PUT',${JSON.stringify(participant)});
          await send('/userparticipations/456/status','POST',${JSON.stringify(credit)});
          history.pushState({},'', '/paiement/confirmation');
        };
      };
    };`
  await context.route('**/*', route => {
    const r = route.request()
    const path = new URL(r.url()).pathname
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,PUT,POST,OPTIONS' }
    if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
    if (r.method() === 'GET') return route.fulfill({ headers, contentType: 'text/html', body: `<meta charset="utf-8"><button>Payer maintenant 36.00€</button><script>${script}</script>` })
    writes.push(path)
    if (path === '/splf/v1/bookings') return route.fulfill({ headers, contentType: 'application/json', body: JSON.stringify(created) })
    if (path === '/splf/v1/userparticipations') return route.fulfill({ headers, contentType: 'application/json', body: '[{"id":456}]' })
    if (path === '/splf/v1/userparticipations/456/status') return route.fulfill({ headers, status: 204 })
    throw new Error('Unexpected mutation reached server')
  })
  let lists = 0
  let wallets = 0
  let previews = 0
  const store = memoryStore()
  const options = {
    confirm: true,
    readWallet: async () => ({ balanceEUR: wallets++ ? 83 : 119 }),
    readReservations: async () => ({ reservations: lists++ ? [reservation] : [] }),
    preview: async (page, request, opts) => {
      previews++
      assert.equal(opts.parts, 4)
      await page.goto('https://www.4padel.fr/paiement/plusieurs')
      return offer
    },
  }
  try {
    const session = { context, accountScope: scope }
    const result = await bookFourPadelWallet(session, store, request, options)
    assert.equal(result.status, 'booked')
    assert.equal(result.creditDebitObserved, true)
    assert.deepEqual(writes, ['/splf/v1/bookings', '/splf/v1/userparticipations', '/splf/v1/userparticipations/456/status'])
    assert.equal(store.read(fourPadelWalletKey(request)).participationId, 456)
    const again = await bookFourPadelWallet(session, store, request, options)
    assert.equal(again.status, 'booked')
    assert.equal(previews, 1)
    assert.equal(writes.length, 3)
  } finally { await browser.close() }
})

test('insufficient credit stops before creating a booking, without a card fallback', async () => {
  const browser = await chromium.launch()
  const context = await browser.newContext()
  try {
    const result = await bookFourPadelWallet({ context, accountScope: scope }, memoryStore(), request, { confirm: true, readReservations: async () => ({ reservations: [] }), readWallet: async () => ({ balanceEUR: 35.99 }), preview: async () => offer })
    assert.equal(result.status, 'insufficient_wallet_balance')
    assert.equal(result.submitted, false)
  } finally { await browser.close() }
})


test('wallet endpoint checks preserve the native query parameters and reject a changed credit amount', () => {
  const params = { appId: 2, isChannelWeb: true, paymentLink: true, paidByCredit: true, paidCreditAmount: 36, paidBy: 42 }
  const url = 'https://api-front.lefive.fr/splf/v1/userparticipations?' + new URLSearchParams(params)
  assert.equal(fourPadelEndpointMatches(url, '/userparticipations', params), true)
  assert.equal(fourPadelEndpointMatches(url.replace('paidCreditAmount=36', 'paidCreditAmount=40'), '/userparticipations', params), false)
  assert.equal(fourPadelEndpointMatches(url + '&extra=true', '/userparticipations', params), false)
})

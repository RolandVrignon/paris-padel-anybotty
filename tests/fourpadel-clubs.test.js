import test from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { fourPadelCatalog, validateFourPadelCatalog, fourPadelLocalTime, applyFourPadelTimeZone } from '../lib/fourpadel-clubs.js'
import { normalizeFourPadelRequest, selectFourPadelOffer } from '../lib/fourpadel-booking.js'
import { calculateSchedule } from '../lib/booking-schedule.js'
import { discoverFourPadelClubs } from '../lib/fourpadel-club-discovery.js'
import { normalizeFourPadelReservations } from '../lib/fourpadel-account.js'
import { providerScope } from '../lib/provider-session.js'
import { inspectFourPadelCancellation } from '../lib/fourpadel-cancellation.js'

const request = { date: '21/09/2026', startTime: '20:00', durationsMinutes: [90], courtEnvironment: ['indoor'], maxPricePerHourEUR: 80 }

test('all native centres are selectable and schedulable, keeping historical identifiers', () => {
  assert.equal(fourPadelCatalog.centers.length, 36)
  assert.equal(fourPadelCatalog.centers.find(c => c.centerId === 105).id, '4padel-boulogne')
  for (const club of fourPadelCatalog.centers) {
    assert.equal(normalizeFourPadelRequest({ ...request, clubId: club.id }).clubId, club.id)
    const plan = calculateSchedule({ provider: '4padel', mode: 'pay', request: { ...request, clubs: [club.id] }, opening: { mode: 'daily', horizonDays: 1, localTime: '08:00', source: 'user_instruction', evidence: 'Test rule' } }, [], { now: new Date('2026-09-13T00:00:00Z') })
    assert.equal(plan.request.clubs[0], club.id)
    assert.equal(plan.timeZone, club.timeZone)
    assert.equal(plan.openingAt, club.timeZone === 'Indian/Reunion' ? '2026-09-20T04:00:00.000Z' : '2026-09-20T06:00:00.000Z')
  }
  assert.throws(() => normalizeFourPadelRequest({ ...request, clubId: '4padel-nonexistent' }), /clubs/)
})

test('invalid or ambiguous catalogues cannot replace the native IDs', () => {
  const club = fourPadelCatalog.centers[0]
  for (const centers of [[], [club, club], [{ ...club, url: 'https://example.com/nos-centres/115/foo' }], [{ ...club, centerId: 105 }], [{ ...club, timeZone: 'guess' }], [{ ...club, name: 'Squash' }]]) {
    assert.throws(() => validateFourPadelCatalog({ ...fourPadelCatalog, centers }))
  }
})

test('Reunion availability and account times use the club time rather than Paris time', () => {
  const rows = [{ startingDateZuluTime: '2026-09-21T16:00:00Z', duration: 90, fields: [{ id: 52, name: 'Piste 1', center: { id: 52 }, fieldType: { name: 'Intérieur' }, canBookOnline: true, webPrice: 60 }] }]
  const offer = selectFourPadelOffer(rows, { ...request, clubId: '4padel-saint-louis-la-reunion' })
  assert.equal(offer.startTime, '20:00')
  assert.equal(fourPadelLocalTime('2026-09-21T21:00:00Z', 52).slice(0, 16), '2026-09-22T01:00')
  const booking = { id: 1, owner: { email: 'fixture@example.com' }, sportType: { id: 3 }, center: { id: 52, centerName: '4PADEL Saint-Louis - La Réunion' }, field: { name: 'Piste 1' }, startingDateZuluTime: rows[0].startingDateZuluTime, duration: 90, price: 60, booking_status: 'Confirmed' }
  const reservation = normalizeFourPadelReservations([booking], providerScope('fixture@example.com'))[0]
  assert.equal(reservation.dateTime, '2026-09-21T20:00')
  const terms = 'Confirmez-vous l\'annulation de la réservation prévue le 21/09/2026 à 20h00 sur Piste 1 au centre 4PADEL Saint-Louis - La Réunion ? Un remboursement sera effectué en cas d\'annulation dans les délais. Annulable jusqu\'à 19/09/2026 20h00'
  assert.throws(() => inspectFourPadelCancellation(terms, reservation, new Date('2026-09-19T16:00:00Z')), /deadline/)
  assert.equal(inspectFourPadelCancellation(terms, reservation, new Date('2026-09-19T15:59:00Z')).cutoff, '2026-09-19T20:00')
})

test('public catalogue refresh ignores squash and keeps an existing alias by native ID', async t => {
  const browser = await chromium.launch()
  t.after(() => browser.close())
  const context = await browser.newContext()
  await context.route('**/*', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><meta charset="utf-8">
  <div class="lf-local-bar-center-info"><img alt="4Padel club" onclick="document.getElementById('centers-dropdown-modal').hidden=false"></div>
  <div class="lf-local-bar-center-info-btns"><a id="current" href="/nos-centres/105/club"><div class="lf-local-bar-info-btn">4PADEL Boulogne-Billancourt</div></a></div>
  <div id="centers-dropdown-modal" hidden><div class="lf-centers-dropdown-item"><p class="lf-region-title">Île-de-France</p>
  <p class="lf-center-name" onclick="choose(105,'4PADEL Boulogne-Billancourt')"><span>4PADEL Boulogne-Billancourt</span></p>
  <p class="lf-center-name" onclick="choose(25,'4PADEL Créteil')"><span>4PADEL Créteil</span></p>
  <p class="lf-center-name"><span>Squash (LE FIVE Pau)</span></p></div></div>
  <script>function choose(id,name){document.getElementById('current').href='/nos-centres/'+id+'/club';document.querySelector('.lf-local-bar-info-btn').textContent=name;document.getElementById('centers-dropdown-modal').hidden=true}</script>` }))
  const page = await context.newPage()
  const discovered = await discoverFourPadelClubs(page, { ...fourPadelCatalog, centers: fourPadelCatalog.centers.filter(c => c.centerId === 105) })
  assert.deepEqual(discovered.centers.map(c => c.id), ['4padel-boulogne', '4padel-creteil'])
  assert.deepEqual(discovered.centers.map(c => c.centerId), [105, 25])
  await applyFourPadelTimeZone(page, 52)
  assert.equal(await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone), 'Indian/Reunion')
  await applyFourPadelTimeZone(page, 105)
  assert.equal(await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone), 'Europe/Paris')
})

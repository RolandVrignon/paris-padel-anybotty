import assert from 'node:assert/strict'
import { test } from 'node:test'
import { PLAYTOMIC_CLUBS, validatePlaytomicCatalog } from '../lib/playtomic-clubs.js'
import { fetchPlaytomicDay, normalizePlaytomicDay, playtomicCheckoutUrl } from '../lib/playtomic-availability.js'
import { previewPlaytomicBooking } from '../lib/playtomic-booking.js'

const club = PLAYTOMIC_CLUBS['casa-padel-asnieres']
const resourceId = '89440b06-d454-48fa-aa3f-5634f29f4f00'
const rows = [{ resource_id: resourceId, start_date: '2026-09-27', slots: [
  { start_time: '11:00:00', duration: 90, price: '84 EUR' },
  { start_time: '12:30:00', duration: 60, price: '60 EUR' },
] }]

test('Playtomic catalogue contains the two exact Casa Padel links', () => {
  assert.deepEqual(Object.keys(PLAYTOMIC_CLUBS), ['casa-padel-asnieres', 'casa-padel-saint-denis'])
  assert.equal(PLAYTOMIC_CLUBS['casa-padel-saint-denis'].resourceCount, 12)
  assert.throws(() => validatePlaytomicCatalog([{ ...club, tenantId: 'bad' }]), /invalid/)
})

test('Playtomic availability groups courts and validates prices', () => {
  const result = normalizePlaytomicDay([...rows, { ...rows[0], resource_id: '21898e99-4885-4384-8be3-f65da42a0441' }], '2026-09-27', club)
  assert.equal(result.length, 2)
  assert.equal(result[0].offers.length, 2)
  assert.equal(result[0].offers[0].priceCents, 8400)
  assert.throws(() => normalizePlaytomicDay([{ ...rows[0], start_date: '2026-09-28' }], '2026-09-27', club), /format/)
  assert.throws(() => normalizePlaytomicDay([{ ...rows[0], slots: [{ ...rows[0].slots[0], price: '84 USD' }] }], '2026-09-27', club), /price/)
})

test('Playtomic public request is scoped to one tenant, date and padel', async () => {
  let requested
  const slots = await fetchPlaytomicDay(club, '2026-09-27', { fetchImpl: async (url, options) => {
    requested = { url: String(url), options }
    return new Response(JSON.stringify(rows), { headers: { 'Content-Type': 'application/json' } })
  } })
  assert.equal(slots.length, 2)
  const url = new URL(requested.url)
  assert.equal(url.origin, 'https://playtomic.com')
  assert.equal(url.pathname, '/api/clubs/availability')
  assert.equal(url.searchParams.get('tenant_id'), club.tenantId)
  assert.equal(url.searchParams.get('sport_id'), 'PADEL')
  assert.equal(requested.options.redirect, 'error')
})

test('Playtomic preview respects duration order and hourly price without submitting', async () => {
  const result = await previewPlaytomicBooking({ clubId: club.id, date: '2026-09-27', startTime: '11:00', durationsMinutes: [60, 90], maxPricePerHourEUR: 60 }, {
    fetchImpl: async () => new Response(JSON.stringify(rows)),
  })
  assert.equal(result.status, 'preview')
  assert.equal(result.durationMinutes, 90)
  assert.equal(result.pricePerHourEUR, 56)
  assert.equal(result.paymentSubmitted, false)
  assert.equal(result.reservationCreated, false)
  const url = new URL(result.checkoutUrl)
  assert.equal(url.pathname, '/api/web-app/payments')
  assert.equal(url.searchParams.get('start'), '2026-09-27T09:00:00.000Z')
  assert.equal(url.searchParams.get('resource_id'), resourceId)
  assert.match(playtomicCheckoutUrl(club, { resourceId, startDateTime: '2026-12-27T11:00', durationMinutes: 90 }), /start=2026-12-27T10%3A00/)
})

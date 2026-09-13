import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createUcpaAccountClient, normalizeUcpaReservation } from '../lib/ucpa-account.js'
import { previewUcpaBooking, ucpaPreviewRequestAllowed } from '../lib/ucpa-booking.js'
import { ucpaBookingKey } from '../lib/ucpa-actions.js'
import { DEFAULT_UCPA_CENTER, resolveUcpaCenter, ucpaAccountApi, ucpaIdentityUrl } from '../lib/ucpa-centers.js'

const meudon = resolveUcpaCenter('ucpa-meudon')
const reply = body => ({ ok: () => true, status: () => 200, json: async () => body })
const request = { date: '2099-09-21', startTime: '07:00', durationsMinutes: [60], courtEnvironment: ['outdoor'], maxPricePerHourEUR: 50 }

test('UCPA centers bind public, account and cancellation routes to the selected club', () => {
  assert.equal(meudon.padelUrl, 'https://www.ucpa.com/sport-station/meudon/padel')
  assert.equal(ucpaAccountApi(meudon), 'https://www.ucpa.com/sport-station/espacepersonnel/api/meudon')
  assert.equal(ucpaIdentityUrl(meudon), 'https://www.ucpa.com/sport-station/espacepersonnel/api/meudon/user')
  assert.throws(() => resolveUcpaCenter('ucpa-other'), /Unknown UCPA club/)
  assert.equal(ucpaBookingKey(request, DEFAULT_UCPA_CENTER), 'book-2099-09-21-0700')
  assert.equal(ucpaBookingKey(request, meudon), 'ucpa-meudon-book-2099-09-21-0700')
  assert.equal(ucpaPreviewRequestAllowed(`${ucpaAccountApi(meudon)}/amplify/kala/reservedSession`, 'POST', meudon), true)
  assert.equal(ucpaPreviewRequestAllowed(`${ucpaAccountApi(DEFAULT_UCPA_CENTER)}/amplify/kala/reservedSession`, 'POST', meudon), false)
})

test('Meudon account reads use its own site identity and label reservations correctly', async () => {
  const calls = []
  const context = { request: {
    get: async url => {
      calls.push(url)
      if (url.endsWith('/site')) return reply({ success: true, data: { workspace: 'alpha_meu', code_site_comptage: '400000636', is_internal_session: false } })
      return reply({ success: true, data: { uuid: 'customer_fixture', horanet_id: 'horanet_id_fixture', email: 'fixture@example.test' } })
    },
    post: async url => {
      calls.push(url)
      return reply({ success: true, data: [{ uuid: 'horanet_id_fixture', sessions: [] }] })
    },
  } }
  const client = await createUcpaAccountClient(context, { center: meudon })
  assert.deepEqual(await client.list(), [])
  assert.ok(calls.every(url => url.includes('/api/meudon/')))
  assert.equal(client.cancelUrl, `${ucpaAccountApi(meudon)}/cancel-court-session`)
  const raw = { id: '1', name: 'Terrain Padel 1', isTerrainSession: true, start_time: Date.parse('2099-09-21T05:00:00Z') / 1000, end_time: Date.parse('2099-09-21T06:00:00Z') / 1000 - 1, max_participant: 4, captain: { horanet_id: 'horanet_id_fixture' }, sessionBooking: { price: 1250, offerFilliere: 'Padel', haveSubscription: false } }
  const row = normalizeUcpaReservation(raw, 'customer_fixture', { contactId: 'horanet_id_fixture', center: meudon })
  assert.equal(row.clubId, 'ucpa-meudon')
  assert.equal(row.club, 'UCPA Sport Station Meudon')
})

test('Meudon preview rejects outdoor-only requests before opening a browser checkout', async () => {
  const result = await previewUcpaBooking(null, request, { center: meudon })
  assert.equal(result.clubId, 'ucpa-meudon')
  assert.equal(result.reason, 'environment_excluded')
})

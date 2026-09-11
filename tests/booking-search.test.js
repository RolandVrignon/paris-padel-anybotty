import assert from 'node:assert/strict'
import test from 'node:test'
import { searchBooking } from '../lib/booking-search.js'
import { offerKey } from '../lib/court-selection.js'

const clubs = ['a', 'b', 'c'].map(id => ({ id, name: id }))
const input = { date: '21/09/2026', startTime: '20:00', clubs: ['b', 'a', 'c'], durationsMinutes: [60, 90, 120], courtEnvironment: ['indoor', 'outdoor'], maxPricePerHourEUR: 80 }
const now = new Date('2026-09-11T10:00:00Z')
const available = async () => ({ slots: [{ startDateTime: '2026-09-21T20:00', durationMinutes: 120 }] })
const success = { stage: 'checkout_ready', paymentSubmitted: false, reservationConfirmed: false }

test('search respects club priority and exits immediately at the first successful preview', async () => {
  const visited = []
  const result = await searchBooking(input, clubs, { now, fetchAvailability: async (club, window) => {
    visited.push(`fetch:${club.id}`)
    assert.deepEqual(window, { from: '2026-09-21', to: '2026-09-21' })
    return club.id === 'b' ? { slots: [] } : available()
  }, attempt: async (club, request) => {
    visited.push(`attempt:${club.id}`)
    assert.deepEqual(request.durationsMinutes, [60, 90, 120])
    assert.deepEqual(request.courtEnvironment, ['indoor', 'outdoor'])
    assert.equal(request.maxPricePerHourEUR, 80)
    return success
  } })
  assert.equal(result.status, 'checkout_ready')
  assert.deepEqual(visited, ['fetch:b', 'fetch:a', 'attempt:a'])
  assert.equal(result.reservationConfirmed, false)
})

test('overpriced or failed offers are excluded and retried within the same club before moving on', async () => {
  const seen = []
  const selected = { court: 'A', durationMinutes: 60 }
  const result = await searchBooking(input, clubs, { now, fetchAvailability: available, attempt: async (club, request, { excludedOffers, onSelected }) => {
    seen.push([club.id, excludedOffers])
    if (club.id === 'b' && excludedOffers.length === 0) {
      onSelected(selected)
      throw Object.assign(new Error('Budget'), { code: 'PRICE_LIMIT', price: { totalEUR: 90 } })
    }
    if (club.id === 'b') throw Object.assign(new Error('Exhausted'), { code: 'NO_MATCHING_OFFER' })
    return success
  } })
  assert.equal(result.status, 'checkout_ready')
  assert.deepEqual(seen, [['b', []], ['b', [offerKey(selected)]], ['a', []]])
  assert.equal(result.events[0].status, 'over_budget')
})

test('no_match means no compatible offer, while technical failures remain incomplete', async () => {
  assert.equal((await searchBooking(input, clubs, { now, fetchAvailability: async () => ({ slots: [] }), attempt: () => assert.fail('No browser needed') })).status, 'no_match')
  const result = await searchBooking(input, clubs, { now, fetchAvailability: available, attempt: async () => { throw new Error('secret must not reach report') } })
  assert.equal(result.status, 'incomplete')
  assert.ok(!JSON.stringify(result).includes('secret'))
})

test('access restrictions and expired sessions stop subsequent clubs', async () => {
  for (const httpStatus of [401, 403, 429]) {
    let calls = 0
    const result = await searchBooking(input, clubs, { now, fetchAvailability: async () => { calls++; throw Object.assign(new Error('HTTP'), { httpStatus, retryAfterMs: 90000 }) }, attempt: () => assert.fail() })
    assert.equal(calls, 1)
    assert.equal(result.status, 'blocked')
    assert.equal(result.retryAfterMs, 90000)
  }
  let attempts = 0
  const result = await searchBooking(input, clubs, { now, fetchAvailability: available, attempt: async () => { attempts++; throw Object.assign(new Error('Session'), { code: 'SESSION_EXPIRED' }) } })
  assert.equal(result.status, 'blocked')
  assert.equal(attempts, 1)
})

test('search does not contact clubs for past requests or invalid price configuration', async () => {
  const dependencies = { now, fetchAvailability: () => assert.fail(), attempt: () => assert.fail() }
  await assert.rejects(searchBooking({ ...input, date: '10/09/2026' }, clubs, dependencies), /past/)
  await assert.rejects(searchBooking({ ...input, date: '11/09/2026', startTime: '11:59' }, clubs, dependencies), /past/)
  await assert.rejects(searchBooking({ ...input, maxPricePerHourEUR: -1 }, clubs, dependencies), /maxPricePerHourEUR/)
})

test('a changing offer list is bounded and repeated offers cannot cause an infinite retry', async () => {
  let count = 0
  const result = await searchBooking({ ...input, clubs: ['a'] }, clubs, { now, maxAttemptsPerClub: 3, fetchAvailability: available, attempt: async (club, request, { onSelected }) => {
    onSelected({ durationMinutes: 60, court: `Court ${count++}` })
    throw Object.assign(new Error('Budget'), { code: 'PRICE_LIMIT' })
  } })
  assert.equal(count, 3)
  assert.equal(result.status, 'incomplete')
  assert.equal(result.events.at(-1).status, 'attempt_limit')
  count = 0
  const repeated = await searchBooking({ ...input, clubs: ['a'] }, clubs, { now, fetchAvailability: available, attempt: async (club, request, { onSelected }) => {
    count++
    onSelected({ durationMinutes: 60, court: 'Same' })
    throw new Error('Failed')
  } })
  assert.equal(count, 2)
  assert.equal(repeated.status, 'incomplete')
})


test('failure after selecting a court can fall back to another offer before leaving the club', async () => {
  const chosen = { court: 'Sold out', durationMinutes: 60 }
  let attempts = 0
  const result = await searchBooking({ ...input, clubs: ['a'] }, clubs, { now, fetchAvailability: available, attempt: async (club, request, options) => {
    attempts++
    if (attempts === 1) {
      options.onSelected(chosen)
      throw new Error('Cart creation failed')
    }
    assert.deepEqual(options.excludedOffers, [offerKey(chosen)])
    return success
  } })
  assert.equal(result.status, 'checkout_ready')
  assert.equal(attempts, 2)
  assert.equal(result.events[0].status, 'preview_error')
})

test('real search stops at a successful or uncertain payment before trying another club', async () => {
  for (const status of ['booked', 'payment_unverified', 'payment_failed', 'payment_action_required']) {
    let attempts = 0
    const result = await searchBooking(input, clubs, { now, mode: 'pay', fetchAvailability: available, attempt: async () => {
      attempts++
      return { status, paymentSubmitted: true, reservationConfirmed: status === 'booked' }
    } })
    assert.equal(result.status, status)
    assert.equal(attempts, 1)
  }
})

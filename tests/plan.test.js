import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { buildPlan, validateRequest } from '../lib/plan.js'
const catalog = JSON.parse(readFileSync(new URL('../data/clubs.json', import.meta.url)))
const request = JSON.parse(readFileSync(new URL('../config.json.sample', import.meta.url)))

test('all nine observations agree with their calendar-day horizons', () => {
  assert.equal(catalog.length, 9)
  for (const club of catalog) {
    const days = (Date.parse(club.observation.lastAvailableDate) - Date.parse(club.observation.date)) / 86400000
    assert.equal(club.observation.horizonDays, days)
    assert.equal(club.opening.verified, false)
    assert.equal(club.opening.localTime, null)
  }
})
test('September 21 planning separates already open estimates and future releases', () => {
  const plan = buildPlan(request, catalog, { now: '2026-09-11T15:00:00+02:00' })
  assert.deepEqual(plan.checkNow.map(club => club.id), ['sportfield-bercy', 'trinquet-village'])
  assert.deepEqual(plan.upcoming.map(club => club.theoreticalOpeningDate), ['2026-09-13', '2026-09-13', '2026-09-13', '2026-09-15', '2026-09-16', '2026-09-18', '2026-09-20'])
  assert.equal(plan.mode, 'planning_only')
  assert.deepEqual(plan.request.durationsMinutes, [60, 90])
})
test('calendar dates remain Paris dates when UTC is on the previous day', () => {
  const plan = buildPlan(request, catalog, { now: '2026-09-12T22:30:00Z' })
  assert.ok(plan.checkNow.some(club => club.id === 'paris-padel'))
})
test('duration choices and account-free request validation', () => {
  for (const duration of [[60], [90], [120], [60, 90], [60, 90, 120], [120, 60, 90]]) assert.deepEqual(validateRequest({ ...request, durationsMinutes: duration }, catalog).durationsMinutes, duration)
  assert.throws(() => validateRequest({ ...request, durationsMinutes: [45] }, catalog), /durationsMinutes/)
  assert.throws(() => validateRequest({ ...request, clubs: ['unknown'] }, catalog), /club IDs/)
  assert.throws(() => validateRequest({ ...request, account: { password: 'fixture' } }, catalog), /Unsupported field/)
  assert.throws(() => validateRequest({ ...request, maxTotalPriceEUR: -1 }, catalog), /positive/)
})


test('planning preserves the requested court environment without pretending to verify availability', () => {
  for (const courtEnvironment of [['any'], ['indoor'], ['outdoor'], ['indoor', 'outdoor'], ['outdoor', 'indoor']]) assert.deepEqual(validateRequest({ ...request, courtEnvironment }, catalog).courtEnvironment, courtEnvironment)
  assert.deepEqual(validateRequest({ ...request, courtEnvironment: undefined }, catalog).courtEnvironment, ['any'])
  for (const courtEnvironment of ['covered', null, false]) assert.throws(() => validateRequest({ ...request, courtEnvironment }, catalog), /courtEnvironment/)
})

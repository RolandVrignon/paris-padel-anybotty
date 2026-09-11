import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { compareSnapshots, failureRecord, fetchAvailability, nextRecord, normalizeAvailability, queryWindow } from '../lib/availability.js'
import { acquireLock, latestRecord, saveRecord, pruneRecords } from '../lib/observation-store.js'

const club = { id: 'test', name: 'Test', url: 'https://www.anybuddyapp.com/fr/club/test/padel' }
const slot = (date, time = '20:00', duration = 60) => ({ startDateTime: `${date}T${time}`, durationMinutes: duration, offers: [] })
const snapshot = (time, slots, to = '2026-10-16') => ({ startedAt: time, finishedAt: new Date(Date.parse(time) + 1000).toISOString(), window: { from: '2026-09-11', to }, slots })
const first = snapshot('2026-09-11T06:00:00Z', [slot('2026-09-19')])
const second = snapshot('2026-09-11T06:05:00Z', [slot('2026-09-19'), slot('2026-09-20')])

test('new day appearance has a measured interval, while the first poll is only a baseline', () => {
  assert.deepEqual(compareSnapshots(null, first), [])
  const [event] = compareSnapshots(first, second)
  assert.equal(event.type, 'new_day_candidate')
  assert.equal(event.targetDate, '2026-09-20')
  assert.equal(event.lastValidAbsentAt, first.startedAt)
  assert.equal(event.intervalSeconds, 301)
  assert.match(event.firstAvailableParis, /08:05:01\+02:00$/)
  assert.equal(event.interpretation, 'unverified')
})

test('errors preserve last successful evidence and widen the opening interval', () => {
  const previous = nextRecord(club, null, first)
  const failed = failureRecord(club, previous, new Error('Network down'), new Date('2026-09-11T06:05:00Z'))
  assert.equal(failed.snapshot, first)
  assert.deepEqual(failed.events, [])
  assert.equal(failed.nextRetryAt, '2026-09-11T06:10:00.000Z')
  const recovered = nextRecord(club, failed, snapshot('2026-09-11T06:10:00Z', second.slots))
  assert.equal(recovered.events[0].intervalSeconds, 601)
  assert.equal(recovered.failures, 0)
})

test('returning slots and rolling additions are not automatically daily openings', () => {
  const before = nextRecord(club, null, second)
  const lost = nextRecord(club, before, first)
  assert.equal(lost.events[0].type, 'slots_removed')
  const restored = nextRecord(club, lost, second)
  assert.equal(restored.events[0].type, 'slots_added')
  const moreHours = snapshot('2026-09-11T06:10:00Z', [slot('2026-09-19'), slot('2026-09-19', '21:00')])
  assert.equal(compareSnapshots(first, moreHours)[0].type, 'slots_added')
})

test('extending the scanned window cannot establish when a new day opened', () => {
  const narrow = { ...first, window: { ...first.window, to: '2026-09-19' } }
  const [event] = compareSnapshots(narrow, second)
  assert.equal(event.type, 'first_seen_outside_previous_window')
  assert.equal(event.lastValidAbsentAt, null)
  assert.equal(event.intervalSeconds, null)
})

test('an empty valid response is distinct from malformed content', () => {
  assert.deepEqual(normalizeAvailability({ data: [] }, first.window), [])
  assert.throws(() => normalizeAvailability({ error: 'bad gateway' }, first.window))
  assert.throws(() => normalizeAvailability({ data: [{ startDateTime: 'nonsense', services: [] }] }, first.window))
  assert.throws(() => normalizeAvailability({ data: [{ startDateTime: '2026-09-10T20:00', services: [] }] }, first.window))
})

test('service ID changes do not produce opening events; all durations are kept', () => {
  const body = { data: [{ startDateTime: '2026-09-19T20:00', services: [{ id: 'a', duration: 120, price: 8000 }, { id: 'b', duration: 120, price: 8500 }, { id: 'c', duration: 60, price: 5000 }] }] }
  const normalized = normalizeAvailability(body, first.window)
  assert.equal(normalized.length, 2)
  assert.equal(normalized.find(s => s.durationMinutes === 120).offers.length, 2)
  const changed = structuredClone(normalized)
  changed[0].offers[0].serviceId = 'different-id'
  assert.deepEqual(compareSnapshots({ ...first, slots: normalized }, { ...second, slots: changed }), [])
})

test('calendar window uses Paris midnight including DST transitions', () => {
  assert.equal(queryWindow('2026-09-11T22:01:00Z').from, '2026-09-12')
  assert.deepEqual(queryWindow('2026-10-24T22:01:00Z'), { from: '2026-10-25', to: '2026-11-29' })
})

test('collector uses the public GET endpoint, rejects HTTP failures and stale responses', async () => {
  const fetchImpl = async (url, options) => {
    assert.equal(url.pathname, '/api/v1/availabilities')
    assert.equal(url.searchParams.get('clubSlug'), 'test')
    assert.equal(url.searchParams.get('activity'), 'padel')
    assert.equal(options.redirect, 'error')
    return new Response(JSON.stringify({ data: [] }), { headers: { 'cache-control': 'no-store' } })
  }
  assert.deepEqual((await fetchAvailability(club, first.window, { fetchImpl })).slots, [])
  await assert.rejects(fetchAvailability(club, first.window, { fetchImpl: async () => new Response('', { status: 429, headers: { 'Retry-After': '900' } }) }), error => error.httpStatus === 429 && error.retryAfterMs === 900000)
  await assert.rejects(fetchAvailability(club, first.window, { fetchImpl: async () => new Response('{"data":[]}', { headers: { age: '60' } }) }), /Cached response/)
})

test('rate-limit delay is respected and error evidence never invents an opening', () => {
  const error = Object.assign(new Error('limited'), { httpStatus: 429, retryAfterMs: 7200000 })
  const record = failureRecord(club, null, error, new Date('2026-09-11T06:00:00Z'))
  assert.equal(record.nextRetryAt, '2026-09-11T08:00:00.000Z')
  assert.equal(record.snapshot, undefined)
  assert.deepEqual(nextRecord(club, record, first).events, [])
})

test('compressed history survives errors, retains recent evidence and excludes overlapping collectors', t => {
  const root = mkdtempSync(join(tmpdir(), 'anybotty-test-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const release = acquireLock(root)
  assert.equal(acquireLock(root), null)
  release()
  const releaseAgain = acquireLock(root)
  releaseAgain()
  const record = nextRecord(club, null, first)
  saveRecord(root, record)
  assert.deepEqual(latestRecord(root, club.id), record)
  const error = failureRecord(club, record, new Error('timeout'), new Date('2026-09-12T06:00:00Z'))
  saveRecord(root, error)
  assert.equal(latestRecord(root, club.id).snapshot.finishedAt, first.finishedAt)
  pruneRecords(root, club.id, new Date('2026-11-01T06:00:00Z'))
  assert.deepEqual(latestRecord(root, club.id), error)
})

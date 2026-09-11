import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { calculateSchedule } from '../lib/booking-schedule.js'
import { createJobStore } from '../lib/scheduled-booking.js'
const catalog = [{ id: 'paris-padel' }]
const request = { date: '21/09/2026', startTime: '20:00', clubs: ['paris-padel'], durationsMinutes: [60, 90], courtEnvironment: ['indoor', 'outdoor'], maxPricePerHourEUR: 80 }
const opening = { mode: 'daily', horizonDays: 8, localTime: '08:00', source: 'user_instruction', evidence: 'Explicit test instruction' }
const input = { request, opening }
const now = new Date('2026-09-11T10:00:00Z')
const calculate = (rule, overrides = {}) => calculateSchedule({ request: { ...request, ...overrides }, opening: { ...opening, ...rule } }, catalog, { now })

test('daily horizon, weekly publication and rolling deadlines use distinct rules', () => {
  assert.equal(calculate({}).openingAt, '2026-09-13T06:00:00.000Z')
  assert.equal(calculate({ mode: 'weekly', releaseWeekday: 5, targetWeekOffset: 1, localTime: '18:00' }).openingAt, '2026-09-18T16:00:00.000Z')
  assert.equal(calculate({ mode: 'weekly', releaseWeekday: 1, targetWeekOffset: 0 }).openingAt, '2026-09-21T06:00:00.000Z')
  assert.equal(calculate({ mode: 'rolling', leadHours: 72 }).openingAt, '2026-09-18T18:00:00.000Z')
  assert.deepEqual(calculate({}).request, request)
})

test('Paris winter offset and DST boundaries are handled without silently shifting wall times', () => {
  assert.equal(calculate({ horizonDays: 1 }, { date: '27/10/2026' }).openingAt, '2026-10-26T07:00:00.000Z')
  assert.equal(calculate({ mode: 'rolling', leadHours: 72 }, { date: '26/10/2026' }).openingAt, '2026-10-23T19:00:00.000Z')
  assert.throws(() => calculate({ horizonDays: 1, localTime: '02:30' }, { date: '26/10/2026' }), /ambiguous/)
  assert.throws(() => calculate({ horizonDays: 1, localTime: '02:30' }, { date: '29/03/2027' }), /nonexistent/)
  assert.equal(calculate({ mode: 'explicit', at: '2026-10-25T02:30:00+01:00' }, { date: '26/10/2026' }).openingAt, '2026-10-25T01:30:00.000Z')
})

test('missing evidence/time, invalid policy and passed openings never create a future schedule', () => {
  for (const rule of [{ source: 'guess' }, { evidence: '' }, { localTime: null }, { mode: 'unknown' }]) assert.equal(calculate(rule).status, 'needs_opening_rule')
  assert.equal(calculate({ horizonDays: 14 }).status, 'check_now')
  for (const rule of [{ horizonDays: -1 }, { mode: 'weekly', releaseWeekday: 8 }, { mode: 'rolling', leadHours: 0 }, { mode: 'explicit', at: '2026-09-20T08:00:00' }, { mode: 'explicit', at: '2026-09-31T08:00:00Z' }, { password: 'private' }]) assert.throws(() => calculate(rule))
  assert.throws(() => calculate({}, { clubs: ['paris-padel', 'other'] }))
})

const makeStore = t => {
  const root = mkdtempSync(join(tmpdir(), 'anybotty-jobs-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return { root, store: createJobStore({ directory: join(root, 'jobs'), scriptsDirectory: join(root, 'scripts'), projectDirectory: '/project with spaces', node: '/node' }) }
}

test('preparation freezes preferences privately, requires attach and rejects duplicates', async t => {
  const { root, store } = makeStore(t)
  assert.equal(store.prepare({ request, opening: {} }, catalog, { now }).status, 'needs_opening_rule')
  assert.deepEqual(store.list(), [])
  const job = store.prepare(input, catalog, { now })
  assert.equal(job.status, 'prepared')
  assert.deepEqual(job.request, request)
  assert.equal(statSync(join(root, 'jobs', `${job.id}.json`)).mode & 0o777, 0o600)
  assert.match(readFileSync(join(root, 'scripts', job.script), 'utf8'), /'\/project with spaces\/scripts\/booking-jobs.js'/)
  assert.throws(() => store.prepare(input, catalog, { now }), /active job/)
  assert.equal((await store.run(job.id, () => assert.fail('Unattached job ran'))).status, 'skipped')
  assert.throws(() => store.attach(job.id, ''), /required/)
  assert.equal(store.attach(job.id, 'cron-test').status, 'scheduled')
  assert.equal(store.attach(job.id, 'cron-test').status, 'scheduled')
  assert.throws(() => store.read('../escape'), /Invalid/)
})

test('cancelled requests remain inert even if their cron still exists', async t => {
  const { store } = makeStore(t)
  const job = store.prepare(input, catalog, { now })
  store.attach(job.id, 'cron-test')
  assert.equal(store.cancel(job.id).cronJobId, 'cron-test')
  assert.equal((await store.run(job.id, () => assert.fail('Cancelled job ran'))).status, 'skipped')
})

test('execution is claimed once, rejects early runs and blocks replay during or after execution', async t => {
  const { store } = makeStore(t)
  const job = store.prepare(input, catalog, { now })
  store.attach(job.id, 'cron-test')
  await assert.rejects(store.run(job.id, () => assert.fail('Early run'), { now }), /not started/)
  let complete
  const running = store.run(job.id, () => new Promise(resolve => { complete = resolve }), { now: new Date(job.openingAt) })
  assert.equal(store.read(job.id).status, 'running')
  assert.throws(() => store.cancel(job.id), /running/)
  assert.equal((await store.run(job.id, () => assert.fail('Concurrent replay'))).status, 'skipped')
  complete({ status: 'checkout_ready', paymentSubmitted: false, reservationConfirmed: false })
  assert.equal((await running).status, 'checkout_ready')
  assert.equal((await store.run(job.id, () => assert.fail('Replay'))).status, 'skipped')
})

test('late jobs expire and failed execution yields a durable blocked result', async t => {
  const { store } = makeStore(t)
  const job = store.prepare(input, catalog, { now })
  store.attach(job.id, 'cron-test')
  const result = await store.run(job.id, () => assert.fail('Late job ran'), { now: new Date(Date.parse(job.openingAt) + 300001) })
  assert.equal(result.status, 'missed')
  const retry = store.prepare(input, catalog, { now })
  store.attach(retry.id, 'cron-retry')
  assert.equal((await store.run(retry.id, async () => { throw new Error('failure') }, { now: new Date(retry.openingAt) })).status, 'blocked')
})

import assert from 'node:assert/strict'
import test from 'node:test'
import dayjs from 'dayjs'
import { inferOpeningPattern, monitoringPolicy } from '../lib/adaptive-monitoring.js'
import { monitoringPlan } from '../lib/monitoring-plan.js'
import { successfulObservation, providerPauses } from '../lib/monitoring-targets.js'
import { failureRecord } from '../lib/availability.js'
import { notifyMonitoringAlert } from '../lib/monitoring-alert.js'

const target = { id: 'test', provider: 'anybuddy', observation: { horizonDays: 8 }, monitoring: {} }
const batch = (date, size = 1, time = '08:00') => {
  const after = dayjs.tz(`${date}T${time}`, 'Europe/Paris').toISOString()
  const by = new Date(Date.parse(after) + 300000).toISOString()
  return { firstSeenAt: by, confirmationStatus: 'confirmed_five_checks', consecutiveDates: true, targetDates: Array.from({ length: size }, (_, i) => dayjs(date).add(8 + i, 'day').format('YYYY-MM-DD')), intervals: [{ after, by, seconds: 300 }] }
}
const evidence = batches => ({ calendar: { batches, watches: {} }, lastFullScan: { at: '2026-09-13T05:50:00Z', frontier: '2026-09-20' }, historicalFrontier: '2026-09-20' })

test('learning requires three confirmed precise independent publications with consistent pack sizes', () => {
  const rows = ['2026-09-10', '2026-09-11', '2026-09-12'].map(d => batch(d))
  assert.equal(inferOpeningPattern(evidence(rows.slice(0, 2))), null)
  for (const change of [b => { b.confirmationStatus = 'pending' }, b => { b.intervals[0].seconds = 3600 }, b => { b.intervals[0].after = null }, b => { b.targetDates.push('2026-09-30') }]) {
    const changed = structuredClone(rows); change(changed[2])
    assert.equal(inferOpeningPattern(evidence(changed)), null)
  }
  const pattern = inferOpeningPattern(evidence(rows))
  assert.equal(pattern.cadence, 'daily')
  assert.equal(pattern.evidenceCount, 3)
  assert.equal(pattern.localTime, '08:03')
  assert.equal(pattern.status, 'candidate')
})

test('weekly, monthly, month-end and three-day packs are distinct observed cadences', () => {
  for (const [dates, size, cadence, expected] of [
    [['2026-08-24','2026-08-31','2026-09-07'], 7, 'weekly', '2026-09-14'],
    [['2026-09-04','2026-09-07','2026-09-10'], 3, 'every_n_days', '2026-09-13'],
    [['2026-06-01','2026-07-01','2026-08-01'], 30, 'monthly', '2026-09-01'],
    [['2026-06-30','2026-07-31','2026-08-31'], 7, 'monthly', '2026-09-30'],
  ]) {
    const p = inferOpeningPattern(evidence(dates.map(d => batch(d, size))))
    assert.equal(p.cadence, cadence)
    assert.equal(p.publicationSize, size)
    assert.equal(p.expectedAt.slice(0,10), expected)
  }
  assert.equal(inferOpeningPattern(evidence(['2026-09-04','2026-09-07','2026-09-11'].map(d => batch(d)))), null)
})

test('local opening time survives DST and patterns do not cross club records', () => {
  const p = inferOpeningPattern(evidence(['2026-10-22','2026-10-23','2026-10-24'].map(d => batch(d))))
  assert.equal(p.expectedAt, '2026-10-25T07:03:00.000Z')
  assert.equal(inferOpeningPattern({}), null)
})

test('adaptive plan preserves hourly full scans, watches expected opening, and resumes discovery when missed', () => {
  const previous = evidence(['2026-09-10', '2026-09-11', '2026-09-12'].map(d => batch(d)))
  previous.lastFullScan.at = '2026-09-13T03:50:00Z'
  assert.equal(monitoringPlan(target, previous, new Date('2026-09-13T04:00:00Z')).reason, 'outside_expected_opening')
  assert.equal(monitoringPlan(target, previous, new Date('2026-09-13T05:00:00Z')).mode, 'full')
  previous.lastFullScan.at = '2026-09-13T05:40:00Z'
  const active = monitoringPlan(target, previous, new Date('2026-09-13T06:00:00Z'))
  assert.equal(active.mode, 'targeted')
  assert.deepEqual(active.window, { from: '2026-09-21', to: '2026-09-27' })
  previous.lastFullScan.at = '2026-09-13T07:05:00Z'
  assert.equal(monitoringPlan(target, previous, new Date('2026-09-13T07:10:00Z')).reason, 'expected_opening_missed_resume_discovery')
})

test('confirmations override sleeping windows and proxy sites retain hourly monitoring', () => {
  const previous = evidence([])
  const proxy = { ...target, monitoring: { openingReference: { targetId: 'boulogne' } } }
  assert.equal(monitoringPlan(proxy, previous, new Date('2026-09-13T06:00:00Z')).mode, 'skip')
  previous.calendar.watches['2026-09-19'] = { phase: 'verifying', targetDate: '2026-09-19' }
  assert.equal(monitoringPlan(proxy, previous, new Date('2026-09-13T06:00:00Z')).mode, 'targeted')
  assert.equal(monitoringPlan(target, previous, new Date('2026-09-13T06:00:00Z')).window.from, '2026-09-19')
  assert.throws(() => monitoringPolicy({ monitoring: { policy: { minPublications: 1 } } }))
  assert.equal(monitoringPolicy({ monitoring: { policy: { candidateDays: 14 } } }).candidateDays, 14)
})

test('partial observations retain unobserved watches and never count them as absent or confirmed', () => {
  const snap = (from, to, minute, dates, mode = 'targeted') => ({ window: { from, to }, startedAt: `2026-09-13T06:${minute}:00Z`, finishedAt: `2026-09-13T06:${minute}:01Z`, scanMode: mode, slots: dates.map(d => ({ startDateTime: `${d}T20:00`, durationMinutes: 60 })) })
  let record = successfulObservation(target, {}, snap('2026-09-13','2026-09-30','00', [], 'full'))
  const fullAt = record.lastFullScan.at
  record = successfulObservation(target, record, snap('2026-09-21','2026-09-27','05',['2026-09-21','2026-09-22']))
  const before = structuredClone(record.calendar.watches['2026-09-21'])
  record = successfulObservation(target, record, snap('2026-09-23','2026-09-29','10',[]))
  assert.deepEqual(record.calendar.watches['2026-09-21'], before)
  assert.equal(record.calendar.batches[0].confirmationStatus, 'pending')
  assert.equal(record.calendar.watches['2026-09-20'].lastValidAbsentAt, '2026-09-13T06:00:00Z')
  assert.equal(record.lastFullScan.at, fullAt)
  for (const minute of ['15','20','25','30','35']) record = successfulObservation(target, record, snap('2026-09-21','2026-09-27',minute,['2026-09-21','2026-09-22']))
  assert.equal(record.calendar.batches[0].confirmationStatus, 'confirmed_five_checks')
  assert.equal(record.calendar.watches['2026-09-21'].confirmations.length, 5)
})

test('HTTP blocks pause an entire provider for six hours, longer Retry-After wins; repeat auth failure also pauses', () => {
  const now = new Date('2026-09-13T06:00:00Z')
  const blocked = failureRecord(target, {}, { message: 'restricted', httpStatus: 403 }, now)
  assert.equal(blocked.nextRetryAt, '2026-09-13T12:00:00.000Z')
  const longer = failureRecord(target, {}, { message: 'limited', httpStatus: 429, retryAfterMs: 10*3600000 }, now)
  assert.equal(longer.nextRetryAt, '2026-09-13T16:00:00.000Z')
  const auth = { message: 'login required', code: 'login_required' }
  const first = failureRecord(target, {}, auth, now)
  assert.equal(first.monitoringAlert, null)
  const second = failureRecord(target, first, auth, now)
  assert.equal(second.monitoringAlert.type, 'repeated_authentication_failure')
  assert.equal(providerPauses([target], () => second, now.getTime()).get('anybuddy'), second.nextRetryAt)
})

test('alerts use Hermes without a model and never send unless configured', async () => {
  const record = { provider: 'ucpa', nextRetryAt: '2026-09-13T12:00:00Z', monitoringAlert: { type: 'access_restricted' } }
  assert.equal(await notifyMonitoringAlert(record, { target: '', deliver: () => { throw Error('must not send') } }), 'not_configured')
  let sent
  assert.equal(await notifyMonitoringAlert(record, { target: 'telegram:test', command: '/fake/hermes', deliver: async (...args) => { sent = args; return true } }), 'delivered')
  assert.deepEqual(sent[1], ['send','--to','telegram:test','--quiet'])
  assert.match(sent[2], /surveillance ucpa suspendue/)
})

test('monthly packs allow actual calendar-month lengths and truncated evidence keeps discovery active', () => {
  const batches = [batch('2026-02-01', 28), batch('2026-03-01', 31), batch('2026-04-01', 30)]
  const pattern = inferOpeningPattern(evidence(batches))
  assert.equal(pattern.cadence, 'monthly')
  assert.deepEqual(pattern.publicationSizeRange, { min: 28, max: 31 })
  batches[2].truncatedAtWindowEnd = true
  assert.equal(inferOpeningPattern(evidence(batches)), null)
  const previous = evidence(batches)
  assert.equal(monitoringPlan(target, previous, new Date('2026-09-13T06:00:00Z')).window.to, '2026-10-22')
})

test('compact publication evidence survives beyond raw snapshot retention for monthly learning', () => {
  const old = evidence([batch('2026-01-01', 30), batch('2026-02-01', 30), batch('2026-03-01', 30)])
  const now = '2026-09-13T06:00:00Z'
  const record = successfulObservation(target, old, { startedAt: now, finishedAt: now, window: { from: '2026-09-13', to: '2026-09-20' }, slots: [] })
  assert.equal(record.calendar.batches.length, 3)
})

test('a slow calendar response does not delay the next discovery tick by a full cycle', () => {
  const previous = evidence([])
  previous.snapshot = { startedAt: '2026-09-13T05:55:00Z', finishedAt: '2026-09-13T05:55:45Z' }
  assert.equal(monitoringPlan(target, previous, new Date('2026-09-13T06:00:00Z')).mode, 'targeted')
  assert.equal(monitoringPlan(target, previous, new Date('2026-09-13T05:56:00Z')).reason, 'minimum_interval')
})

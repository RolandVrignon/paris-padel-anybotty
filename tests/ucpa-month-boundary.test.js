import assert from 'node:assert/strict'
import { test } from 'node:test'
import dayjs from 'dayjs'
import { fetchUcpaMonthBoundary } from '../lib/ucpa-monitoring.js'
import { successfulObservation } from '../lib/monitoring-targets.js'
import { monitoringPlan } from '../lib/monitoring-plan.js'

const startedAt = '2026-09-13T18:00:00Z'
const url = 'https://www.ucpa.com/sport-station/api/areas-offers/migrated?period=months&plannerMonthsToIndex=4&timeframe=weekly&time=0'
const target = { id: 'ucpa-meudon--ucpa', provider: 'ucpa', observation: { horizonDays: 0 }, monitoring: {} }
const week = from => ({ planner: { columns: Array.from({ length: 7 }, (_, i) => ({ dateFormated: dayjs(from).add(i, 'day').format('YYYY-MM-DD'), items: [] })) } })
const first = (maxDate = '2027-01-13T12:00:00+01:00') => ({ planner: { ...week('2026-09-14').planner, timeLabel: { maxDate: String(Date.parse(maxDate)) } } })

test('Meudon reads its final visible week, then watches January 18 without querying disabled weeks', async () => {
  const requests = []
  const snapshot = await fetchUcpaMonthBoundary(target, { from: '2026-09-13', to: '2026-10-18' }, first(), url, startedAt, {
    readCalendar: async request => { requests.push(new URL(request).searchParams.get('time')); return week('2027-01-11') },
  })
  assert.deepEqual(requests, ['18'])
  assert.deepEqual(snapshot.window, { from: '2027-01-11', to: '2027-02-21' })
  assert.equal(snapshot.declaredCalendarThroughDate, '2027-01-17')
  assert.equal(snapshot.navigationThroughDate, null)
  snapshot.finishedAt = startedAt
  const record = successfulObservation(target, {}, snapshot)
  assert.equal(record.lastFullScan.frontier, '2027-01-17')
  const plan = monitoringPlan(target, record, '2026-09-13T18:05:00Z')
  assert.equal(plan.window.from, '2027-01-18')
  const next = await fetchUcpaMonthBoundary(target, plan.window, first(), url, startedAt, {
    targeted: true, readCalendar: async () => assert.fail('No inventory reads outside the UI calendar limit'),
  })
  assert.equal(next.window.from, '2027-01-18')
  assert.deepEqual(next.slots, [])
})

test('Meudon full scan preserves the previous boundary to detect a whole new pack', async () => {
  const requests = []
  const snapshot = await fetchUcpaMonthBoundary(target, { from: '2026-09-13', to: '2026-10-18' }, first('2027-02-13T12:00:00+01:00'), url, startedAt, {
    previousBoundary: '2027-01-17',
    readCalendar: async request => {
      const offset = Number(new URL(request).searchParams.get('time')); requests.push(offset)
      return week(dayjs('2026-09-07').add(offset, 'week').format('YYYY-MM-DD'))
    },
  })
  assert.deepEqual(requests, [18, 19, 20, 21, 22])
  assert.deepEqual(snapshot.window, { from: '2027-01-11', to: '2027-03-21' })
  assert.equal(snapshot.declaredCalendarThroughDate, '2027-02-14')
})

test('Meudon stops on changed metadata, wrong pagination or failed calendar reads', async () => {
  const window = { from: '2026-09-13', to: '2026-10-18' }
  for (const body of [first('invalid'), { planner: week('2026-09-14').planner }]) {
    await assert.rejects(fetchUcpaMonthBoundary(target, window, body, url, startedAt), /limit format/)
  }
  await assert.rejects(fetchUcpaMonthBoundary(target, window, first(), url.replace('months', 'weeks'), startedAt), /limit format/)
  await assert.rejects(fetchUcpaMonthBoundary(target, window, first(), url, startedAt, { readCalendar: async () => week('2027-01-18') }), /pagination changed/)
  const failure = Object.assign(new Error('Calendar HTTP 429'), { httpStatus: 429 })
  await assert.rejects(fetchUcpaMonthBoundary(target, window, first(), url, startedAt, { readCalendar: async () => { throw failure } }), error => error === failure)
})

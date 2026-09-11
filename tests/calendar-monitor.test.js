import assert from 'node:assert/strict'
import { test } from 'node:test'
import { calendarWindow, calendarSummary, updateCalendar } from '../lib/calendar-monitor.js'
import { createWatch, advanceWatch } from '../lib/opening-watch.js'
import { failureRecord } from '../lib/availability.js'

const club = { id: 'test', observation: { horizonDays: 8 } }
const week = ['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19', '2026-09-20']
const snap = (time, dates = [], window = { from: '2026-09-11', to: '2026-10-16' }) => ({ startedAt: time, finishedAt: new Date(Date.parse(time) + 1000).toISOString(), window, slots: dates.map(date => ({ startDateTime: `${date}T20:00`, durationMinutes: 60, offers: [] })) })
const update = (previous, snapshot) => ({ ...updateCalendar(club, previous, snapshot), snapshot })

test('a Sunday release of next week is recorded as one batch with seven independent five-check confirmations', () => {
  let record = update(null, snap('2026-09-13T20:55:00Z'))
  record = update(record, snap('2026-09-13T21:00:00Z', week))
  let batch = record.calendar.batches[0]
  assert.equal(batch.publicationWeekday, 'dimanche')
  assert.deepEqual(batch.targetWeekOffsets, [1])
  assert.equal(batch.consecutiveDates, true)
  assert.equal(batch.targetDates.length, 7)
  assert.equal(batch.confirmationStatus, 'pending')
  for (const minute of ['05', '10', '15', '20', '25']) record = update(JSON.parse(JSON.stringify(record)), snap(`2026-09-13T21:${minute}:00Z`, week))
  batch = record.calendar.batches[0]
  assert.equal(batch.confirmationStatus, 'confirmed_five_checks')
  assert.ok(Object.values(batch.confirmationsByDate).every(count => count === 5))
  assert.equal(record.completedWatches.filter(w => w.openingInterval).length, 7)
  assert.equal(calendarSummary(record.calendar).independentPublicationDays, 1)
  assert.equal(calendarSummary(record.calendar).independentPublicationWeeks, 1)
})

test('a Monday release of the current week has offset zero', () => {
  const before = update(null, snap('2026-09-14T06:55:00Z'))
  const after = update(before, snap('2026-09-14T07:00:00Z', week))
  assert.equal(after.calendar.batches[0].publicationWeekday, 'lundi')
  assert.deepEqual(after.calendar.batches[0].targetWeekOffsets, [0])
})

test('a missing date does not block later dates; disjoint dates are not marked consecutive', () => {
  const before = update(null, snap('2026-09-11T06:55:00Z'))
  const after = update(before, snap('2026-09-11T07:00:00Z', ['2026-09-20', '2026-09-22']))
  assert.equal(after.calendar.watches['2026-09-21'].phase, 'waiting')
  assert.equal(after.calendar.watches['2026-09-22'].phase, 'verifying')
  assert.equal(after.calendar.batches[0].consecutiveDates, false)
})

test('baseline and newly scanned dates never invent publication events', () => {
  const first = update(null, snap('2026-09-11T07:00:00Z', week))
  assert.deepEqual(first.calendar.batches, [])
  const shifted = snap('2026-09-12T07:00:00Z', ['2026-10-17'], { from: '2026-09-12', to: '2026-10-17' })
  const after = update(first, shifted)
  assert.deepEqual(after.calendar.batches, [])
  assert.equal(after.calendar.watches['2026-10-17'].openingInterval, null)
})

test('legacy target evidence survives the migration to a full-calendar collection', () => {
  const oldSnapshot = snap('2026-09-11T06:55:00Z', [], { from: '2026-09-20', to: '2026-09-20' })
  const watch = advanceWatch(createWatch(club, '2026-09-11T06:55:00Z'), oldSnapshot)
  const migrated = update({ snapshot: oldSnapshot, openingWatch: watch }, snap('2026-09-11T07:00:00Z', ['2026-09-20', '2026-09-21']))
  assert.deepEqual(migrated.calendar.batches[0].targetDates, ['2026-09-20'])
  assert.equal(migrated.calendar.watches['2026-09-21'].openingInterval, null)
})

test('additional hours on an open date stay separate from new-date publication batches', () => {
  const first = update(null, snap('2026-09-11T07:00:00Z', ['2026-09-20']))
  const next = snap('2026-09-11T07:05:00Z', ['2026-09-20'])
  next.slots.push({ startDateTime: '2026-09-20T21:00', durationMinutes: 60, offers: [] })
  const after = update(first, next)
  assert.deepEqual(after.calendar.batches, [])
  assert.equal(after.calendar.additionalSlots.length, 1)
  assert.equal(after.calendar.additionalSlots[0].type, 'additional_slots_on_open_date')
  assert.equal(after.calendar.additionalSlots[0].slots[0].startDateTime, '2026-09-20T21:00')
  assert.ok(after.calendar.additionalSlots[0].leadTimeHours[0].hours > 0)
})

test('an error widens the interval; disappearance invalidates an unconfirmed batch', () => {
  const before = update(null, snap('2026-09-11T07:00:00Z'))
  const failed = failureRecord(club, before, new Error('timeout'), new Date('2026-09-11T07:05:00Z'))
  const recovered = update(failed, snap('2026-09-11T07:10:00Z', ['2026-09-20']))
  assert.equal(recovered.calendar.batches[0].intervals[0].seconds, 601)
  const disappeared = update(recovered, snap('2026-09-11T07:15:00Z'))
  assert.equal(disappeared.calendar.batches[0].confirmationStatus, 'not_confirmed')
})

test('calendar coverage extends at least two weeks beyond a longer club horizon', () => {
  assert.deepEqual(calendarWindow(club, '2026-09-11T07:00Z'), { from: '2026-09-11', to: '2026-10-16' })
  assert.equal(calendarWindow({ observation: { horizonDays: 60 } }, '2026-09-11T07:00Z').to, '2026-11-24')
})

test('a timer tick seconds after a manual detection is not a five-minute confirmation', () => {
  const first = update(null, snap('2026-09-11T07:04:58Z', ['2026-09-20']))
  const after = update(first, snap('2026-09-11T07:05:00Z', ['2026-09-20']))
  assert.equal(after.calendar.watches['2026-09-20'].confirmations.length, 0)
  const later = update(after, snap('2026-09-11T07:10:00Z', ['2026-09-20']))
  assert.equal(later.calendar.watches['2026-09-20'].confirmations.length, 1)
})

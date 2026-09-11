import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createWatch, selectWatch, prepareCampaign, rememberCompletedWatch, advanceWatch, watchIsDue } from '../lib/opening-watch.js'
import { failureRecord } from '../lib/availability.js'

const club = { id: 'sportfield-bercy', observation: { horizonDays: 14 } }
const initial = () => createWatch(club, '2026-09-11T12:00:00Z')
const snap = (time, available = true, date = '2026-09-26') => ({ startedAt: time, finishedAt: new Date(Date.parse(time) + 1000).toISOString(), window: { from: date, to: date }, slots: available ? [{ startDateTime: `${date}T20:00`, durationMinutes: 60 }] : [] })

test('Sportfield targets September 26; each club gets its own horizon and Paris reference date', () => {
  assert.equal(initial().targetDate, '2026-09-26')
  assert.equal(createWatch({ observation: { horizonDays: 3 } }, '2026-09-11T12:00Z').targetDate, '2026-09-15')
  assert.equal(createWatch(club, '2026-09-11T22:01Z').referenceDate, '2026-09-12')
})

test('the target stays fixed across midnight and restart', () => {
  const state = advanceWatch(initial(), snap('2026-09-11T21:55:00Z', false))
  const restored = JSON.parse(JSON.stringify(state))
  assert.equal(advanceWatch(restored, snap('2026-09-12T06:00:00Z', false)).targetDate, '2026-09-26')
})

test('first appearance plus exactly five later timer ticks completes the watch', () => {
  let state = advanceWatch(initial(), snap('2026-09-12T05:55:00Z', false))
  state = advanceWatch(state, snap('2026-09-12T06:00:00Z'))
  assert.equal(state.phase, 'verifying')
  assert.equal(state.confirmations.length, 0)
  assert.equal(state.openingInterval.afterParis, '2026-09-12T07:55:00+02:00')
  assert.equal(state.openingInterval.byParis, '2026-09-12T08:00:01+02:00')
  assert.equal(state.nextCheckAt, '2026-09-12T06:05:00.000Z')
  for (const minute of ['05', '10', '15', '20', '25']) state = advanceWatch(state, snap(`2026-09-12T06:${minute}:00Z`))
  assert.equal(state.phase, 'complete')
  assert.equal(state.confirmations.length, 5)
  assert.equal(state.completedAt, '2026-09-12T06:25:01.000Z')
  assert.equal(state.result, 'opening_observed_and_date_still_available')
  assert.equal(watchIsDue(state), false)
  assert.deepEqual(advanceWatch(state, snap('2026-09-12T06:30:00Z')), state)
})

test('rapid manual replays do not count as five-minute confirmations', () => {
  const state = advanceWatch(initial(), snap('2026-09-12T06:00:00Z'))
  assert.deepEqual(advanceWatch(state, snap('2026-09-12T06:01:00Z')), state)
})

test('already-open target gets five follow-ups but no invented opening time', () => {
  let state = advanceWatch(initial(), snap('2026-09-11T13:00:00Z'))
  for (const minute of ['05', '10', '15', '20', '25']) state = advanceWatch(state, snap(`2026-09-11T13:${minute}:00Z`))
  assert.equal(state.result, 'already_available_at_first_check')
  assert.equal(state.openingInterval, null)
})

test('disappearance restarts observation; errors never count as confirmation', () => {
  let state = advanceWatch(initial(), snap('2026-09-11T13:00:00Z'))
  state = advanceWatch(state, snap('2026-09-11T13:05:00Z'))
  const failed = failureRecord(club, { openingWatch: state }, new Error('timeout'), new Date('2026-09-11T13:10:00Z'))
  assert.equal(failed.openingWatch.confirmations.length, 1)
  state = advanceWatch(failed.openingWatch, snap('2026-09-11T13:15:00Z', false))
  assert.equal(state.phase, 'waiting')
  assert.equal(state.confirmations.length, 0)
  assert.equal(state.failedAttempts.length, 1)
  state = advanceWatch(state, snap('2026-09-11T13:20:00Z'))
  assert.equal(state.openingInterval.after, '2026-09-11T13:15:00Z')
})

test('changed slots keep the date available but report the original-slot overlap', () => {
  const state = advanceWatch(initial(), snap('2026-09-11T13:00:00Z'))
  const changed = snap('2026-09-11T13:05:00Z')
  changed.slots[0].startDateTime = '2026-09-26T21:00'
  assert.equal(advanceWatch(state, changed).confirmations[0].initialSlotsStillAvailable, 0)
})

test('a response that does not cover the target cannot advance its watch', () => {
  assert.throws(() => advanceWatch(initial(), snap('2026-09-11T13:00:00Z', true, '2026-09-25')), /not covered/)
})


test('an explicit Trinquet target overrides its lower-bound horizon and resets only that campaign', () => {
  const trinquet = { observation: { horizonDays: 61 }, monitoring: { targetDate: '2026-11-11' } }
  const old = { ...initial(), targetDate: '2026-09-26', phase: 'complete', confirmations: [1, 2, 3, 4, 5] }
  const replacement = selectWatch(trinquet, old, '2026-09-11T13:00:00Z')
  assert.equal(replacement.targetDate, '2026-11-11')
  assert.equal(replacement.targetSource, 'configured_date')
  assert.equal(replacement.supersedesTargetDate, '2026-09-26')
  assert.equal(replacement.phase, 'waiting')
  assert.deepEqual(replacement.confirmations, [])
  assert.equal(selectWatch(club, old, '2026-09-12T13:00:00Z'), old)
  assert.equal(selectWatch(trinquet, replacement, '2026-09-12T13:00:00Z'), replacement)
  const available = advanceWatch(replacement, snap('2026-09-11T13:00:00Z', true, '2026-11-11'))
  assert.equal(available.openingInterval, null)
  assert.equal(available.phase, 'verifying')
})


test('five daily campaigns advance by one date and preserve distinct opening results across restarts', () => {
  let record
  for (let day = 12; day <= 16; day++) {
    const campaign = prepareCampaign(club, record, `2026-09-${day === 12 ? 11 : day}T05:50:00Z`)
    const target = campaign.openingWatch.targetDate
    let watch = advanceWatch(campaign.openingWatch, snap(`2026-09-${day}T05:55:00Z`, false, target))
    watch = advanceWatch(watch, snap(`2026-09-${day}T06:00:00Z`, true, target))
    for (const minute of ['05', '10', '15', '20', '25']) watch = advanceWatch(watch, snap(`2026-09-${day}T06:${minute}:00Z`, true, target))
    record = JSON.parse(JSON.stringify({ openingWatch: watch, completedWatches: rememberCompletedWatch(campaign.completedWatches, watch) }))
    assert.equal(record.completedWatches.length, day - 11)
  }
  assert.deepEqual(record.completedWatches.map(w => w.targetDate), ['2026-09-26', '2026-09-27', '2026-09-28', '2026-09-29', '2026-09-30'])
  assert.ok(record.completedWatches.every(w => w.openingInterval && w.confirmations.length === 5))
  const next = prepareCampaign(club, record, '2026-09-16T06:30:00Z')
  assert.equal(next.openingWatch.targetDate, '2026-10-01')
  assert.equal(next.openingWatch.lastValidAbsentAt, null)
  assert.equal(next.completedWatches.length, 5)
  assert.equal(prepareCampaign(club, next, '2026-09-16T06:35:00Z').openingWatch.targetDate, '2026-10-01')
})

test('unfinished targets and explicitly fixed targets do not roll to another date', () => {
  const waiting = initial()
  assert.equal(prepareCampaign(club, { openingWatch: waiting }, '2026-09-12T12:00Z').openingWatch, waiting)
  const done = { ...waiting, phase: 'complete', completedAt: '2026-09-12T06:25:00Z', confirmations: [] }
  const explicitClub = { ...club, monitoring: { targetDate: done.targetDate } }
  const prepared = prepareCampaign(explicitClub, { openingWatch: done })
  assert.equal(prepared.openingWatch, done)
  assert.equal(prepared.completedWatches.length, 1)
  const failed = failureRecord(club, prepared, new Error('network'), new Date('2026-09-12T07:00Z'))
  assert.deepEqual(failed.completedWatches, prepared.completedWatches)
})

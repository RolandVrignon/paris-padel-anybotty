import assert from 'node:assert/strict'
import { test } from 'node:test'
import { openingReference } from '../lib/opening-reference.js'
import { monitoringTargets } from '../lib/monitoring-targets.js'
import { repositoryDirectory } from '../lib/config.js'

const now = Date.parse('2026-09-14T06:30:00Z')
const event = { type: 'new_day_candidate', targetDate: '2026-09-28', lastValidAbsentAt: '2026-09-14T05:55:00Z', firstAvailableAt: '2026-09-14T06:00:00Z' }
const source = { status: 'ok', snapshot: { finishedAt: '2026-09-14T06:30:00Z' }, recentOpenings: [event], completedWatches: [{ targetDate: event.targetDate, firstAvailableAt: event.firstAvailableAt, phase: 'complete', confirmations: Array(5).fill({}) }] }

test('official centers with extended visible calendars reference Boulogne; source confirmations never verify checkout', () => {
  const targets = monitoringTargets(repositoryDirectory)
  const linked = targets.filter(target => target.monitoring?.openingReference)
  assert.deepEqual(linked.map(target => target.id).sort(), ['4padel-cao-saint-denis--4padel', '4padel-creteil--4padel', '4padel-marville--4padel', '4padel-montreuil--4padel', '4padel-paris-20--4padel', '4padel-saint-ouen--4padel'])
  for (const target of targets) {
    const result = openingReference(target, id => { assert.equal(id, '4padel-boulogne--4padel'); return source }, now)
    if (!linked.includes(target)) { assert.equal(result, null); continue }
    assert.equal(result.assumedHorizonDays, 14)
    assert.equal(result.status, 'hypothesis')
    assert.equal(result.bookingAuthorizationVerified, false)
    assert.equal(result.sourceStatus, 'fresh')
    assert.equal(result.measurements[0].sourceDateConfirmed, true)
    assert.equal(result.measurements[0].confirmations, 5)
  }
})

test('missing, stale or failed source stays explicit; baselines and replaced appearances do not confirm openings', () => {
  const target = monitoringTargets(repositoryDirectory).find(target => target.id === '4padel-paris-20--4padel')
  assert.equal(openingReference(target, () => null, now).sourceStatus, 'not_observed')
  assert.equal(openingReference(target, () => source, now + 11 * 60000).sourceStatus, 'unavailable_or_stale')
  assert.equal(openingReference(target, () => ({ ...source, status: 'error' }), now).sourceStatus, 'unavailable_or_stale')
  assert.equal(openingReference(target, () => ({ ...source, recentOpenings: [{ ...event, lastValidAbsentAt: null }] }), now).measurements.length, 0)
  const changed = { ...source, calendar: { watches: { [event.targetDate]: { firstAvailableAt: '2026-09-14T06:20:00Z', confirmations: [], phase: 'verifying' } } } }
  assert.equal(openingReference(target, () => changed, now).measurements[0].sourceDateConfirmed, false)
})

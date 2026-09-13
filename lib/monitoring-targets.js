import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import dayjs from 'dayjs'
import { parisTime, nextRecord } from './availability.js'
import { updateCalendar } from './calendar-monitor.js'

export const monitoringTargets = root => {
  const path = join(root, 'data/monitoring-policy.json')
  const policy = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {}
  return [
    ...JSON.parse(readFileSync(join(root, 'data/clubs.json'), 'utf8')).map(club => ({ ...club, provider: 'anybuddy', canonicalClubId: club.id })),
    ...JSON.parse(readFileSync(join(root, 'data/direct-monitoring.json'), 'utf8')).map(target => ({ ...target, canonicalClubId: target.clubId })),
  ].filter(target => target.monitoring?.enabled !== false).map(target => ({ ...target, monitoring: { ...target.monitoring, policy: { ...policy.defaults, ...policy.targets?.[target.id], ...target.monitoring?.policy } } }))
}

export const providerPauses = (targets, readLatest, now = Date.now()) => {
  const pauses = new Map()
  for (const target of targets) {
    const record = readLatest(target.id)
    if ((!record?.monitoringAlert && ![401, 403, 429].includes(record?.httpStatus)) || !(Date.parse(record.nextRetryAt) > now)) continue
    const previous = pauses.get(target.provider)
    if (!previous || Date.parse(record.nextRetryAt) > Date.parse(previous)) pauses.set(target.provider, record.nextRetryAt)
  }
  return pauses
}

export const successfulObservation = (target, previous, snapshot) => {
  // Do not compare account-specific rights across different accounts.
  const baseline = previous?.snapshot?.accountScope !== snapshot.accountScope ? {} : previous
  const lastFullScan = snapshot.scanMode !== 'targeted' ? { at: snapshot.finishedAt, frontier: snapshot.navigationThroughDate || snapshot.declaredCalendarThroughDate || snapshot.publishedDates?.at(-1) || snapshot.slots.at(-1)?.startDateTime.slice(0, 10), window: snapshot.window, horizon: horizonSummary(snapshot) } : baseline.lastFullScan
  return { ...nextRecord(target, baseline, snapshot), ...updateCalendar(target, baseline, snapshot), lastFullScan,
    provider: target.provider, canonicalClubId: target.canonicalClubId }
}

export const horizonSummary = snapshot => {
  if (!snapshot) return null
  const lastAvailableDate = snapshot.slots.at(-1)?.startDateTime.slice(0, 10) ?? null
  const reachesWindowEnd = Boolean(lastAvailableDate === snapshot.window.to)
  return {
    observedAtParis: parisTime(snapshot.finishedAt),
    lastAvailableDate,
    availableLeadDays: lastAvailableDate ? dayjs(lastAvailableDate).diff(dayjs(parisTime(snapshot.finishedAt).slice(0, 10)), 'day') : null,
    availableLeadIsLowerBound: reachesWindowEnd,
    lastPublishedDate: snapshot.publishedDates?.at(-1) ?? null,
    navigationThroughDate: snapshot.navigationThroughDate ?? null,
    declaredCalendarThroughDate: snapshot.declaredCalendarThroughDate ?? null,
    availabilityScope: snapshot.availabilityScope ?? 'calendar_selectable_dates',
    selectableThroughDate: snapshot.selectableDates?.at(-1) ?? null,
    declaredVisibilityDays: snapshot.bookingRules?.accountDays ?? null,
    interpretation: reachesWindowEnd ? 'scan_limit_reached_not_a_fixed_horizon' : 'availability_and_visibility_do_not_prove_a_release_schedule',
  }
}

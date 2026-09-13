import dayjs from 'dayjs'
import { calendarWindow } from './calendar-monitor.js'
import { inferOpeningPattern, monitoringPolicy } from './adaptive-monitoring.js'

export const FULL_SCAN_INTERVAL_MS = 60 * 60 * 1000
export const monitoringPlan = (target, previous, now = new Date()) => {
  const fullWindow = calendarWindow(target, now)
  const policy = monitoringPolicy(target)
  const pattern = inferOpeningPattern(previous, policy)
  const clock = new Date(now).getTime()
  const last = previous?.lastFullScan
  if (!last || !Number.isFinite(Date.parse(last.at)) || clock - Date.parse(last.at) >= policy.fullScanMinutes * 60000) return { mode: 'full', window: fullWindow, pattern }
  const verifying = Object.values(previous.calendar?.watches || {}).filter(w => w.phase === 'verifying' && w.targetDate >= fullWindow.from).map(w => w.targetDate).sort()
  // These two calendars already expose dates beyond their booking gate.
  // Keep their hourly scan; Boulogne is the explicitly unverified timing proxy.
  if (target.monitoring?.openingReference) return verifying.length ? { mode: 'targeted', window: { from: verifying[0], to: verifying.at(-1) }, pattern } : { mode: 'skip', reason: 'hourly_reference_calendar', nextFullScanAt: new Date(Date.parse(last.at) + policy.fullScanMinutes * 60000).toISOString(), pattern }
  if (!verifying.length && pattern && clock < Date.parse(pattern.watchFrom)) return { mode: 'skip', reason: 'outside_expected_opening', pattern }
  if (!verifying.length && clock - Date.parse(previous.snapshot?.finishedAt) < policy.discoveryMinutes * 60000 - 1000) return { mode: 'skip', reason: 'minimum_interval', pattern }
  const frontier = [last.frontier, previous.historicalFrontier].filter(Boolean).sort().at(-1)
  const from = frontier ? dayjs(frontier).add(1, 'day').format('YYYY-MM-DD') : dayjs(fullWindow.from).add(target.observation.horizonDays + 1, 'day').format('YYYY-MM-DD')
  // Even imprecisely timed publications can reveal the span to inspect next
  // time. Include one extra day to distinguish a complete pack from truncation.
  const publicationDays = new Map()
  for (const batch of previous.calendar?.batches || []) {
    const day = batch.firstSeenParis?.slice(0, 10) || batch.firstSeenAt?.slice(0, 10)
    const dates = publicationDays.get(day) || new Set()
    for (const date of batch.targetDates) dates.add(date)
    publicationDays.set(day, dates)
  }
  const observedSpan = Math.max(0, ...[...publicationDays.values()].map(dates => dates.size))
  const candidateDays = Math.max(policy.candidateDays, (pattern?.publicationSize || observedSpan) + 1)
  const dates = [from, dayjs(from).add(candidateDays - 1, 'day').format('YYYY-MM-DD'), ...verifying].sort()
  return { mode: 'targeted', window: { from: dates[0] < fullWindow.from ? fullWindow.from : dates[0], to: dates.at(-1) }, pattern, reason: pattern && clock > Date.parse(pattern.watchUntil) ? 'expected_opening_missed_resume_discovery' : verifying.length ? 'confirming_publication' : 'watching_frontier' }
}

import dayjs from 'dayjs'
import { parisTime } from './availability.js'

export const DEFAULT_MONITORING_POLICY = Object.freeze({ fullScanMinutes: 60, discoveryMinutes: 5, candidateDays: 7, minPublications: 3, maxEvidenceIntervalMinutes: 15, beforeMinutes: 30, afterMinutes: 60 })
export const monitoringPolicy = target => {
  const policy = { ...DEFAULT_MONITORING_POLICY, ...target.monitoring?.policy }
  for (const [key, value] of Object.entries(policy)) if (!Object.hasOwn(DEFAULT_MONITORING_POLICY, key) || !Number.isInteger(value) || value < 1 || value > 1440) throw new Error(`Invalid monitoring policy: ${key}`)
  if (policy.minPublications < 3 || policy.discoveryMinutes < 5 || policy.fullScanMinutes < policy.discoveryMinutes) throw new Error('Monitoring policy must retain at least three publications and a five-minute minimum interval')
  return policy
}

// Only complete, independently timed openings count. Baselines and single
// cancellations are not publication evidence. Ambiguity keeps discovery active.
export const inferOpeningPattern = (previous, policy = DEFAULT_MONITORING_POLICY) => {
  const batches = (previous?.calendar?.batches || []).filter(b => b.confirmationStatus === 'confirmed_five_checks')
  if (batches.length < policy.minPublications) return null
  const recent = batches.slice(-policy.minPublications)
  const events = []
  for (const batch of recent) {
    if (!batch.targetDates?.length || batch.consecutiveDates !== true || batch.truncatedAtWindowEnd || !batch.intervals?.length || batch.intervals.some(i => !i.after || !i.by || i.seconds > policy.maxEvidenceIntervalMinutes * 60 || i.seconds < 0)) return null
    const after = Math.min(...batch.intervals.map(i => Date.parse(i.after)))
    const by = Math.max(...batch.intervals.map(i => Date.parse(i.by)))
    if (!Number.isFinite(after + by) || by < after || by - after > policy.maxEvidenceIntervalMinutes * 60000) return null
    const middle = parisTime(new Date((after + by) / 2).toISOString())
    events.push({ date: middle.slice(0, 10), minute: Number(middle.slice(11, 13)) * 60 + Number(middle.slice(14, 16)) + Number(middle.slice(17, 19)) / 60, size: batch.targetDates.length, firstSeenAt: batch.firstSeenAt })
  }
  if (new Set(events.map(e => e.date)).size !== events.length) return null
  const first = events[0]
  const offsets = events.map(e => ((e.minute - first.minute + 2160) % 1440) - 720)
  if (Math.max(...offsets) - Math.min(...offsets) > policy.maxEvidenceIntervalMinutes) return null
  const minute = (Math.round(first.minute + offsets.reduce((a, b) => a + b, 0) / offsets.length) + 1440) % 1440
  const time = `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`
  const gaps = events.slice(1).map((e, i) => dayjs(e.date).diff(dayjs(events[i].date), 'day'))
  const monthly = events.slice(1).every((e, i) => dayjs(e.date).startOf('month').diff(dayjs(events[i].date).startOf('month'), 'month') === 1)
  const monthEnd = events.every(e => dayjs(e.date).date() === dayjs(e.date).daysInMonth())
  const sameMonthDay = new Set(events.map(e => dayjs(e.date).date())).size === 1
  const last = events.at(-1)
  let cadence, periodDays = null, nextDate
  if (monthly && (monthEnd || sameMonthDay)) {
    cadence = 'monthly'
    const next = dayjs(last.date).add(1, 'month')
    nextDate = (monthEnd ? next.endOf('month') : next).format('YYYY-MM-DD')
  } else if (new Set(gaps).size === 1 && gaps[0] > 0) {
    periodDays = gaps[0]
    cadence = periodDays === 1 ? 'daily' : periodDays === 7 ? 'weekly' : 'every_n_days'
    nextDate = dayjs(last.date).add(periodDays, 'day').format('YYYY-MM-DD')
  } else return null
  const sizes = events.map(e => e.size)
  // Calendar-month releases naturally vary between 28 and 31 dates.
  if (new Set(sizes).size !== 1 && !(cadence === 'monthly' && sizes.every(size => size >= 28 && size <= 31))) return null
  const expectedAt = dayjs.tz(`${nextDate}T${time}`, 'Europe/Paris').toISOString()
  return { status: 'candidate', cadence, periodDays, publicationSize: Math.max(...sizes), publicationSizeRange: { min: Math.min(...sizes), max: Math.max(...sizes) }, localTime: time, timezone: 'Europe/Paris', weekday: cadence === 'weekly' ? dayjs(last.date).day() : null, evidenceCount: events.length, lastPublicationAt: last.firstSeenAt, expectedAt,
    watchFrom: new Date(Date.parse(expectedAt) - policy.beforeMinutes * 60000).toISOString(), watchUntil: new Date(Date.parse(expectedAt) + policy.afterMinutes * 60000).toISOString() }
}

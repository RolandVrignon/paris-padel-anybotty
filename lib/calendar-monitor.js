import dayjs from 'dayjs'
import { parisTime, queryWindow, compareSnapshots } from './availability.js'
import { createWatch, advanceWatch } from './opening-watch.js'

const weekdays = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi']
const weekStart = date => dayjs(date).subtract((dayjs(date).day() + 6) % 7, 'day').format('YYYY-MM-DD')
const datesIn = window => {
  const dates = []
  for (let date = window.from; date <= window.to; date = dayjs(date).add(1, 'day').format('YYYY-MM-DD')) dates.push(date)
  return dates
}

export const calendarWindow = (club, now = new Date()) => {
  const window = queryWindow(now)
  if (club.provider === 'playtomic') {
    const boundary = dayjs(window.from).add(club.observation.horizonDays, 'day')
    return { from: boundary.subtract(1, 'day').format('YYYY-MM-DD'), to: boundary.add(3, 'day').format('YYYY-MM-DD') }
  }
  // Always cover at least five weeks and two weeks beyond the observed horizon.
  const horizonEnd = dayjs(window.from).add(club.observation.horizonDays + 14, 'day').format('YYYY-MM-DD')
  return { from: window.from, to: horizonEnd > window.to ? horizonEnd : window.to }
}

export const updateCalendar = (club, previous, snapshot) => {
  const old = previous?.calendar ?? {}
  const priorWatches = { ...old.watches }
  // Retain the evidence and confirmations gathered by the earlier single-date monitor.
  for (const watch of [...(previous?.completedWatches || []), previous?.openingWatch].filter(Boolean)) {
    if (!priorWatches[watch.targetDate]) priorWatches[watch.targetDate] = watch
  }
  // Partial scans must retain evidence for dates that were not observed.
  const cutoffDate = dayjs(snapshot.finishedAt).subtract(30, 'day').format('YYYY-MM-DD')
  const watches = Object.fromEntries(Object.entries(priorWatches).filter(([date]) => date >= cutoffDate))
  const newlyVisible = []
  let completedWatches = [...(previous?.completedWatches || [])]
  for (const date of datesIn(snapshot.window)) {
    let before = priorWatches[date]
    if (!before) {
      before = createWatch({ ...club, monitoring: { ...club.monitoring, targetDate: date } }, snapshot.startedAt)
      before.targetSource = 'calendar_window'
      const prior = previous?.snapshot
      if (prior && date >= prior.window.from && date <= prior.window.to) before = advanceWatch(before, prior)
    }
    const after = advanceWatch(before, snapshot)
    watches[date] = after
    if (before.phase === 'waiting' && after.phase === 'verifying' && after.openingInterval) newlyVisible.push(after)
    if (after.phase === 'complete') {
      completedWatches = [...completedWatches.filter(item => item.targetDate !== date), after]
    }
  }
  const cutoff = Date.parse(snapshot.finishedAt) - 30 * 86400000
  completedWatches = completedWatches.filter(watch => Date.parse(watch.completedAt) >= cutoff).sort((a, b) => a.targetDate.localeCompare(b.targetDate)).slice(-200)
  let batches = [...(old.batches || [])]
  if (newlyVisible.length) {
    const publicationDate = parisTime(snapshot.finishedAt).slice(0, 10)
    const targetDates = newlyVisible.map(watch => watch.targetDate)
    const targetWeekStarts = [...new Set(targetDates.map(weekStart))]
    batches.push({
      id: snapshot.finishedAt,
      firstSeenAt: snapshot.finishedAt,
      firstSeenParis: parisTime(snapshot.finishedAt),
      publicationWeekday: weekdays[dayjs(publicationDate).day()],
      publicationWeekStart: weekStart(publicationDate),
      targetDates,
      targetWeekStarts,
      targetWeekOffsets: targetWeekStarts.map(week => dayjs(week).diff(dayjs(weekStart(publicationDate)), 'week')),
      consecutiveDates: targetDates.every((date, index) => index === 0 || dayjs(date).diff(dayjs(targetDates[index - 1]), 'day') === 1),
      truncatedAtWindowEnd: targetDates.at(-1) === snapshot.window.to,
      intervals: newlyVisible.map(watch => ({ targetDate: watch.targetDate, ...watch.openingInterval })),
      shape: targetDates.length > 1 ? 'multiple_dates_first_seen_together' : 'single_date_first_seen',
      confirmationStatus: 'pending',
      interpretation: 'candidate_not_a_proven_rule',
    })
  }
  batches = batches.filter(batch => Date.parse(batch.firstSeenAt) >= Date.parse(snapshot.finishedAt) - 400 * 86400000).slice(-800).map(batch => {
    if (batch.confirmationStatus !== 'pending') return batch
    const tracked = batch.targetDates.map(date => watches[date] || completedWatches.find(watch => watch.targetDate === date && watch.firstAvailableAt === batch.firstSeenAt))
    const invalidated = tracked.some(watch => !watch || watch.firstAvailableAt !== batch.firstSeenAt)
    return {
      ...batch,
      confirmationStatus: invalidated ? 'not_confirmed' : tracked.every(watch => watch.phase === 'complete') ? 'confirmed_five_checks' : 'pending',
      confirmationsByDate: Object.fromEntries(batch.targetDates.map((date, index) => [date, tracked[index]?.firstAvailableAt === batch.firstSeenAt ? tracked[index].confirmations.length : 0])),
    }
  })
  // Additional hours/durations on an already-open date are separate evidence:
  // they may indicate a rolling release, an inventory update, or a cancellation.
  const additions = compareSnapshots(previous?.snapshot, snapshot, previous?.historicalFrontier).filter(event => event.type === 'slots_added' && previous?.snapshot.slots.some(slot => slot.startDateTime.startsWith(`${event.targetDate}T`))).map(event => ({
    ...event,
    type: 'additional_slots_on_open_date',
    publicationWeekday: weekdays[dayjs(parisTime(snapshot.finishedAt).slice(0, 10)).day()],
    leadTimeHours: event.slots.map(slot => ({ ...slot, hours: Math.round(dayjs.tz(slot.startDateTime, 'Europe/Paris').diff(dayjs(snapshot.finishedAt), 'minute', true) / 60 * 100) / 100 })),
    interpretation: 'rolling_release_or_inventory_change_or_cancellation',
  }))
  const additionalSlots = [...(old.additionalSlots || []), ...additions].filter(event => Date.parse(event.firstAvailableAt) >= cutoff).slice(-200)
  const preferred = previous?.openingWatch?.targetDate
  const nextTarget = dayjs(snapshot.window.from).add(club.observation.horizonDays + 1, 'day').format('YYYY-MM-DD')
  const openingWatch = (watches[preferred]?.phase !== 'complete' ? watches[preferred] : null) || Object.values(watches).find(watch => watch.targetDate >= nextTarget && watch.phase !== 'complete') || null
  const trackedDates = Object.keys(watches).sort()
  return { calendar: { window: { from: trackedDates[0], to: trackedDates.at(-1) }, watches, batches, additionalSlots }, completedWatches, openingWatch }
}

export const calendarSummary = calendar => {
  if (!calendar) return null
  const watches = Object.values(calendar.watches)
  return {
    window: calendar.window,
    trackedDates: watches.length,
    waitingDates: watches.filter(watch => watch.phase === 'waiting').map(watch => watch.targetDate),
    verifyingDates: watches.filter(watch => watch.phase === 'verifying').map(watch => ({ targetDate: watch.targetDate, confirmations: watch.confirmations.length, openingInterval: watch.openingInterval })),
    confirmedDates: watches.filter(watch => watch.phase === 'complete').map(watch => watch.targetDate),
    batches: calendar.batches,
    additionalSlots: calendar.additionalSlots,
    independentPublicationDays: new Set(calendar.batches.filter(batch => batch.confirmationStatus === 'confirmed_five_checks').map(batch => batch.firstSeenParis.slice(0, 10))).size,
    independentPublicationWeeks: new Set(calendar.batches.filter(batch => batch.confirmationStatus === 'confirmed_five_checks').map(batch => batch.publicationWeekStart)).size,
  }
}

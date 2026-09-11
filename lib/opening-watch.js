import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc.js'
import timezone from 'dayjs/plugin/timezone.js'
import { parisTime, slotKey } from './availability.js'

dayjs.extend(utc)
dayjs.extend(timezone)
const INTERVAL = 5 * 60 * 1000
export const createWatch = (club, now = new Date()) => {
  const referenceDate = dayjs(now).tz('Europe/Paris').format('YYYY-MM-DD')
  const horizonDays = club.observation.horizonDays
  const targetDate = club.monitoring?.targetDate || dayjs(referenceDate).add(horizonDays + 1, 'day').format('YYYY-MM-DD')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate) || dayjs(targetDate).format('YYYY-MM-DD') !== targetDate) throw new Error('Invalid configured target date')
  return {
    referenceDate, horizonDays, targetDate,
    targetSource: club.monitoring?.targetDate ? 'configured_date' : 'observed_horizon_plus_one',
    phase: 'waiting', lastValidAbsentAt: null, firstAvailableAt: null,
    openingInterval: null, confirmations: [], nextCheckAt: null, failedAttempts: [],
  }
}

// Preserve existing campaigns unless an explicitly configured target changes.
export const selectWatch = (club, previous, now = new Date()) => {
  if (previous && (!club.monitoring?.targetDate || previous.targetDate === club.monitoring.targetDate)) return previous
  const watch = createWatch(club, now)
  if (previous) watch.supersedesTargetDate = previous.targetDate
  return watch
}

export const rememberCompletedWatch = (history = [], watch) => {
  if (watch?.phase !== 'complete') return history
  const key = item => `${item.targetDate}|${item.completedAt}`
  return [...history.filter(item => key(item) !== key(watch)), watch].slice(-30)
}

export const prepareCampaign = (club, previous, now = new Date()) => {
  const completedWatches = rememberCompletedWatch(previous?.completedWatches, previous?.openingWatch)
  let watch = selectWatch(club, previous?.openingWatch, now)
  if (watch.phase === 'complete' && !club.monitoring?.targetDate) {
    const targetDate = dayjs(watch.targetDate).add(1, 'day').format('YYYY-MM-DD')
    watch = {
      ...createWatch({ ...club, monitoring: { ...club.monitoring, targetDate } }, now),
      referenceDate: dayjs(watch.referenceDate).add(1, 'day').format('YYYY-MM-DD'),
      targetSource: 'next_campaign_date',
      previousTargetDate: watch.targetDate,
    }
  }
  return { openingWatch: watch, completedWatches }
}

const nextTick = startedAt => new Date((Math.floor(Date.parse(startedAt) / INTERVAL) + 1) * INTERVAL).toISOString()
export const watchIsDue = (watch, now = new Date()) => watch.phase !== 'complete' && (!watch.nextCheckAt || Date.parse(watch.nextCheckAt) <= new Date(now).getTime())

export const advanceWatch = (previous, snapshot) => {
  if (previous.phase === 'complete') return previous
  if (snapshot.window.from > previous.targetDate || snapshot.window.to < previous.targetDate) throw new Error('Target date not covered by observation')
  if (!watchIsDue(previous, snapshot.startedAt)) return previous
  const watch = structuredClone(previous)
  const slots = snapshot.slots.filter(slot => slot.startDateTime.startsWith(`${watch.targetDate}T`))
  const keys = slots.map(slotKey)
  watch.lastCheckedAt = snapshot.finishedAt
  watch.availableSlotCount = slots.length
  watch.nextCheckAt = nextTick(snapshot.startedAt)
  if (!slots.length) {
    if (watch.phase === 'verifying') {
      watch.failedAttempts = [...watch.failedAttempts, { firstAvailableAt: watch.firstAvailableAt, openingInterval: watch.openingInterval, confirmations: watch.confirmations, disappearedAt: snapshot.finishedAt }].slice(-10)
    }
    return { ...watch, phase: 'waiting', lastValidAbsentAt: snapshot.startedAt, firstAvailableAt: null, openingInterval: null, initialSlotKeys: [], confirmations: [] }
  }
  if (watch.phase === 'waiting') {
    watch.phase = 'verifying'
    watch.firstAvailableAt = snapshot.finishedAt
    watch.initialSlotKeys = keys
    watch.openingInterval = watch.lastValidAbsentAt ? {
      after: watch.lastValidAbsentAt,
      by: snapshot.finishedAt,
      afterParis: parisTime(watch.lastValidAbsentAt),
      byParis: parisTime(snapshot.finishedAt),
      seconds: Math.ceil((Date.parse(snapshot.finishedAt) - Date.parse(watch.lastValidAbsentAt)) / 1000),
    } : null
    return watch
  }
  // A manual run just before a timer tick must not count seconds later.
  const lastConfirmationAt = watch.confirmations.at(-1)?.checkedAt || watch.firstAvailableAt
  if (Date.parse(snapshot.finishedAt) - Date.parse(lastConfirmationAt) < INTERVAL - 1000) return watch
  // Confirmation proves that this date still has offers; other customers may
  // have booked some original slots. Record their overlap without assuming all persist.
  watch.confirmations.push({ checkedAt: snapshot.finishedAt, checkedAtParis: parisTime(snapshot.finishedAt), availableSlotCount: slots.length, initialSlotsStillAvailable: watch.initialSlotKeys.filter(key => keys.includes(key)).length })
  if (watch.confirmations.length === 5) {
    watch.phase = 'complete'
    watch.completedAt = snapshot.finishedAt
    watch.result = watch.openingInterval ? 'opening_observed_and_date_still_available' : 'already_available_at_first_check'
    watch.nextCheckAt = null
  }
  return watch
}

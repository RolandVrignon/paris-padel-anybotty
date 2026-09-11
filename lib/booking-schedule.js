import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc.js'
import timezone from 'dayjs/plugin/timezone.js'
import { validateRequest } from './plan.js'

dayjs.extend(utc)
dayjs.extend(timezone)
const zone = 'Europe/Paris'
const integer = (n, min, max) => Number.isInteger(n) && n >= min && n <= max

// Enumerate possible offsets: reject both missing and ambiguous Paris wall times.
const parisInstant = wall => {
  const base = dayjs.utc(wall)
  const matches = [0, 1, 2].map(offset => base.subtract(offset, 'hour'))
    .filter(time => time.tz(zone).format('YYYY-MM-DDTHH:mm') === wall)
  if (matches.length !== 1) throw new Error('Paris time is ambiguous or nonexistent; supply an explicit timestamp with offset')
  return matches[0]
}

export const calculateSchedule = (input, catalog, { now = new Date() } = {}) => {
  if (!input || Object.keys(input).some(key => !['request', 'opening', 'mode'].includes(key))) throw new Error('Only request, opening and mode are accepted')
  const mode = input.mode ?? 'preview'
  if (!['preview', 'pay'].includes(mode)) throw new Error('mode must be preview or pay')
  const request = validateRequest(input.request, catalog)
  if (request.clubs.length !== 1) throw new Error('Schedule one strategy-approved club per job')
  const rule = input.opening
  if (!rule || !['verified_observation', 'user_instruction'].includes(rule.source) || typeof rule.evidence !== 'string' || !rule.evidence.trim()) {
    return { status: 'needs_opening_rule', reason: 'A documented opening rule or explicit user instruction is required' }
  }
  if (Object.keys(rule).some(key => !['mode', 'source', 'evidence', 'at', 'localTime', 'horizonDays', 'releaseWeekday', 'targetWeekOffset', 'leadHours'].includes(key))) throw new Error('Unsupported opening field')
  const match = parisInstant(`${request.date}T${request.startTime}`)
  let opening
  if (rule.mode === 'explicit') {
    if (typeof rule.at !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00(?:Z|[+-]\d{2}:\d{2})$/.test(rule.at)) throw new Error('opening.at requires an ISO timestamp with seconds 00 and offset')
    opening = dayjs(rule.at)
    const wall = rule.at.slice(0, 16)
    const offset = rule.at.endsWith('Z') ? 0 : (rule.at.slice(-6, -5) === '-' ? -1 : 1) * (Number(rule.at.slice(-5, -3)) * 60 + Number(rule.at.slice(-2)))
    if (!opening.isValid() || Math.abs(offset) > 14 * 60 || opening.utcOffset(offset).format('YYYY-MM-DDTHH:mm') !== wall) throw new Error('Invalid opening timestamp')
  } else if (rule.mode === 'rolling') {
    if (!integer(rule.leadHours, 1, 24 * 365)) throw new Error('leadHours must be a positive integer up to 8760')
    opening = match.subtract(rule.leadHours, 'hour')
  } else {
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(rule.localTime || '')) return { status: 'needs_opening_rule', reason: 'Opening localTime is unknown' }
    let date = dayjs.utc(request.date)
    if (rule.mode === 'daily') {
      if (!integer(rule.horizonDays, 0, 365)) throw new Error('horizonDays must be between 0 and 365')
      date = date.subtract(rule.horizonDays, 'day')
    } else if (rule.mode === 'weekly') {
      if (!integer(rule.releaseWeekday, 1, 7) || !integer(rule.targetWeekOffset, 0, 52)) throw new Error('Weekly rule needs releaseWeekday 1..7 and targetWeekOffset 0..52')
      // ISO Monday week. Offset 1 means next week's matches open in release week.
      date = date.subtract((date.day() + 6) % 7, 'day').subtract(rule.targetWeekOffset * 7, 'day').add(rule.releaseWeekday - 1, 'day')
    } else return { status: 'needs_opening_rule', reason: 'Unknown opening policy' }
    opening = parisInstant(`${date.format('YYYY-MM-DD')}T${rule.localTime}`)
  }
  if (opening.valueOf() >= match.valueOf()) throw new Error('Opening must precede the match')
  if (match.valueOf() <= new Date(now).getTime()) throw new Error('Match is in the past')
  if (opening.valueOf() <= new Date(now).getTime()) return { status: 'check_now', openingAt: opening.toISOString(), reason: 'Opening has passed; re-evaluate availability and strategy' }
  return { status: 'ready', mode, openingAt: opening.toISOString(), openingParis: opening.tz(zone).format(), timeZone: zone, opening: rule, request: { ...request, date: dayjs(request.date).format('DD/MM/YYYY') } }
}

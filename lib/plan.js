import { validateDurations } from './duration-preferences.js'
import { validateCourtEnvironment } from './court-environment.js'
import dayjs from 'dayjs'
import customParseFormat from 'dayjs/plugin/customParseFormat.js'
import utc from 'dayjs/plugin/utc.js'
import timezone from 'dayjs/plugin/timezone.js'

dayjs.extend(customParseFormat)
dayjs.extend(utc)
dayjs.extend(timezone)

export const validateRequest = (input, catalog) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Configuration must be an object')
  const allowed = new Set(['date', 'startTime', 'durationsMinutes', 'clubs', 'maxTotalPriceEUR', 'courtEnvironment'])
  for (const key of Object.keys(input)) if (!allowed.has(key)) throw new Error(`Unsupported field: ${key}`)
  const parsed = dayjs(input.date, 'DD/MM/YYYY', true)
  if (typeof input.date !== 'string' || !parsed.isValid()) throw new Error('date must use DD/MM/YYYY')
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(input.startTime || '')) throw new Error('startTime must use HH:mm')
  const durationsMinutes = validateDurations(input.durationsMinutes)
  if (!Array.isArray(input.clubs) || !input.clubs.length || input.clubs.some(id => !catalog.some(club => club.id === id))) throw new Error('Choose club IDs from clubs:list')
  if (new Set(input.clubs).size !== input.clubs.length) throw new Error('Duplicate club IDs')
  if (input.maxTotalPriceEUR != null && (typeof input.maxTotalPriceEUR !== 'number' || !Number.isFinite(input.maxTotalPriceEUR) || input.maxTotalPriceEUR <= 0)) throw new Error('maxTotalPriceEUR must be a positive number or null')
  return { ...input, courtEnvironment: validateCourtEnvironment(input.courtEnvironment), date: parsed.format('YYYY-MM-DD'), durationsMinutes }
}

export const buildPlan = (input, catalog, { now = new Date() } = {}) => {
  const request = validateRequest(input, catalog)
  const today = dayjs(now).tz('Europe/Paris').format('YYYY-MM-DD')
  if (request.date < today) throw new Error('Target date is in the past')
  const clubs = request.clubs.map((id, priority) => {
    const club = catalog.find(item => item.id === id)
    const theoreticalOpeningDate = dayjs(request.date).subtract(club.observation.horizonDays, 'day').format('YYYY-MM-DD')
    return {
      id, name: club.name, priority: priority + 1, url: club.url,
      observedHorizonDays: club.observation.horizonDays,
      observationDate: club.observation.date,
      theoreticalOpeningDate,
      openingTime: club.opening.localTime,
      openingVerified: club.opening.verified,
      suggestedAction: theoreticalOpeningDate <= today ? 'check_availability_now' : 'observe_future_opening',
    }
  })
  return {
    mode: 'planning_only', timeZone: 'Europe/Paris', request,
    warning: 'Opening dates are estimates from last available dates, not verified booking rules. Availability, accepted durations and court environments have not been checked.',
    checkNow: clubs.filter(club => club.suggestedAction === 'check_availability_now'),
    upcoming: clubs.filter(club => club.suggestedAction === 'observe_future_opening').sort((a, b) => a.theoreticalOpeningDate.localeCompare(b.theoreticalOpeningDate) || a.priority - b.priority),
  }
}

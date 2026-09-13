import { playtomicClub } from './playtomic-clubs.js'
import { fetchPlaytomicDay, playtomicCheckoutUrl } from './playtomic-availability.js'

export const normalizePlaytomicRequest = request => {
  const club = playtomicClub(request.clubId)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(request.date || '') || !/^\d{2}:\d{2}$/.test(request.startTime || '')) throw new Error('Use --date YYYY-MM-DD and --time HH:mm')
  const durations = request.durationsMinutes?.length ? request.durationsMinutes : [90]
  if (!durations.every(value => Number.isInteger(value) && value > 0)) throw new Error('Invalid Playtomic durations')
  const max = request.maxPricePerHourEUR
  if (max !== null && max !== undefined && (!Number.isFinite(max) || max <= 0)) throw new Error('Invalid maximum hourly price')
  return { ...request, club, durationsMinutes: durations, maxPricePerHourEUR: max ?? null }
}

export const previewPlaytomicBooking = async (request, options = {}) => {
  const normalized = normalizePlaytomicRequest(request)
  const slots = await fetchPlaytomicDay(normalized.club, normalized.date, options)
  for (const duration of normalized.durationsMinutes) {
    const slot = slots.find(item => item.startDateTime === `${normalized.date}T${normalized.startTime}` && item.durationMinutes === duration)
    if (!slot) continue
    const offers = slot.offers.filter(offer => normalized.maxPricePerHourEUR === null || offer.priceCents / 100 / (duration / 60) <= normalized.maxPricePerHourEUR).sort((a, b) => a.priceCents - b.priceCents)
    if (!offers.length) continue
    const offer = { ...offers[0], startDateTime: slot.startDateTime, durationMinutes: slot.durationMinutes }
    return { provider: 'playtomic', status: 'preview', club: { id: normalized.club.id, name: normalized.club.name }, date: normalized.date, startTime: normalized.startTime, durationMinutes: duration, priceEUR: offer.priceCents / 100, pricePerHourEUR: offer.priceCents / 100 / (duration / 60), environment: offer.environment, resourceId: offer.resourceId, checkoutUrl: playtomicCheckoutUrl(normalized.club, offer), paymentSubmitted: false, reservationCreated: false }
  }
  return { provider: 'playtomic', status: 'not_found', club: { id: normalized.club.id, name: normalized.club.name }, date: normalized.date, startTime: normalized.startTime, paymentSubmitted: false, reservationCreated: false }
}

import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc.js'
import timezone from 'dayjs/plugin/timezone.js'
import { validateRequest } from './plan.js'
import { offerKey } from './court-selection.js'

dayjs.extend(utc)
dayjs.extend(timezone)

// Sequential search: club priority always precedes duration/environment priority.
// Dependencies keep search ordering testable without contacting Anybuddy.
export const searchBooking = async (input, clubs, { fetchAvailability, attempt, now = new Date(), onEvent = () => {}, maxAttemptsPerClub = 50, mode = 'preview' }) => {
  if (!['preview', 'pay'].includes(mode)) throw new Error('Invalid booking mode')
  const request = validateRequest(input, clubs)
  if (dayjs.tz(`${request.date}T${request.startTime}`, 'Europe/Paris').valueOf() <= new Date(now).getTime()) throw new Error('Requested starting time is in the past')
  const events = []
  const record = event => { events.push(event); onEvent(event) }
  let incomplete = false
  for (const clubId of request.clubs) {
    const club = clubs.find(item => item.id === clubId)
    let snapshot
    try { snapshot = await fetchAvailability(club, { from: request.date, to: request.date }) } catch (error) {
      record({ clubId, status: 'availability_error', httpStatus: error.httpStatus ?? null })
      if ([401, 403, 429].includes(error.httpStatus)) return { status: 'blocked', reason: 'availability_access', retryAfterMs: error.retryAfterMs ?? null, events, paymentSubmitted: false, reservationConfirmed: false }
      incomplete = true
      continue
    }
    if (!snapshot.slots.some(slot => slot.startDateTime === `${request.date}T${request.startTime}` && request.durationsMinutes.includes(slot.durationMinutes))) {
      record({ clubId, status: 'no_available_slot' })
      continue
    }
    const excludedOffers = []
    for (let count = 0; count < maxAttemptsPerClub; count++) {
      let selected
      try {
        const result = await attempt(club, request, { excludedOffers: [...excludedOffers], onSelected: offer => { selected = offer } })
        if (mode === 'pay') {
          if (!['booked', 'existing_reservation', 'payment_failed', 'payment_action_required', 'payment_unverified'].includes(result.status)) return { status: 'payment_unverified', events, paymentSubmitted: true, reservationConfirmed: false }
          record({ clubId, status: result.status })
          return { status: result.status, result, events, paymentSubmitted: result.paymentSubmitted, reservationConfirmed: result.reservationConfirmed }
        }
        if (result.stage !== 'checkout_ready' || result.paymentSubmitted !== false || result.reservationConfirmed !== false) throw new Error('Unexpected booking attempt outcome')
        record({ clubId, status: 'checkout_ready' })
        return { status: 'checkout_ready', result, events, paymentSubmitted: false, reservationConfirmed: false }
      } catch (error) {
        if (error.code === 'PAYMENT_PREPARATION') return { status: 'blocked', reason: 'payment_preparation', events, paymentSubmitted: false, reservationConfirmed: false }
        if (error.code === 'NO_MATCHING_OFFER') {
          record({ clubId, status: 'no_matching_offer' })
          break
        }
        if (['SESSION_EXPIRED', 'SESSION_UNAVAILABLE'].includes(error.code)) {
          record({ clubId, status: error.code.toLowerCase() })
          return { status: 'blocked', reason: error.code.toLowerCase(), events, paymentSubmitted: false, reservationConfirmed: false }
        }
        // Browser errors may include sensitive page data; persist only known fields.
        record({ clubId, status: error.code === 'PRICE_LIMIT' ? 'over_budget' : 'preview_error', ...(selected ? { court: selected.court, durationMinutes: selected.durationMinutes } : {}), ...(error.code === 'PRICE_LIMIT' ? { price: error.price } : {}) })
        if (error.code !== 'PRICE_LIMIT') incomplete = true
        const key = selected && offerKey(selected)
        if (!key || excludedOffers.includes(key)) {
          incomplete = true
          break
        }
        excludedOffers.push(key)
        if (count === maxAttemptsPerClub - 1) {
          incomplete = true
          record({ clubId, status: 'attempt_limit' })
        }
      }
    }
  }
  return { status: incomplete ? 'incomplete' : 'no_match', events, paymentSubmitted: false, reservationConfirmed: false }
}

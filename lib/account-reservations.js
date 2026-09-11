import { createHash } from 'node:crypto'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc.js'
import timezone from 'dayjs/plugin/timezone.js'
import { ANYBUDDY_ORIGIN } from './anybuddy-session.js'

dayjs.extend(utc)
dayjs.extend(timezone)
const validId = id => typeof id === 'string' && /^[a-zA-Z\d_-]{1,100}$/.test(id)
const text = value => typeof value === 'string' ? value : null
const fingerprint = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
export const normalizeReservation = (match, { now = new Date() } = {}) => {
  if (!validId(match?.id) || !match.centerService || typeof match.centerService.centerName !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(match.dateTime || '') || typeof match.status !== 'string' || typeof match.isCancellableNow !== 'boolean') throw new Error('Unsupported reservation data; refusing a partial list')
  const parsed = dayjs.tz(match.dateTime, 'Europe/Paris')
  if (!parsed.isValid() || parsed.format('YYYY-MM-DDTHH:mm') !== match.dateTime) throw new Error('Invalid reservation date')
  const cancelled = match.status === 'cancelled' || match.myReservation?.status === 'cancelled'
  const past = parsed.valueOf() <= new Date(now).getTime()
  const confirmed = match.status === 'confirmed' && match.myReservation?.status === 'confirmed'
  return {
    id: match.id, club: match.centerService.centerName, court: text(match.centerService.serviceName), sport: text(match.centerService.activityId || match.centerService.activity),
    dateTime: match.dateTime, dateDisplay: text(match.dateFMT), timeDisplay: text(match.timeFMT), timeZone: 'Europe/Paris', durationMinutes: Number.isFinite(match.duration) ? match.duration : null,
    status: match.status, myReservationStatus: text(match.myReservation?.status),
    category: cancelled ? 'cancelled' : past ? 'past' : confirmed ? 'upcoming' : 'pending',
    reservationConfirmed: !cancelled && confirmed, hasOwnReservation: Boolean(match.myReservation?.reservationId),
    // Amounts are display strings from the site, never treated as a refund quote.
    priceDisplay: text(match.myReservation?.totalPrice), pricePaidByCardDisplay: text(match.myReservation?.pricePaidByCard),
    cancellable: !cancelled && !past && match.isCancellableNow && Boolean(match.myReservation?.reservationId),
    cancellationCondition: text(match.cancellationCondition), refundCondition: text(match.refundCondition),
    url: `${ANYBUDDY_ORIGIN}/fr/compte/reservations/${encodeURIComponent(match.id)}`,
  }
}

export const listReservations = async (fetchPage, options = {}) => {
  const all = []
  const seen = new Set()
  for (let page = 0; page < 100; page++) {
    const result = await fetchPage(all.length)
    if (!Array.isArray(result?.data) || typeof result.paging?.hasNextPage !== 'boolean') throw new Error('Invalid reservations page')
    if (!result.data.length && result.paging.hasNextPage) throw new Error('Reservation pagination made no progress')
    for (const match of result.data) {
      const reservation = normalizeReservation(match, options)
      if (seen.has(reservation.id)) throw new Error('Reservation pagination changed; list again before acting')
      seen.add(reservation.id)
      all.push(reservation)
    }
    if (!result.paging.hasNextPage) return all
  }
  throw new Error('Reservation pagination limit reached; list is incomplete')
}

export const cancelReservation = async ({ id, read, openDialog, submit, expectedVersion, confirm = false, beforeSubmit, readCancelled }) => {
  if (!validId(id)) throw new Error('Use an ID from reservations list')
  const reservation = (await read()).find(item => item.id === id)
  if (!reservation) throw new Error('Reservation no longer found; list again')
  if (reservation.category === 'cancelled') return { status: 'already_cancelled', reservation, verified: true }
  if (!reservation.cancellable) return { status: 'not_cancellable', reservation, submitted: false }
  const terms = await openDialog(reservation)
  if (typeof terms !== 'string' || !terms.trim()) throw new Error('Cancellation terms could not be inspected')
  const version = fingerprint({ reservation, terms })
  if (!confirm) return { status: 'cancellation_preview', reservation, terms, version, submitted: false }
  if (!expectedVersion || version !== expectedVersion) throw new Error('Reservation or cancellation terms changed; preview again before cancelling')
  await beforeSubmit?.()
  try {
    await submit()
  } catch {
    // A timeout may hide a successful cancellation. Read once, never repeat POST.
    try {
      const current = (await read()).find(item => item.id === id) || await readCancelled?.(reservation)
      if (current?.category === 'cancelled') return { status: 'cancelled', reservation: current, verified: true, submitted: true }
    } catch { /* Preserve an uncertain result. */ }
    return { status: 'cancellation_unverified', reservation, submitted: true, verified: false }
  }
  try {
    const current = (await read()).find(item => item.id === id) || await readCancelled?.(reservation)
    if (current?.category === 'cancelled') return { status: 'cancelled', reservation: current, verified: true, submitted: true }
  } catch { /* Missing data is not confirmation. */ }
  return { status: 'cancellation_unverified', reservation, submitted: true, verified: false }
}

// Cancelled bookings disappear from getUserMatchesAction. Their detail page
// remains available; absence from the list alone never proves cancellation.
export const readCancelledReservation = async (page, reservation) => {
  if (!validId(reservation.id) || reservation.url !== `${ANYBUDDY_ORIGIN}/fr/compte/reservations/${encodeURIComponent(reservation.id)}`) throw new Error('Invalid reservation detail identity')
  await page.goto(reservation.url, { waitUntil: 'domcontentloaded' })
  if (page.url() !== reservation.url) throw new Error('Unexpected reservation detail redirect')
  const main = page.locator('main')
  for (const label of [reservation.club, reservation.dateDisplay, reservation.timeDisplay]) {
    if (!label) throw new Error('Missing reservation display identity')
    await main.getByText(label, { exact: true }).waitFor()
  }
  await main.getByText('Annulé', { exact: true }).waitFor()
  return { ...reservation, status: 'cancelled', myReservationStatus: null, category: 'cancelled', reservationConfirmed: false, cancellable: false, verificationSource: 'reservation_detail' }
}

export const cancellationDialog = async (page, reservation) => {
  await page.goto(reservation.url, { waitUntil: 'domcontentloaded' })
  if (page.url() !== reservation.url) throw new Error('Unexpected reservation detail redirect')
  const main = page.locator('main')
  await main.getByText(reservation.club, { exact: true }).waitFor()
  if (!reservation.dateDisplay || !reservation.timeDisplay) throw new Error('Missing reservation display identity')
  await main.getByText(reservation.dateDisplay, { exact: true }).waitFor()
  await main.getByText(reservation.timeDisplay, { exact: true }).waitFor()
  const cancel = main.getByRole('button', { name: 'Annuler le match', exact: true })
  await cancel.waitFor({ state: 'visible' })
  await cancel.click()
  const dialog = page.getByRole('alertdialog')
  await dialog.waitFor({ state: 'visible' })
  const button = dialog.getByRole('button', { name: 'Confirmer l\'annulation', exact: true })
  await button.waitFor({ state: 'visible' })
  const description = dialog.locator('[data-slot="alert-dialog-description"]')
  const terms = await description.innerText()
  return { terms, submit: async () => {
    await button.click()
    await dialog.waitFor({ state: 'hidden', timeout: 20000 })
  } }
}

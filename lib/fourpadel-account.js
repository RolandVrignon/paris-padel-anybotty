import { providerScope } from './provider-session.js'
import { parisTime } from './availability.js'

export const FOURPADEL_ACCOUNT_URL = 'https://www.4padel.fr/mon-compte/mes-resa'
export const normalizeFourPadelReservations = (rows, accountScope) => {
  if (!Array.isArray(rows)) throw new Error('4PADEL reservation list format changed')
  // The observed account request has _limit=15; do not call a truncated list complete.
  if (rows.length >= 15) throw new Error('4PADEL reservation list may be truncated; pagination is not implemented')
  const seen = new Set()
  return rows.map(row => {
    if (!Number.isInteger(row.id) || seen.has(row.id) || typeof row.owner?.email !== 'string' || providerScope(row.owner.email) !== accountScope) throw new Error('4PADEL reservation identity could not be verified')
    seen.add(row.id)
    if (!Number.isInteger(row.sportType?.id)) throw new Error('4PADEL reservation sport missing')
    if (row.sportType.id !== 3) return null
    if (!Number.isInteger(row.center?.id) || !row.center.centerName || !row.field?.name || !Number.isFinite(Date.parse(row.startingDateZuluTime)) || !Number.isInteger(row.duration) || !Number.isFinite(row.price) || !['Pending', 'Confirmed', 'Cancelled', 'Canceled'].includes(row.booking_status)) throw new Error('4PADEL reservation details changed')
    return { id: String(row.id), centerId: row.center.id, club: row.center.centerName, court: row.field.name, dateTime: parisTime(row.startingDateZuluTime).slice(0, 16), durationMinutes: row.duration, totalEUR: row.price, status: row.booking_status, reservationConfirmed: row.booking_status === 'Confirmed', paidParts: row.nbOfPaidParticipations ?? null, capacity: row.capacity, fullyPaid: row.paid === true }
  }).filter(Boolean)
}
export const listFourPadelReservations = async session => {
  const page = await session.context.newPage()
  try {
    const pending = page.waitForResponse(response => new URL(response.url()).origin === 'https://api-front.lefive.fr' && new URL(response.url()).pathname === '/splf/v1/bookings' && response.request().method() === 'GET')
    pending.catch(() => {})
    await page.goto(FOURPADEL_ACCOUNT_URL, { waitUntil: 'domcontentloaded' })
    const response = await pending
    if (!response.ok()) throw new Error('4PADEL account list unavailable')
    const query = new URL(response.url()).searchParams
    if (!query.get('owner_like') || query.get('_limit') !== '15' || query.get('appId') !== '2') throw new Error('4PADEL account query scope changed')
    return { provider: '4padel', status: 'ok', scope: 'owned_reservations_in_portal_window', window: { from: query.get('from'), to: query.get('to') }, reservations: normalizeFourPadelReservations(await response.json(), session.accountScope) }
  } finally { await page.close() }
}

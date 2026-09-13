import { parisTime } from './availability.js'
import { DEFAULT_UCPA_CENTER, ucpaAccountApi, ucpaIdentityUrl, ucpaReservationsUrl } from './ucpa-centers.js'

export const UCPA_API = ucpaAccountApi(DEFAULT_UCPA_CENTER)
export const UCPA_RESERVATIONS_URL = ucpaReservationsUrl(DEFAULT_UCPA_CENTER)
export const validUcpaId = id => typeof id === 'string' && /^\d{1,20}$/.test(id)
const validCustomer = id => typeof id === 'string' && /^customer_[a-zA-Z0-9_-]+$/.test(id)
const validContact = id => typeof id === 'string' && /^horanet_id_[a-zA-Z0-9_-]+$/.test(id)

export const normalizeUcpaReservation = (session, customerUuid, { now = new Date(), contactId, center = DEFAULT_UCPA_CENTER } = {}) => {
  if (!validUcpaId(session?.id) || session.isTerrainSession !== true || typeof session.name !== 'string' || !Number.isFinite(session.start_time) || !Number.isFinite(session.end_time)) throw new Error('UCPA reservation format changed')
  const durationMinutes = Math.round((session.end_time - session.start_time) / 60)
  if (durationMinutes <= 0 || durationMinutes > 1440) throw new Error('UCPA reservation duration is invalid')
  const dateTime = parisTime(session.start_time * 1000).slice(0, 16)
  const booking = session.sessionBooking || session.sessionParticipant
  if (booking?.offerFilliere !== 'Padel') throw new Error('UCPA reservation sport cannot be verified as padel')
  const cents = booking.price
  if (!Number.isSafeInteger(cents) || cents < 0 || !Number.isInteger(session.max_participant) || session.max_participant !== 4) throw new Error('UCPA reservation price/capacity changed')
  // The list identifies captains by Horanet contact; detail uses customer UUID.
  const isCaptain = session.captain?.uuid === customerUuid || (validContact(contactId) && session.captain?.horanet_id === contactId)
  return {
    id: session.id, provider: 'ucpa', clubId: center.id, club: center.name, sport: 'Padel', court: session.name,
    dateTime, date: dateTime.slice(0, 10), startTime: dateTime.slice(11), startTimestamp: session.start_time,
    durationMinutes, environment: 'indoor', status: session.start_time * 1000 > new Date(now).getTime() ? 'upcoming' : 'past',
    isCaptain, participationEUR: cents / 100,
    // Only the non-subscriber tariff observed at checkout permits this inference.
    totalEUR: booking.haveSubscription === false ? cents * session.max_participant / 100 : null,
    reservationConfirmed: true,
  }
}

const jsonResponse = async response => {
  if (!response.ok()) throw new Error(`UCPA account read failed (HTTP ${response.status()})`)
  const body = await response.json()
  if (body?.success !== true) throw new Error('UCPA account read was not confirmed')
  return body
}

export const createUcpaAccountClient = async (context, { center = DEFAULT_UCPA_CENTER } = {}) => {
  const api = ucpaAccountApi(center)
  const identityUrl = ucpaIdentityUrl(center)
  const user = (await jsonResponse(await context.request.get(identityUrl))).data
  const site = (await jsonResponse(await context.request.get(`${api}/site`))).data
  if (!validCustomer(user?.uuid) || !validContact(user?.horanet_id) || typeof user.email !== 'string' || site?.workspace !== center.workspace || String(site.code_site_comptage) !== center.codeSiteComptage || site.is_internal_session !== false) throw new Error(`UCPA ${center.name} account/site identity changed`)
  const customerUuid = user.uuid
  const assertIdentity = async () => {
    const current = (await jsonResponse(await context.request.get(identityUrl))).data
    if (current.uuid !== customerUuid || current.email.toLowerCase() !== user.email.toLowerCase()) throw new Error('UCPA account identity changed during the operation')
  }
  const list = async ({ scope = 'active', now = new Date() } = {}) => {
    if (!['active', 'past', 'all'].includes(scope)) throw new Error('Invalid UCPA reservation scope')
    await assertIdentity()
    if (scope === 'all') return [...await list({ scope: 'active', now }), ...await list({ scope: 'past', now })]
    const timestamp = Math.floor(new Date(now).getTime() / 1000)
    const active = scope === 'active'
    // Match the portal: past has no lower bound; future covers the following year.
    const endDate = active ? timestamp + 366 * 86400 : timestamp
    const reservations = []
    const seen = new Set()
    let expectedTotal
    for (let page = 1; page <= 100; page++) {
      const body = await jsonResponse(await context.request.post(`${api}/amplify/kala/reservedSession`, { data: {
        contacts: [user.horanet_id], limit: 5, sort: [{ start_time: { order: active ? 'asc' : 'desc' } }],
        codeSiteComptage: Number(site.code_site_comptage), startDate: active ? timestamp : null, endDate, page,
        sortDirection: active ? 'asc' : 'desc', isInternalSession: false,
      } }))
      if (!Array.isArray(body.data) || body.data.length !== 1 || body.data[0].uuid !== user.horanet_id || !Array.isArray(body.data[0].sessions)) throw new Error('UCPA reservation page identity changed')
      const group = body.data[0]
      // The live endpoint omits total when there are no sessions.
      const total = group.total === undefined && group.sessions.length === 0 ? 0 : group.total
      if (!Number.isInteger(total) || total < 0 || (expectedTotal !== undefined && total !== expectedTotal)) throw new Error('UCPA reservation pagination changed; list again')
      expectedTotal = total
      for (const raw of group.sessions) {
        if (!validUcpaId(raw?.id)) throw new Error('UCPA reservation identifier changed')
        if (seen.has(raw.id)) throw new Error('UCPA reservation pagination returned duplicates')
        seen.add(raw.id)
        // The account can also contain squash; it must still count for pagination.
        if (raw.isTerrainSession === true) {
          const sport = (raw.sessionBooking || raw.sessionParticipant)?.offerFilliere
          if (typeof sport !== 'string' || !sport) throw new Error('UCPA reservation sport is missing; cannot return a partial list')
          if (sport === 'Padel') reservations.push(normalizeUcpaReservation(raw, customerUuid, { now, contactId: user.horanet_id, center }))
        } else if (raw.isTerrainSession !== false) throw new Error('UCPA reservation type changed')
      }
      if (seen.size === total) return reservations
      if (!group.sessions.length || seen.size > total) throw new Error('UCPA reservation list is incomplete')
    }
    throw new Error('UCPA reservation pagination exceeded its limit')
  }
  const detailUrl = id => {
    if (!validUcpaId(id)) throw new Error('Use a UCPA reservation ID returned by list')
    return `${ucpaReservationsUrl(center)}/${id}/${customerUuid}`
  }
  const detail = async id => {
    if (!validUcpaId(id)) throw new Error('Invalid UCPA reservation ID')
    await assertIdentity()
    const url = new URL(`${api}/kala/getSessionById`)
    url.search = new URLSearchParams({ sessionId: id, workspace: site.workspace, codeSiteComptage: String(site.code_site_comptage) }).toString()
    const data = (await jsonResponse(await context.request.get(url.href))).data
    if (data?.id !== id || data.sessionParticipant?.customerUuid !== customerUuid) throw new Error('UCPA reservation does not belong to this account')
    const reservation = normalizeUcpaReservation(data, customerUuid, { contactId: user.horanet_id, center })
    return { ...reservation, canCancelPart: reservation.isCaptain && data.sessionParticipant.isCaptain === true && data.sessionParticipant.cancelation === true && !data.sessionParticipant.cancelationTimestamp, participantsCount: data.participants?.length ?? null }
  }
  return { center, customerUuid, contactId: user.horanet_id, assertIdentity, list, detail, detailUrl, cancelUrl: `${api}/cancel-court-session` }
}

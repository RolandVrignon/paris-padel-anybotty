import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc.js'
import timezone from 'dayjs/plugin/timezone.js'
import customParseFormat from 'dayjs/plugin/customParseFormat.js'

dayjs.extend(utc)
dayjs.extend(timezone)
dayjs.extend(customParseFormat)
export const parisTime = value => dayjs(value).tz('Europe/Paris').format()
export const slotKey = slot => `${slot.startDateTime}|${slot.durationMinutes}`

export const queryWindow = now => {
  const from = dayjs(now).tz('Europe/Paris').format('YYYY-MM-DD')
  return { from, to: dayjs(from).add(35, 'day').format('YYYY-MM-DD') }
}

// The public calendar groups service offers by local starting time. Service IDs
// may change; opening detection uses time + duration, not those opaque IDs.
export const normalizeAvailability = (body, window) => {
  if (!body || !Array.isArray(body.data)) throw new Error('Unexpected availability response: data must be an array')
  const slots = new Map()
  for (const row of body.data) {
    if (typeof row.startDateTime !== 'string' || !dayjs(row.startDateTime, 'YYYY-MM-DDTHH:mm', true).isValid() || !Array.isArray(row.services)) throw new Error('Unexpected availability row')
    const date = row.startDateTime.slice(0, 10)
    if (date < window.from || date > window.to) throw new Error('Availability outside requested date window')
    for (const service of row.services) {
      if (!Number.isInteger(service.duration) || service.duration <= 0 || typeof service.id !== 'string' || !Number.isFinite(service.price) || service.price < 0) throw new Error('Unexpected service offer')
      const slot = { startDateTime: row.startDateTime, durationMinutes: service.duration }
      const key = slotKey(slot)
      if (!slots.has(key)) slots.set(key, { ...slot, offers: [] })
      slots.get(key).offers.push({ serviceId: service.id, priceCents: service.price, discountPriceCents: service.discountPrice ?? null })
    }
  }
  return [...slots.values()].sort((a, b) => slotKey(a).localeCompare(slotKey(b)))
}

export const fetchAvailability = async (club, window, { fetchImpl = fetch, signal } = {}) => {
  const url = new URL('https://www.anybuddyapp.com/api/v1/availabilities')
  url.search = new URLSearchParams({ clubSlug: new URL(club.url).pathname.split('/')[3], dateFrom: window.from, dateTo: `${window.to}T23:59`, activity: 'padel' })
  const startedAt = new Date().toISOString()
  const response = await fetchImpl(url, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000), redirect: 'error', headers: { 'Cache-Control': 'no-cache', Accept: 'application/json' } })
  if (!response.ok) {
    const error = new Error(`Anybuddy HTTP ${response.status}`)
    error.httpStatus = response.status
    const retry = response.headers.get('retry-after')
    error.retryAfterMs = retry && /^\d+$/.test(retry) ? Number(retry) * 1000 : Math.max(0, Date.parse(retry) - Date.now()) || 0
    throw error
  }
  if (Number(response.headers.get('age') || 0) > 0) throw new Error('Cached response cannot establish a fresh availability observation')
  const body = await response.json()
  const slots = normalizeAvailability(body, window)
  return { startedAt, finishedAt: new Date().toISOString(), window, slots, bookingRules: body.bookingRules ?? null, cache: { age: response.headers.get('age'), control: response.headers.get('cache-control'), serverDate: response.headers.get('date') } }
}

export const compareSnapshots = (previous, current, historicalFrontier = null) => {
  if (!previous) return [] // First collection is a baseline, never an opening.
  const known = new Set(previous.slots.map(slotKey))
  const frontier = historicalFrontier || previous.slots.at(-1)?.startDateTime.slice(0, 10)
  const added = current.slots.filter(slot => !known.has(slotKey(slot)))
  const events = []
  for (const date of [...new Set(added.map(slot => slot.startDateTime.slice(0, 10)))]) {
    const covered = date >= previous.window.from && date <= previous.window.to
    const slots = added.filter(slot => slot.startDateTime.startsWith(date)).map(({ startDateTime, durationMinutes }) => ({ startDateTime, durationMinutes }))
    events.push({
      type: covered && frontier && date > frontier ? 'new_day_candidate' : covered ? 'slots_added' : 'first_seen_outside_previous_window',
      targetDate: date, slots,
      lastValidAbsentAt: covered ? previous.startedAt : null,
      firstAvailableAt: current.finishedAt,
      firstAvailableParis: parisTime(current.finishedAt),
      intervalSeconds: covered ? Math.ceil((Date.parse(current.finishedAt) - Date.parse(previous.startedAt)) / 1000) : null,
      interpretation: 'unverified',
    })
  }
  const present = new Set(current.slots.map(slotKey))
  const removed = previous.slots.filter(slot => {
    const date = slot.startDateTime.slice(0, 10)
    return date >= current.window.from && date <= current.window.to && !present.has(slotKey(slot))
  })
  if (removed.length) events.push({ type: 'slots_removed', observedAt: current.finishedAt, slots: removed.map(({ startDateTime, durationMinutes }) => ({ startDateTime, durationMinutes })) })
  return events
}

export const nextRecord = (club, previous, snapshot) => {
  const events = compareSnapshots(previous?.snapshot, snapshot, previous?.historicalFrontier)
  const lastDate = snapshot.slots.at(-1)?.startDateTime.slice(0, 10) || null
  const historicalFrontier = [previous?.historicalFrontier, lastDate].filter(Boolean).sort().at(-1) || null
  return { version: 1, clubId: club.id, name: club.name, status: 'ok', attemptedAt: snapshot.finishedAt, attemptedAtParis: parisTime(snapshot.finishedAt), failures: 0, nextRetryAt: null, snapshot, historicalFrontier, events, recentOpenings: [...(previous?.recentOpenings || []), ...events.filter(event => event.type === 'new_day_candidate')].slice(-100) }
}

export const failureRecord = (club, previous, error, now = new Date()) => {
  const failures = (previous?.failures || 0) + 1
  const delay = Math.max(Math.min(300000 * 2 ** Math.min(failures - 1, 4), 3600000), error.retryAfterMs || 0)
  return { ...previous, version: 1, clubId: club.id, name: club.name, status: 'error', attemptedAt: now.toISOString(), attemptedAtParis: parisTime(now), failures, nextRetryAt: new Date(now.getTime() + delay).toISOString(), error: error.message, httpStatus: error.httpStatus ?? null, events: [] }
}

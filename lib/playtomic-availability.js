import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc.js'
import timezone from 'dayjs/plugin/timezone.js'
import { slotKey } from './availability.js'

dayjs.extend(utc)
dayjs.extend(timezone)

const price = value => {
  const match = /^(\d+(?:\.\d{1,2})?) EUR$/.exec(value || '')
  if (!match) throw new Error('Playtomic price format changed')
  return Math.round(Number(match[1]) * 100)
}

export const normalizePlaytomicDay = (rows, date, club) => {
  if (!Array.isArray(rows)) throw new Error('Playtomic availability format changed')
  const slots = new Map()
  const resources = new Set()
  for (const row of rows) {
    if (!/^[a-f0-9-]{36}$/.test(row.resource_id || '') || row.start_date !== date || !Array.isArray(row.slots)) throw new Error('Playtomic availability format changed')
    resources.add(row.resource_id)
    for (const offer of row.slots) {
      if (!/^\d{2}:\d{2}:\d{2}$/.test(offer.start_time || '') || !Number.isInteger(offer.duration) || offer.duration <= 0) throw new Error('Playtomic slot format changed')
      const startDateTime = `${date}T${offer.start_time.slice(0, 5)}`
      const slot = { startDateTime, durationMinutes: offer.duration }
      const key = slotKey(slot)
      if (!slots.has(key)) slots.set(key, { ...slot, offers: [] })
      slots.get(key).offers.push({ resourceId: row.resource_id, priceCents: price(offer.price), environment: club.environment })
    }
  }
  if (resources.size > club.resourceCount) throw new Error('Playtomic returned more resources than the club catalogue')
  return [...slots.values()].sort((a, b) => slotKey(a).localeCompare(slotKey(b)))
}

export const fetchPlaytomicDay = async (club, date, { fetchImpl = fetch, signal } = {}) => {
  const url = new URL('/api/clubs/availability', 'https://playtomic.com')
  url.search = new URLSearchParams({ tenant_id: club.tenantId, date, sport_id: 'PADEL' })
  const response = await fetchImpl(url, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000), redirect: 'error', headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' } })
  if (!response.ok) {
    const error = new Error(`Playtomic HTTP ${response.status}`)
    error.httpStatus = response.status
    const retry = response.headers.get('retry-after')
    error.retryAfterMs = retry && /^\d+$/.test(retry) ? Number(retry) * 1000 : Math.max(0, Date.parse(retry) - Date.now()) || 0
    throw error
  }
  if (Number(response.headers.get('age') || 0) > 0) throw new Error('Cached Playtomic response cannot establish a fresh observation')
  return normalizePlaytomicDay(await response.json(), date, club)
}

export const fetchPlaytomicAvailability = async (club, window, options = {}) => {
  const startedAt = new Date().toISOString()
  const days = dayjs(window.to).diff(dayjs(window.from), 'day') + 1
  if (!Number.isInteger(days) || days < 1 || days > 45) throw new Error('Invalid Playtomic availability window')
  const slots = []
  const publishedDates = []
  for (let index = 0; index < days; index++) {
    const date = dayjs(window.from).add(index, 'day').format('YYYY-MM-DD')
    const daily = await fetchPlaytomicDay(club, date, options)
    slots.push(...daily)
    if (daily.length) publishedDates.push(date)
  }
  return { startedAt, finishedAt: new Date().toISOString(), window, slots, publishedDates, source: club.url, access: 'public', availabilityScope: 'public_playtomic_calendar', coverageNote: 'Public Playtomic padel inventory; checkout and payment are not queried' }
}

export const playtomicCheckoutUrl = (club, offer) => {
  const url = new URL('/api/web-app/payments', 'https://playtomic.com')
  const start = dayjs.tz(`${offer.startDateTime}:00`, club.timeZone).utc().format('YYYY-MM-DDTHH:mm:ss.SSS[Z]')
  url.search = new URLSearchParams({ type: 'CUSTOMER_MATCH', tenant_id: club.tenantId, resource_id: offer.resourceId, start, duration: String(offer.durationMinutes), sport_id: 'PADEL' })
  return url.href
}

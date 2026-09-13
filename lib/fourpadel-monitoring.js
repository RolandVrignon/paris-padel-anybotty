import dayjs from 'dayjs'
import { slotKey } from './availability.js'
import { postFourPadelCalendar, calendarHttpError } from './monitoring-http.js'
import { applyFourPadelTimeZone, fourPadelLocalTime, fourPadelTimeZone } from './fourpadel-clubs.js'
export { createFourPadelSession } from './fourpadel-session.js'

const isCalendar = response => new URL(response.url()).pathname === '/bookingrules/allFields'

const monthNames = ['jan', 'fév', 'mar', 'avr', 'mai', 'juin', 'juil', 'aoû', 'sep', 'oct', 'nov', 'déc']
export const normalizeFourPadelDates = (cells, window) => {
  const count = dayjs(window.to).diff(dayjs(window.from), 'day') + 1
  if (!Array.isArray(cells) || cells.length < count) throw new Error('Incomplete 4PADEL date selector')
  return cells.slice(0, count).map((cell, index) => {
    const date = dayjs(window.from).add(index, 'day')
    if (Number(cell.day) !== date.date() || !cell.month?.toLowerCase().startsWith(monthNames[date.month()]) || typeof cell.disabled !== 'boolean') throw new Error('4PADEL date selector changed or crossed midnight')
    return { date: date.format('YYYY-MM-DD'), selectable: !cell.disabled }
  })
}

export const normalizeFourPadelDay = (rows, date, centerId) => {
  if (!Array.isArray(rows)) throw new Error('4PADEL calendar format changed')
  const slots = new Map()
  for (const row of rows) {
    if (typeof row.startingDateZuluTime !== 'string' || !dayjs(row.startingDateZuluTime).isValid() || !Number.isInteger(row.duration) || row.duration <= 0 || !Array.isArray(row.fields)) throw new Error('4PADEL offer format changed')
    // startingDate has a misleading UTC suffix; the ZuluTime field is the real instant.
    const startDateTime = fourPadelLocalTime(row.startingDateZuluTime, centerId).slice(0, 16)
    if (!startDateTime.startsWith(date)) throw new Error('4PADEL returned a different calendar day')
    for (const field of row.fields) {
      if (field.center?.id !== centerId || typeof field.canBookOnline !== 'boolean' || !Number.isInteger(field.id) || !Number.isFinite(field.webPrice) || field.webPrice < 0) throw new Error('4PADEL court format changed')
      if (!field.canBookOnline) continue
      const slot = { startDateTime, durationMinutes: row.duration }
      const key = slotKey(slot)
      if (!slots.has(key)) slots.set(key, { ...slot, offers: [] })
      slots.get(key).offers.push({ courtId: field.id, priceCents: Math.round(field.webPrice * 100), environment: field.fieldType?.name ?? null })
    }
  }
  return [...slots.values()].sort((a, b) => slotKey(a).localeCompare(slotKey(b)))
}

export const fetchFourPadelAvailability = async (target, window, { session, signal, fetchImpl = fetch, calendarFrom = window.from } = {}) => {
  const startedAt = new Date().toISOString()
  const page = await session.context.newPage()
  page.setDefaultTimeout(25000)
  try {
    await applyFourPadelTimeZone(page, target.centerId)
    let authorization
    let rules
    const pending = page.waitForResponse(isCalendar).then(response => {
      authorization = response.request().headers().authorization
      if (!response.ok()) throw calendarHttpError(response.status(), response.headers()['retry-after'])
    })
    // Observe only public booking-rule fields, never response bodies from login/payment.
    const visibility = page.waitForResponse(r => new URL(r.url()).pathname === '/bookingrules/me/visibility').then(async r => {
      if (!r.ok()) throw calendarHttpError(r.status(), r.headers()['retry-after'])
      const data = await r.json()
      if (![data.blockBookingAfterDaysDefault, data.blockBookingAfterDaysGlobal].every(n => Number.isInteger(n) && n >= 0)) throw new Error('4PADEL visibility rule format changed')
      rules = { defaultDays: data.blockBookingAfterDaysDefault, accountDays: data.blockBookingAfterDaysGlobal }
    })
    // Attach rejection handlers immediately, including when navigation fails.
    const ready = Promise.all([pending, visibility])
    ready.catch(() => {})
    await page.goto(target.url, { waitUntil: 'domcontentloaded' })
    await ready
    await page.locator('.lf-booking-date').first().waitFor()
    const cells = await page.locator('.lf-booking-date').evaluateAll(elements => elements.map(element => ({
      day: element.querySelector('.lf-booking-date-number')?.textContent.trim(),
      month: element.querySelectorAll('.lf-booking-date-day')[1]?.textContent.trim(),
      disabled: element.classList.contains('disabled'),
    })))
    const dates = normalizeFourPadelDates(cells, { from: calendarFrom, to: window.to }).filter(entry => entry.date >= window.from)
    if (!authorization || authorization === 'Bearer null' || authorization === 'Bearer undefined') throw new Error('4PADEL authenticated calendar session missing')
    const options = { authorization, signal, fetchImpl }
    const selectable = dates.some(entry => entry.selectable)
    const durations = selectable ? await postFourPadelCalendar('durations', { center_id: target.centerId, bookingType_id: '1', sportType_id: 3, isChannelWeb: true }, options) : null
    if (selectable && (!Array.isArray(durations.durations) || !durations.durations.length || !durations.durations.every(d => Number.isInteger(d) && d > 0))) throw new Error('4PADEL duration rules changed')
    const slots = []
    const publishedDates = []
    for (const entry of dates) {
      if (!entry.selectable) continue // Raw API inventory beyond the UI gate is NOT bookable.
      const nextDate = dayjs(entry.date).add(1, 'day').format('YYYY-MM-DD')
      const rows = await postFourPadelCalendar('slots', {
        startingDateZuluTime: dayjs.tz(`${entry.date}T00:00`, fourPadelTimeZone(target.centerId)).toISOString(),
        endingDateZuluTime: dayjs.tz(`${nextDate}T00:00`, fourPadelTimeZone(target.centerId)).subtract(1, 'millisecond').toISOString(),
        durations: durations.durations.join(','), capacity: 4, center_id: target.centerId,
        bookingType_id: '1', sportType_id: 3, isChannelWeb: true, computePriceWithDefaultCapaIfNoCapa: true,
      }, options)
      const daily = normalizeFourPadelDay(rows, entry.date, target.centerId)
      slots.push(...daily)
      if (rows.length) publishedDates.push(entry.date)
    }
    return { startedAt, finishedAt: new Date().toISOString(), window, slots, publishedDates,
      source: target.url, access: 'authenticated', accountScope: session.accountScope,
      bookingRules: rules, selectableDates: dates.filter(d => d.selectable).map(d => d.date),
      blockedDates: dates.filter(d => !d.selectable).map(d => d.date),
      coverageNote: 'Selectable UI dates and available doubles courts; no checkout or payment validation',
    }
  } catch (error) {
    // Playwright errors can contain a verbose call log; only emit our controlled diagnostics.
    if (/^4PADEL|^Incomplete 4PADEL|^Calendar|^Cached/.test(error.message)) throw error
    // eslint-disable-next-line preserve-caught-error -- omit browser call logs and private auth context
    throw new Error('4PADEL calendar read failed; session, network or page structure unavailable')
  } finally { await page.close() }
}

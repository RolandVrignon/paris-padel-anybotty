import dayjs from 'dayjs'
import { parisTime, slotKey } from './availability.js'
import { chromium } from 'playwright'
import { calendarHttpError, calendarJSON } from './monitoring-http.js'

const monday = date => dayjs(date).subtract((dayjs(date).day() + 6) % 7, 'day').format('YYYY-MM-DD')

// Meudon's initial response declares the four-month UI navigation limit.
// Verified against the disabled arrow on 2026-09-13 (week ending 2027-01-17).
// Read only weeks within this limit, not the unrestricted API inventory beyond it.
export const fetchUcpaMonthBoundary = async (target, requestedWindow, firstBody, requestUrl, startedAt, { targeted = false, previousBoundary, signal, readCalendar = calendarJSON } = {}) => {
  const url = new URL(requestUrl)
  const firstWeek = normalizeUcpaWeek(firstBody)
  const today = parisTime(startedAt).slice(0, 10)
  const origin = monday(today)
  const maxDate = Number(firstBody.planner.timeLabel?.maxDate)
  if (url.origin !== 'https://www.ucpa.com' || url.pathname !== '/sport-station/api/areas-offers/migrated' || url.searchParams.get('time') !== '0' || url.searchParams.get('period') !== 'months' || url.searchParams.get('timeframe') !== 'weekly' || url.searchParams.get('plannerMonthsToIndex') !== '4' || !Number.isFinite(maxDate) || maxDate <= 0) throw new Error('UCPA monthly calendar limit format changed')
  const declaredDate = parisTime(maxDate).slice(0, 10)
  const through = dayjs(monday(declaredDate)).add(6, 'day').format('YYYY-MM-DD')
  const lead = dayjs(through).diff(dayjs(today), 'day')
  if (lead < 0 || lead > 196 || ![origin, dayjs(origin).add(7, 'day').format('YYYY-MM-DD')].includes(firstWeek.dates[0])) throw new Error('UCPA monthly calendar date changed')
  const prior = previousBoundary && /^\d{4}-\d{2}-\d{2}$/.test(previousBoundary) ? previousBoundary : through
  const from = targeted ? requestedWindow.from : [monday(prior < through ? prior : through), firstWeek.dates[0]].sort().at(-1)
  // Include an entire newly opened pack and five following weeks, even if the
  // initial requested window only covered seven candidate days.
  const to = [requestedWindow.to, dayjs(through).add(35, 'day').format('YYYY-MM-DD')].sort().at(-1)
  if (from > to || dayjs(through).diff(dayjs(from), 'week') > 31) throw new Error('UCPA monthly scan coverage exceeds limit')
  const weeks = []
  for (let date = monday(from); date <= through; date = dayjs(date).add(7, 'day').format('YYYY-MM-DD')) {
    let week
    if (date === firstWeek.dates[0]) week = firstWeek
    else {
      url.searchParams.set('time', String(dayjs(date).diff(dayjs(origin), 'week')))
      week = normalizeUcpaWeek(await readCalendar(url, { signal }))
    }
    if (week.dates[0] !== date) throw new Error('UCPA monthly calendar pagination changed')
    weeks.push(week)
  }
  return {
    startedAt, finishedAt: new Date().toISOString(), window: { from, to },
    slots: weeks.flatMap(week => week.slots).filter(slot => slot.startDateTime.slice(0, 10) >= from && slot.startDateTime.slice(0, 10) <= to),
    publishedDates: weeks.flatMap(week => week.publishedDates).filter(date => date >= from && date <= to),
    source: target.url, access: 'public', navigationThroughDate: null,
    declaredCalendarThroughDate: through, declaredCalendarMaxDate: declaredDate,
    availabilityScope: 'public_monthly_calendar_boundary',
    coverageNote: 'Boundary from the initial public planner metadata, matched to native disabled-arrow navigation during integration; reads limited to accessible weeks near that boundary. Checkout authorization not tested.',
  }
}

export const normalizeUcpaWeek = body => {
  const columns = body?.planner?.columns
  if (!Array.isArray(columns) || columns.length !== 7) throw new Error('UCPA calendar week format changed')
  const slots = new Map()
  const publishedDates = []
  const dates = []
  for (const column of columns) {
    const date = column.dateFormated
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || dayjs(date).format('YYYY-MM-DD') !== date || !Array.isArray(column.items)) throw new Error('UCPA calendar day format changed')
    if (dates.length && date !== dayjs(dates.at(-1)).add(1, 'day').format('YYYY-MM-DD')) throw new Error('UCPA calendar week is not contiguous')
    dates.push(date)
    if (column.items.length) publishedDates.push(date)
    for (const item of column.items) {
      if (item.groupCode !== 'PADEL' || typeof item.isDisabled !== 'boolean' || !Number.isFinite(item.stock) || !Number.isFinite(item.start_time) || !Number.isFinite(item.end_time)) throw new Error('UCPA padel offer format changed')
      const startDateTime = parisTime(item.start_time).slice(0, 16)
      // UCPA's inclusive end timestamps end in :59; e.g. 07:00–07:59:59.
      const durationMinutes = Math.round((item.end_time - item.start_time) / 60000)
      if (!startDateTime.startsWith(date) || durationMinutes <= 0 || durationMinutes > 1440) throw new Error('UCPA offer date or duration changed')
      if (item.isDisabled || item.stock <= 0 || item.hoursReserveLimitation || item.reservationLimitMessage) continue
      const slot = { startDateTime, durationMinutes }
      const key = slotKey(slot)
      if (!slots.has(key)) slots.set(key, { ...slot, offers: [] })
      slots.get(key).offers.push({ availableCourts: item.stock })
    }
  }
  return { dates, publishedDates, slots: [...slots.values()].sort((a, b) => slotKey(a).localeCompare(slotKey(b))) }
}

export const assembleUcpaSnapshot = (target, window, weeks, startedAt, { targeted = false, reachedBoundary = true } = {}) => {
  if (!weeks.length) throw new Error('UCPA calendar coverage missing')
  for (let i = 1; i < weeks.length; i++) {
    if (weeks[i].dates[0] !== dayjs(weeks[i - 1].dates.at(-1)).add(1, 'day').format('YYYY-MM-DD')) throw new Error('UCPA calendar pagination changed')
  }
  const navigationThroughDate = weeks.at(-1).dates.at(-1)
  // Meudon may initially select next week once today's offers have ended.
  // Omit unvisited leading days instead of recording them as unavailable.
  if (weeks[0].dates[0] > window.from && target.monitoring?.navigationMode === 'window') window = { ...window, from: weeks[0].dates[0] }
  if (weeks[0].dates[0] > window.from || window.from > window.to || (!targeted && navigationThroughDate < window.from)) throw new Error('UCPA calendar date changed')
  // Observe two weeks beyond the navigation frontier, including group openings.
  const boundary = dayjs(navigationThroughDate).add(14, 'day').format('YYYY-MM-DD')
  const bounded = targeted || !reachedBoundary
  const monitoredWindow = bounded ? window : { from: window.from, to: boundary > window.to ? boundary : window.to }
  return {
    startedAt, finishedAt: new Date().toISOString(), window: monitoredWindow,
    slots: weeks.flatMap(week => week.slots).filter(slot => slot.startDateTime.slice(0, 10) >= window.from && (!bounded || slot.startDateTime.slice(0, 10) <= window.to)),
    publishedDates: weeks.flatMap(week => week.publishedDates).filter(date => date >= window.from && (!bounded || date <= window.to)),
    source: target.url, access: 'public', navigationThroughDate: reachedBoundary ? navigationThroughDate : null,
    navigationObservedThroughDate: navigationThroughDate, navigationLimitReached: reachedBoundary,
    availabilityScope: 'public_next_week_navigation',
    coverageNote: reachedBoundary ? 'Observed via next-week navigation until its disabled arrow; date picker alternatives, account rights and checkout not validated' : 'Stopped at the requested scan window; no navigation boundary or booking horizon established',
  }
}

export const fetchUcpaAvailability = async (target, window, { signal, targeted = false, previousBoundary } = {}) => {
  const startedAt = new Date().toISOString()
  const browser = await chromium.launch({ headless: true })
  const boundedSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(150000)]) : AbortSignal.timeout(150000)
  const stop = () => { void browser.close().catch(() => {}) }
  boundedSignal.addEventListener('abort', stop, { once: true })
  try {
    if (boundedSignal.aborted) throw new Error('Aborted')
    const page = await browser.newPage({ timezoneId: 'Europe/Paris' })
    page.setDefaultTimeout(25000)
    const calendarResponse = () => page.waitForResponse(response => new URL(response.url()).pathname === '/sport-station/api/areas-offers/migrated')
    const first = calendarResponse()
    first.catch(() => {})
    await page.goto(target.url, { waitUntil: 'domcontentloaded' })
    const component = page.locator('web-component-planner')
    const next = component.locator('.icon-angle-right-icon').locator('..')
    const weeks = []
    let response = await first
    for (let index = 0; index < 12; index++) {
      if (!response.ok()) throw calendarHttpError(response.status(), response.headers()['retry-after'])
      if (Number(response.headers().age || 0) > 0) throw new Error('Cached UCPA calendar')
      const body = await response.json()
      if (target.monitoring?.navigationMode === 'month-boundary') return await fetchUcpaMonthBoundary(target, window, body, response.url(), startedAt, { targeted, previousBoundary, signal: boundedSignal })
      weeks.push(normalizeUcpaWeek(body))
      const label = body.planner?.timeLabel?.firstDateDesktop
      if (typeof label !== 'string') throw new Error('UCPA calendar navigation label changed')
      await component.getByRole('button').filter({ hasText: `Semaine du ${label}` }).waitFor()
      if (await page.getByRole('button', { name: 'Refuser', exact: true }).isVisible()) await page.getByRole('button', { name: 'Refuser', exact: true }).click()
      if (await page.getByRole('button', { name: 'Fermer', exact: true }).isVisible()) await page.getByRole('button', { name: 'Fermer', exact: true }).click()
      const classes = await next.getAttribute('class')
      const reachedBoundary = classes.includes('pointer-events-none') && classes.includes('cursor-not-allowed')
      if (reachedBoundary || ((targeted || target.monitoring?.navigationMode === 'window') && weeks.at(-1).dates.at(-1) >= window.to)) {
        return assembleUcpaSnapshot(target, window, weeks, startedAt, { targeted, reachedBoundary })
      }
      const pending = calendarResponse()
      pending.catch(() => {})
      await next.click()
      response = await pending
    }
    throw new Error('UCPA navigation exceeded observation limit; horizon remains unknown')
  } catch (error) {
    if (/^UCPA|^Cached|^Calendar/.test(error.message)) throw error
    // eslint-disable-next-line preserve-caught-error -- omit verbose browser logs from stored observations
    throw new Error('UCPA public calendar navigation unavailable; no absence inferred')
  } finally {
    boundedSignal.removeEventListener('abort', stop)
    await browser.close()
  }
}

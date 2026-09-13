import { normalizeUcpaWeek } from './ucpa-monitoring.js'
import { validateDurations } from './duration-preferences.js'
import { validateCourtEnvironment } from './court-environment.js'
import { parseEURCents, validatePriceLimit } from './booking-price.js'
import { parisTime } from './availability.js'
import { readUcpaIdentity } from './ucpa-session.js'
import { DEFAULT_UCPA_CENTER, resolveUcpaCenter, ucpaAccountApi } from './ucpa-centers.js'

export const UCPA_PADEL_URL = DEFAULT_UCPA_CENTER.padelUrl
const acceptsUcpaEnvironment = (value, center) => validateCourtEnvironment(value).some(environment => environment === 'any' || environment === center.environment)
const ORIGIN = 'https://www.ucpa.com'
const FUNNEL = '/loisirs-reservation/reservation-terrain/'
const CALENDAR = '/sport-station/api/areas-offers/migrated'
const READ_POSTS = new Set(['session/products', 'unpaidBookings', 'serviceByReference', 'productService', 'customerSubscriptionContract', 'customerCards'].map(name => `/loisirs-reservation/api/amplify/${name}`))

// The preview only permits observed read-only POST queries after authentication.
// In particular, card registration and reservation submission are never allowed.
export const ucpaPreviewRequestAllowed = (url, method, center = DEFAULT_UCPA_CENTER) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return true
  const target = new URL(url)
  const api = new URL(ucpaAccountApi(center)).pathname
  return method === 'POST' && target.origin === ORIGIN && (READ_POSTS.has(target.pathname) || [`${api}/user/participants/allowedProduct`, `${api}/amplify/kala/reservedSession`].includes(target.pathname))
}
export const installUcpaPreviewGuard = async (context, { center = DEFAULT_UCPA_CENTER } = {}) => {
  let mutation = null
  let consumed = false
  const handler = route => {
    const req = route.request()
    if (ucpaPreviewRequestAllowed(req.url(), req.method(), center)) return route.fallback()
    if (mutation && !consumed && req.method() === 'POST' && req.url() === mutation.url) {
      consumed = true
      try { if (mutation.accept(req.postDataJSON())) return route.fallback() } catch { /* Fail closed. */ }
    }
    return route.abort('blockedbyclient')
  }
  await context.route('**/*', handler)
  return {
    dispose: () => context.unroute('**/*', handler),
    arm: (url, accept) => {
      if (mutation || !['https://www.ucpa.com/loisirs-reservation/api/users/createCourtBooking', `${ucpaAccountApi(center)}/cancel-court-session`].includes(url) || typeof accept !== 'function') throw new Error('Invalid UCPA mutation authorization')
      mutation = { url, accept }
    },
    get consumed() { return consumed },
  }
}

export const normalizeUcpaRequest = input => {
  let date = input.date
  if (typeof date === 'string' && /^\d{2}\/\d{2}\/\d{4}$/.test(date)) date = date.split('/').reverse().join('-')
  const parsed = new Date(`${date}T12:00:00Z`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) throw new Error('Invalid UCPA date; use YYYY-MM-DD or DD/MM/YYYY')
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(input.startTime || '')) throw new Error('Invalid UCPA time; use HH:mm')
  return { date, startTime: input.startTime, durationsMinutes: validateDurations(input.durationsMinutes), courtEnvironment: validateCourtEnvironment(input.courtEnvironment), maxPricePerHourEUR: validatePriceLimit(input.maxPricePerHourEUR) }
}

const frenchDate = date => new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris' }).format(new Date(`${date}T12:00:00Z`))
const frenchDatePattern = date => new RegExp(`^${frenchDate(date).replace(/ (\d) /, ' 0?$1 ')}$`, 'i')
const timeRange = (time, duration) => {
  const minutes = Number(time.slice(0, 2)) * 60 + Number(time.slice(3)) + duration
  if (minutes >= 1440) throw new Error('UCPA overnight sessions are not supported')
  return `${time} à ${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}
export const selectUcpaSlot = (week, request) => request.durationsMinutes.map(duration => week.slots.find(slot => slot.startDateTime === `${request.date}T${request.startTime}` && slot.durationMinutes === duration)).find(Boolean) || null

// Valid only for the observed non-subscriber captain flow, without discount codes.
// The displayed participation is one of four equal shares, NOT the court total.
export const inspectUcpaSummary = (text, request, durationMinutes, court) => {
  const lines = text.split('\n').map(line => line.trim()).filter(Boolean)
  if (!lines.some(line => frenchDatePattern(request.date).test(line)) || !lines.includes(timeRange(request.startTime, durationMinutes)) || !lines.includes(court) || !lines.includes('Padel')) throw new Error('UCPA summary date, time, court or sport differs from the selected offer')
  if (!lines.includes('Non abonné(e)') || !lines.includes('Capitaine') || !/Places réservées\s+1\s*\/\s*4\b/.test(text) || !text.includes('Garantie du Capitaine') || !text.includes('Règlement le jour J')) throw new Error('UCPA pricing model changed or discounted account; whole-court price cannot be verified')
  const prices = [...text.matchAll(/Ma participation:\s*([\d ,.]+)\s*€/g)]
  if (prices.length !== 1) throw new Error('UCPA participation price is missing or ambiguous')
  const participationCents = parseEURCents(prices[0][1])
  const totalCents = participationCents * 4
  const max = validatePriceLimit(request.maxPricePerHourEUR)
  if (!Number.isSafeInteger(totalCents)) throw new Error('Unexpected UCPA amount')
  const withinBudget = max === null || BigInt(totalCents) * 60n <= BigInt(Math.round(max * 100)) * BigInt(durationMinutes)
  return { participationEUR: participationCents / 100, totalEUR: totalCents / 100, pricePerHourEUR: totalCents * 60 / durationMinutes / 100, priceBasis: 'non_subscriber_participation_times_4', withinBudget, maxPricePerHourEUR: max, paymentTiming: 'session_day', captainGuaranteesWholeCourt: true }
}

const assertStep = (page, step) => {
  const url = new URL(page.url())
  if (url.origin !== ORIGIN || url.pathname !== `${FUNNEL}${step}`) throw new Error('Unexpected UCPA reservation step')
}
const nextStep = async page => {
  const next = page.getByRole('button', { name: 'Étape suivante', exact: true })
  await next.waitFor()
  // UCPA implements disabling through a class, not the native disabled attribute.
  if ((await next.getAttribute('class') || '').split(/\s+/).includes('disabled') || !await next.isEnabled()) throw new Error('UCPA next step is disabled')
  await next.click()
}
const assertSelection = async (page, request, duration, court) => {
  const date = page.getByText(frenchDatePattern(request.date))
  await date.waitFor()
  await page.getByText(timeRange(request.startTime, duration), { exact: true }).waitFor()
  if (court) await page.getByText(court, { exact: true }).waitFor()
}

export const advanceUcpaFunnel = async (page, request, durationMinutes, { verifyIdentity = async () => {}, onStage = () => {}, center = DEFAULT_UCPA_CENTER } = {}) => {
  await page.waitForURL(url => url.origin === ORIGIN && ['sessions', 'participants'].some(step => url.pathname === `${FUNNEL}${step}`))
  if (!request.durationsMinutes.includes(durationMinutes)) throw new Error('UCPA selected duration is excluded')
  let court
  if (new URL(page.url()).pathname.endsWith('/sessions')) {
    onStage('court_selection')
    assertStep(page, 'sessions')
    await page.getByText('Choisis ton terrain', { exact: true }).waitFor()
    await assertSelection(page, request, durationMinutes)
    const cards = page.locator('div.card-top.pointer').filter({ hasText: /^Terrain .+Padel/ })
    await cards.first().waitFor()
    const names = (await cards.allTextContents()).map(name => name.trim())
    if (new Set(names).size !== names.length) throw new Error('Ambiguous UCPA court choices')
    court = names[0]
    if (!court) throw new Error('UCPA court choices are empty')
    await cards.filter({ has: page.getByText(court, { exact: true }) }).click()
    await nextStep(page)
    await page.waitForURL(url => url.origin === ORIGIN && url.pathname === `${FUNNEL}participants`)
  }
  onStage('participants')
  assertStep(page, 'participants')
  await page.getByText('Ma participation', { exact: true }).waitFor()
  await assertSelection(page, request, durationMinutes, court)
  if (!court) {
    const name = page.locator('p').filter({ hasText: /^Terrain .+Padel.*$/ })
    await name.waitFor()
    court = (await name.innerText()).trim()
  }
  await verifyIdentity()
  // No Wellpass/promo-code toggle and no additional participants are selected.
  if (await page.locator('input[type="checkbox"]:checked').count()) throw new Error('UCPA participation options already selected; manual review required')
  await nextStep(page)
  await page.waitForURL(url => url.origin === ORIGIN && url.pathname === `${FUNNEL}payment`)
  onStage('payment_summary')
  assertStep(page, 'payment')
  await page.getByRole('heading', { name: 'Mon moyen de paiement', exact: true }).waitFor()
  await page.locator('.priceCircle').waitFor()
  await assertSelection(page, request, durationMinutes, court)
  const terms = page.locator('#cgi')
  await terms.waitFor()
  if (await terms.isChecked()) throw new Error('UCPA terms were unexpectedly accepted')
  await page.getByRole('button', { name: 'Réserver', exact: true }).waitFor()
  const pricing = inspectUcpaSummary(await page.locator('body').innerText(), request, durationMinutes, court)
  return { provider: 'ucpa', clubId: center.id, club: center.name, status: pricing.withinBudget ? 'checkout_ready' : 'no_match', ...(!pricing.withinBudget ? { reason: 'price_limit' } : {}), date: request.date, startTime: request.startTime, durationMinutes, court, environment: center.environment, ...pricing, termsAccepted: false, reservationSubmitted: false, paymentSubmitted: false }
}

export const ucpaSlotButton = (page, request, durationMinutes) => {
  const component = page.locator('web-component-planner')
  const dayName = frenchDate(request.date).split(' ')[0]
  const day = new RegExp(`^0?${Number(request.date.slice(-2))}$`)
  const column = component.locator('.mobile-day').filter({ has: page.getByRole('heading', { name: dayName, exact: true }) }).filter({ has: page.getByText(day) })
  const range = timeRange(request.startTime, durationMinutes).replace(' à ', ' - ').replaceAll(':', 'h')
  return column.locator('li').filter({ hasText: range }).getByRole('button', { name: /RÉSERVER$/ })
}

export const previewUcpaBooking = async (page, input, { onStage = () => {}, guard, center: selectedCenter = DEFAULT_UCPA_CENTER } = {}) => {
  const center = resolveUcpaCenter(selectedCenter.id || selectedCenter)
  const request = normalizeUcpaRequest(input)
  if (!acceptsUcpaEnvironment(request.courtEnvironment, center)) return { provider: 'ucpa', clubId: center.id, club: center.name, status: 'no_match', reason: 'environment_excluded', environment: center.environment, date: request.date, startTime: request.startTime, reservationSubmitted: false, paymentSubmitted: false }
  const now = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date()).replace(' ', 'T')
  if (`${request.date}T${request.startTime}` <= now) throw new Error('UCPA requested slot is in the past')
  const expectedIdentity = await readUcpaIdentity(page.context(), 20000, center)
  if (!expectedIdentity) throw new Error('UCPA session expired')
  if (!guard) await installUcpaPreviewGuard(page.context(), { center })
  await page.setViewportSize({ width: 600, height: 1000 })
  for (const name of ['Refuser', 'Fermer']) await page.addLocatorHandler(page.getByRole('button', { name, exact: true }), button => button.click())
  onStage('calendar')
  const calendarResponse = () => {
    const pending = page.waitForResponse(r => new URL(r.url()).origin === ORIGIN && new URL(r.url()).pathname === CALENDAR)
    pending.catch(() => {})
    return pending
  }
  const first = calendarResponse()
  await page.goto(center.padelUrl, { waitUntil: 'domcontentloaded' })
  let response = await first
  const component = page.locator('web-component-planner')
  for (let index = 0; index < center.calendarNavigationWeeks; index++) {
    if (!response.ok() || Number(response.headers().age || 0) > 0) throw new Error('UCPA calendar unavailable or cached')
    const body = await response.json()
    const week = normalizeUcpaWeek(body)
    const label = body.planner.timeLabel?.firstDateDesktop
    if (typeof label !== 'string') throw new Error('UCPA calendar label changed')
    await component.getByRole('button').filter({ hasText: `Semaine du ${label}` }).waitFor()
    if (week.dates.includes(request.date)) {
      const slot = selectUcpaSlot(week, request)
      if (!slot) return { provider: 'ucpa', status: 'no_match', reason: 'slot_unavailable', date: request.date, startTime: request.startTime, reservationSubmitted: false, paymentSubmitted: false }
      // The icon contributes a character to the accessible name before RÉSERVER.
      const identityResponse = page.waitForResponse(r => new URL(r.url()).origin === ORIGIN && new URL(r.url()).pathname === '/loisirs-reservation/api/users/sginfo')
      identityResponse.catch(() => {})
      const productsResponse = page.waitForResponse(r => new URL(r.url()).origin === ORIGIN && new URL(r.url()).pathname === '/loisirs-reservation/api/amplify/session/products')
      productsResponse.catch(() => {})
      await ucpaSlotButton(page, request, slot.durationMinutes).click()
      const result = await advanceUcpaFunnel(page, request, slot.durationMinutes, { center, onStage, verifyIdentity: async () => {
        const response = await identityResponse
        const identity = await response.json()
        if (!response.ok() || typeof identity.email !== 'string' || identity.email.toLowerCase() !== expectedIdentity.email.toLowerCase()) throw new Error('UCPA reservation account does not match the authenticated portal account')
      } })
      const response = await productsResponse
      if (!response.ok()) throw new Error('UCPA session identity lookup failed')
      const products = (await response.json()).products
      if (!Array.isArray(products)) throw new Error('UCPA session product format changed')
      const matches = products.flatMap(p => p.sessions || []).filter(s => s.name === result.court && parisTime(s.start_time * 1000).slice(0, 16) === `${request.date}T${request.startTime}` && Math.round((s.end_time - s.start_time) / 60) === result.durationMinutes)
      const ids = [...new Set(matches.map(s => s.id))]
      if (ids.length !== 1 || !/^\d+$/.test(ids[0])) throw new Error('UCPA selected session identity is ambiguous')
      return { ...result, sessionId: ids[0] }
    }
    const next = component.locator('.icon-angle-right-icon').locator('..')
    const classes = await next.getAttribute('class') || ''
    if (request.date < week.dates[0] || (classes.includes('pointer-events-none') && classes.includes('cursor-not-allowed'))) return { provider: 'ucpa', status: 'not_open', reason: 'outside_calendar_navigation', date: request.date, navigationThroughDate: week.dates.at(-1), reservationSubmitted: false, paymentSubmitted: false }
    const pending = calendarResponse()
    await next.click()
    response = await pending
  }
  throw new Error('UCPA calendar navigation exceeded limit')
}

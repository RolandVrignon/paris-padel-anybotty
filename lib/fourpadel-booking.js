import dayjs from 'dayjs'
import { FOURPADEL_CLUBS, fourPadelLocalTime, applyFourPadelTimeZone } from './fourpadel-clubs.js'
import { validateDurations } from './duration-preferences.js'
import { validateCourtEnvironment } from './court-environment.js'
import { validatePriceLimit, parseEURCents } from './booking-price.js'
import { normalizeFourPadelDates } from './fourpadel-monitoring.js'
import { providerScope } from './provider-session.js'

export { FOURPADEL_CLUBS } from './fourpadel-clubs.js'
const ORIGIN = 'https://www.4padel.fr'
const environmentOf = label => ({ 'Intérieur': 'indoor', 'Extérieur': 'outdoor' })[label]
export const normalizeFourPadelRequest = input => {
  const date = /^\d{2}\/\d{2}\/\d{4}$/.test(input.date || '') ? input.date.split('/').reverse().join('-') : input.date
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || dayjs(date).format('YYYY-MM-DD') !== date) throw new Error('Invalid 4PADEL date')
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(input.startTime || '')) throw new Error('Invalid 4PADEL time')
  if (!Object.hasOwn(FOURPADEL_CLUBS, input.clubId || '')) throw new Error('Choose an official 4PADEL club ID from: npm run 4padel -- clubs')
  return { clubId: input.clubId, date, startTime: input.startTime, durationsMinutes: validateDurations(input.durationsMinutes), courtEnvironment: validateCourtEnvironment(input.courtEnvironment), maxPricePerHourEUR: validatePriceLimit(input.maxPricePerHourEUR) }
}
export const withinFourPadelBudget = (cents, duration, maximum) => maximum === null || BigInt(cents) * 60n <= BigInt(Math.round(maximum * 100)) * BigInt(duration)
export const selectFourPadelOffer = (rows, input) => {
  const request = normalizeFourPadelRequest(input)
  if (!Array.isArray(rows)) throw new Error('4PADEL calendar format changed')
  for (const durationMinutes of request.durationsMinutes) {
    const candidates = rows.filter(row => fourPadelLocalTime(row.startingDateZuluTime, FOURPADEL_CLUBS[request.clubId].centerId).slice(0, 16) === `${request.date}T${request.startTime}` && row.duration === durationMinutes).flatMap(row => {
      if (!Array.isArray(row.fields)) throw new Error('4PADEL fields missing')
      return row.fields.filter(field => field.canBookOnline === true).map(field => {
        const environment = environmentOf(field.fieldType?.name)
        if (field.center?.id !== FOURPADEL_CLUBS[request.clubId].centerId || !Number.isInteger(field.id) || !field.name || !environment || !Number.isFinite(field.webPrice) || field.webPrice <= 0) throw new Error('4PADEL court details cannot be verified')
        return { ...request, durationMinutes, courtId: field.id, court: field.name, environment, totalCents: Math.round(field.webPrice * 100) }
      })
    })
    for (const environment of request.courtEnvironment) {
      const offer = candidates.find(offer => (environment === 'any' || offer.environment === environment) && withinFourPadelBudget(offer.totalCents, durationMinutes, request.maxPricePerHourEUR))
      if (offer) return offer
    }
  }
  return null
}
export const fourPadelPreviewRequestAllowed = (url, method) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return true
  const { origin, pathname } = new URL(url)
  return method === 'POST' && ((origin === 'https://api2-front.lefive.fr' && ['/bookingrules/allFields', '/bookingrules/me/visibility', '/offreItem/me/search'].includes(pathname)) || (origin === 'https://api-front.lefive.fr' && ['/splf/v1/bookingrules/filtered', '/splf/v1/offreItem/muchoOrMas'].includes(pathname)))
}
export const installFourPadelPreviewGuard = async context => {
  const handler = route => fourPadelPreviewRequestAllowed(route.request().url(), route.request().method()) ? route.fallback() : route.abort('blockedbyclient')
  await context.route('**/*', handler)
  return () => context.unroute('**/*', handler)
}
export const inspectFourPadelCheckout = (text, offer, parts = 1) => {
  const club = FOURPADEL_CLUBS[offer.clubId]
  const date = offer.date.split('-').reverse().join('/')
  const end = dayjs(`${offer.date}T${offer.startTime}`).add(offer.durationMinutes, 'minute').format('HH[h]mm')
  const range = `de ${offer.startTime.replace(':', 'h')} à ${end}`
  const environment = offer.environment === 'indoor' ? 'Intérieur' : 'Extérieur'
  if (!text.includes(`${club.name} en ${environment}`) || !text.includes(`le ${date}`) || !text.includes(range)) throw new Error('4PADEL checkout differs from the selected club, date, time or environment')
  const terms = text.match(/Un avoir sera généré en cas d'annulation plus de (\d+) h avant la réservation\./)?.[0]
  const payment = [...text.matchAll(/PAYER MAINTENANT\s+([\d,.\s]+)€/gi)]
  if (!terms || payment.length !== 1 || ![1, 2, 3, 4].includes(parts)) throw new Error('4PADEL payment or cancellation terms changed')
  const amountDueCents = parseEURCents(payment[0][1])
  if (amountDueCents * 4 !== offer.totalCents * parts || !withinFourPadelBudget(offer.totalCents, offer.durationMinutes, offer.maxPricePerHourEUR)) throw new Error('4PADEL whole-court price changed or exceeds budget')
  if (!text.includes('complément sur ta CB')) throw new Error('4PADEL captain guarantee changed')
  return { totalEUR: offer.totalCents / 100, pricePerHourEUR: offer.totalCents * 60 / offer.durationMinutes / 100, amountDueEUR: amountDueCents / 100, parts, captainGuaranteesWholeCourt: true, cancellation: { terms, refundType: 'credit', cutoffHours: Number(terms.match(/(\d+) h/)[1]) } }
}
const assertPath = (page, pathname) => {
  const url = new URL(page.url())
  if (url.origin !== ORIGIN || url.pathname !== pathname) throw new Error('Unexpected 4PADEL checkout page')
}
export const assertFourPadelBrowserIdentity = async (page, authorization, accountScope) => {
  if (!authorization || /^Bearer (null|undefined)$/.test(authorization)) throw new Error('4PADEL browser identity token unavailable')
  let identity
  try {
    identity = await page.evaluate(async authorization => {
      const response = await fetch('https://api-front.lefive.fr/splf/v1/users/me?qoodos_refund=false&appId=2', { headers: { authorization }, redirect: 'error', signal: AbortSignal.timeout(20000) })
      const user = response.ok ? await response.json() : {}
      return { status: response.status, email: user.email, id: user.id }
    }, authorization)
  } catch { throw new Error('4PADEL browser identity unavailable') }
  if (identity.status !== 200) throw new Error(`4PADEL browser identity unavailable (HTTP ${identity.status})`)
  if (typeof identity.email !== 'string' || providerScope(identity.email) !== accountScope) throw new Error('4PADEL browser account does not match the verified session')
  return { userId: identity.id }
}
// Select the club in the shared home-page menu before opening its calendar.
// The calendar's club picker can render duplicate modal entries.
export const openFourPadelCalendar = async (page, clubId) => {
  const club = FOURPADEL_CLUBS[clubId]
  if (!club) throw new Error('Choose an official 4PADEL club ID from: npm run 4padel -- clubs')
  await applyFourPadelTimeZone(page, club.centerId)
  await page.goto(ORIGIN, { waitUntil: 'domcontentloaded' })
  const current = page.locator('.lf-local-bar-center-info-btns a:has(.lf-local-bar-info-btn)')
  await current.waitFor()
  const expectedPath = `/nos-centres/${club.centerId}/`
  const selected = new URL(await current.getAttribute('href'), ORIGIN).pathname.startsWith(expectedPath)
  if (!selected) {
    await page.locator('.lf-local-bar-center-info').getByAltText('4Padel club', { exact: true }).click()
    const modal = page.locator('#centers-dropdown-modal')
    await modal.getByText(club.name, { exact: true }).click()
    await modal.waitFor({ state: 'hidden' })
  }
  await page.locator(`.lf-local-bar-center-info-btns a[href^="${expectedPath}"]:has(.lf-local-bar-info-btn)`).waitFor()
  const visibility = page.waitForResponse(r => new URL(r.url()).origin === 'https://api2-front.lefive.fr' && new URL(r.url()).pathname === '/bookingrules/me/visibility')
  visibility.catch(() => {})
  const calendar = page.waitForResponse(r => new URL(r.url()).origin === 'https://api2-front.lefive.fr' && new URL(r.url()).pathname === '/bookingrules/allFields')
  calendar.catch(() => {})
  await page.getByRole('button', { name: /que souhaites-tu faire/i }).click()
  await page.getByRole('menu').getByText('Réserver une piste', { exact: true }).click()
  await page.waitForURL(url => url.origin === ORIGIN && url.pathname === '/reservations/slots')
  const visibilityResponse = await visibility
  if (!visibilityResponse.ok()) throw new Error('4PADEL calendar visibility unavailable')
  await visibilityResponse.finished()
  const calendarResponse = await calendar
  if (!calendarResponse.ok()) throw new Error('4PADEL initial calendar unavailable')
  const selector = page.getByRole('button', { name: /Club\s+4PADEL/ })
  await selector.waitFor()
  if (!(await selector.innerText()).toLowerCase().includes(club.name.toLowerCase())) throw new Error('4PADEL calendar does not match the requested club')
  const rows = await calendarResponse.json()
  if (!Array.isArray(rows) || rows.some(row => !Array.isArray(row.fields) || row.fields.some(field => field.center?.id !== club.centerId))) throw new Error('4PADEL calendar data does not match the requested center')
  return calendarResponse
}

export const previewFourPadelBooking = async (page, input, { onStage = () => {}, accountScope, parts = 1 } = {}) => {
  const request = normalizeFourPadelRequest(input)
  if (!accountScope) throw new Error('4PADEL verified account scope is required')
  if (![1, 2, 3, 4].includes(parts)) throw new Error('4PADEL parts must be 1, 2, 3 or 4')
  const today = fourPadelLocalTime(new Date(), FOURPADEL_CLUBS[request.clubId].centerId).slice(0, 10)
  if (`${request.date}T${request.startTime}` <= fourPadelLocalTime(new Date(), FOURPADEL_CLUBS[request.clubId].centerId).slice(0, 16)) throw new Error('4PADEL slot is in the past')
  // Working calendar-day policy, not proof of the server's exact release boundary.
  if (dayjs(request.date).diff(dayjs(today), 'day') > 14) return { provider: '4padel', status: 'outside_assumed_horizon', ...request, horizonVerified: false, reservationSubmitted: false }
  const dispose = await installFourPadelPreviewGuard(page.context())
  try {
    onStage('calendar')
    // An authenticated APIRequestContext is not enough: the browser may itself
    // fail to load its account (observed HTTP 503/CORS), leaving a broken checkout.
    const calendarResponse = await openFourPadelCalendar(page, request.clubId)
    const identity = await assertFourPadelBrowserIdentity(page, calendarResponse.request().headers().authorization, accountScope)
    await page.locator('.lf-booking-date').first().waitFor()
    const cells = await page.locator('.lf-booking-date').evaluateAll(elements => elements.map(element => ({ day: element.querySelector('.lf-booking-date-number')?.textContent.trim(), month: element.querySelectorAll('.lf-booking-date-day')[1]?.textContent.trim(), disabled: element.classList.contains('disabled') })))
    const dates = normalizeFourPadelDates(cells, { from: today, to: request.date })
    if (!dates.at(-1).selectable) return { provider: '4padel', status: 'not_open', ...request, reservationSubmitted: false }
    const index = dates.findIndex(entry => entry.date === request.date)
    const pending = page.waitForResponse(r => new URL(r.url()).origin === 'https://api2-front.lefive.fr' && new URL(r.url()).pathname === '/bookingrules/allFields')
    pending.catch(() => {})
    await page.locator('.lf-booking-date').nth(index).click()
    const response = await pending
    if (!response.ok()) throw new Error('4PADEL calendar unavailable')
    const offer = selectFourPadelOffer(await response.json(), request)
    if (!offer) return { provider: '4padel', status: 'no_match', ...request, reservationSubmitted: false }
    const day = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: FOURPADEL_CLUBS[request.clubId].timeZone }).format(new Date(`${request.date}T12:00:00Z`))
    const row = page.locator('.lf-booking-smart-slot').filter({ has: page.locator('.description').filter({ hasText: `${day} de ${request.startTime.replace(':', 'h')}` }) })
    const label = offer.durationMinutes === 90 ? '1h30' : `${offer.durationMinutes / 60}h`
    await row.locator('.lf-booking-smart-slot-duration').filter({ has: page.locator('.duration').filter({ hasText: new RegExp(`^${label}$`) }) }).click()
    await page.waitForURL(url => url.origin === ORIGIN && ['/reservations/terrain', '/paiement'].includes(url.pathname))
    if (new URL(page.url()).pathname === '/reservations/terrain') {
      onStage('court_selection')
      await page.getByText(offer.court, { exact: true }).click()
      await page.waitForURL(url => url.origin === ORIGIN && url.pathname === '/paiement')
    }
    onStage('extras')
    assertPath(page, '/paiement')
    await page.getByText('On récapitule', { exact: true }).waitFor()
    const extras = await page.locator('select').evaluateAll(elements => elements.map(e => e.value))
    if (extras.some(value => value !== '0')) throw new Error('4PADEL extras are already selected')
    await page.getByRole('button', { name: /je paye/i }).click()
    await page.waitForURL(url => url.origin === ORIGIN && url.pathname === '/paiement/plusieurs')
    const pay = page.getByRole('button', { name: /payer maintenant/i })
    await pay.waitFor()
    assertPath(page, '/paiement/plusieurs')
    await page.locator('select.lf-select-custom').selectOption(String(parts))
    const pricing = inspectFourPadelCheckout(await page.locator('body').innerText(), offer, parts)
    onStage('checkout_ready')
    return { provider: '4padel', status: 'checkout_ready', ...offer, ...pricing, accountUserId: identity.userId, reservationSubmitted: false, paymentSubmitted: false }
  } finally { await dispose() }
}

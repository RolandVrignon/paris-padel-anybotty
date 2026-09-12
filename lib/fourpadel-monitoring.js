import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { chromium } from 'playwright'
import dayjs from 'dayjs'
import { parisTime, slotKey } from './availability.js'
import { loadFixedConfig, repositoryDirectory } from './config.js'
import { postFourPadelCalendar, calendarHttpError } from './monitoring-http.js'

const sessionDirectory = root => join(root, '.auth/providers')
const accountScope = email => createHash('sha256').update(email.trim().toLowerCase()).digest('hex')
const storePrivate = (path, data) => {
  const temp = `${path}.${process.pid}.tmp`
  writeFileSync(temp, JSON.stringify(data), { mode: 0o600 })
  chmodSync(temp, 0o600)
  renameSync(temp, path)
}
const isCalendar = response => new URL(response.url()).pathname === '/bookingrules/allFields'

// A single native login/session is shared by both centres during a collection.
// Only the ordinary login form and read-only calendar endpoints are used.
export const createFourPadelSession = async ({ root = repositoryDirectory, headed = false, signal } = {}) => {
  const account = loadFixedConfig({ root }).providers?.['4padel']?.account
  if (!account?.email || !account.password) throw new Error('Set providers.4padel.account in config.fixed.json')
  const scope = accountScope(account.email)
  const directory = sessionDirectory(root)
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  chmodSync(directory, 0o700)
  const path = join(directory, '4padel-session.json')
  const meta = join(directory, '4padel-session.meta.json')
  let reusable = false
  try { reusable = existsSync(path) && JSON.parse(readFileSync(meta, 'utf8')).accountScope === scope } catch { /* Reauthenticate an unbound/old session. */ }
  const browser = await chromium.launch({ headless: !headed })
  const stop = () => { void browser.close().catch(() => {}) }
  signal?.addEventListener('abort', stop, { once: true })
  const close = async () => { signal?.removeEventListener('abort', stop); await browser.close() }
  try {
    if (signal?.aborted) throw new Error('Aborted')
    const context = await browser.newContext({ ...(reusable ? { storageState: path } : {}), timezoneId: 'Europe/Paris' })
    const page = await context.newPage()
    page.setDefaultTimeout(25000)
    await page.goto('https://www.4padel.fr/reservations/slots?center=105', { waitUntil: 'domcontentloaded' })
    // Race DOM states, not a timeout which could silently misclassify an expired session.
    await page.locator('#email2:visible, .lf-booking-date').first().waitFor()
    if (await page.locator('#email2:visible').count()) {
      await page.locator('#email2:visible').fill(account.email)
      await page.locator('#password2:visible').fill(account.password)
      await page.getByRole('button', { name: /^Je me connecte$/i }).filter({ visible: true }).click()
    }
    await page.locator('.lf-booking-date').first().waitFor()
    await context.storageState({ path: `${path}.${process.pid}.tmp` })
    chmodSync(`${path}.${process.pid}.tmp`, 0o600)
    renameSync(`${path}.${process.pid}.tmp`, path)
    storePrivate(meta, { accountScope: scope })
    await page.close()
    return { context, accountScope: scope, close }
  } catch {
    await close()
    throw new Error('4PADEL session unavailable; check provider credentials with npm run auth:4padel')
  }
}

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
    const startDateTime = parisTime(row.startingDateZuluTime).slice(0, 16)
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

export const fetchFourPadelAvailability = async (target, window, { session, signal, fetchImpl = fetch } = {}) => {
  const startedAt = new Date().toISOString()
  const page = await session.context.newPage()
  page.setDefaultTimeout(25000)
  try {
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
    const dates = normalizeFourPadelDates(cells, window)
    if (!authorization || authorization === 'Bearer null' || authorization === 'Bearer undefined') throw new Error('4PADEL authenticated calendar session missing')
    const options = { authorization, signal, fetchImpl }
    const durations = await postFourPadelCalendar('durations', { center_id: target.centerId, bookingType_id: '1', sportType_id: 3, isChannelWeb: true }, options)
    if (!Array.isArray(durations.durations) || !durations.durations.length || !durations.durations.every(d => Number.isInteger(d) && d > 0)) throw new Error('4PADEL duration rules changed')
    const slots = []
    const publishedDates = []
    for (const entry of dates) {
      if (!entry.selectable) continue // Raw API inventory beyond the UI gate is NOT bookable.
      const nextDate = dayjs(entry.date).add(1, 'day').format('YYYY-MM-DD')
      const rows = await postFourPadelCalendar('slots', {
        startingDateZuluTime: dayjs.tz(`${entry.date}T00:00`, 'Europe/Paris').toISOString(),
        endingDateZuluTime: dayjs.tz(`${nextDate}T00:00`, 'Europe/Paris').subtract(1, 'millisecond').toISOString(),
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

#!/usr/bin/env node
import { assertCheckoutDuration, parseDurationsArgument } from '../lib/duration-preferences.js'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium } from 'playwright'
import { loadFixedConfig, repositoryDirectory, resolveCourtEnvironment, resolveDurationsMinutes } from '../lib/config.js'
import { checkSession } from '../lib/anybuddy-session.js'
import { fetchAvailability } from '../lib/availability.js'
import { assertCheckoutEnvironment, parseCourtEnvironmentArgument } from '../lib/court-environment.js'
import { selectCourtIfOffered } from '../lib/court-selection.js'
import { inspectCheckout, installPaymentGuard, prepareStripeCheckout } from '../lib/checkout.js'

let browser
let page
let stage = 'configuration'
try {
  const values = {}
  const args = process.argv.slice(2)
  const flags = new Set(['--to-stripe', '--headless'])
  for (let i = 0; i < args.length; i++) {
    const key = args[i]
    if (key in values || !['--club', '--date', '--time', '--duration', '--durations', '--court', '--court-environment', ...flags].includes(key)) throw new Error('Unknown or repeated argument')
    values[key] = flags.has(key) ? true : args[++i]
    if (!values[key] || String(values[key]).startsWith('--')) throw new Error('Missing argument value')
  }
  const clubs = JSON.parse(readFileSync(new URL('../data/clubs.json', import.meta.url), 'utf8'))
  const club = clubs.find(club => club.id === values['--club'])
  const date = values['--date']
  const time = values['--time']
  const courtEnvironment = resolveCourtEnvironment(values['--court-environment'] === undefined ? undefined : parseCourtEnvironmentArgument(values['--court-environment']))
  if (values['--duration'] !== undefined && values['--durations'] !== undefined) throw new Error('Use --duration or --durations, not both')
  const override = values['--durations'] !== undefined ? parseDurationsArgument(values['--durations']) : values['--duration'] !== undefined ? [Number(values['--duration'])] : undefined
  const durations = resolveDurationsMinutes(override)
  if (!club || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('Usage: checkout-preview.js --club ID --date YYYY-MM-DD --time HH:mm [--duration 60|90|120 | --durations 60,90,120] [--court NAME] [--court-environment indoor,outdoor|outdoor,indoor|indoor|outdoor|any] [--to-stripe] [--headless]')
  const dateValue = new Date(`${date}T12:00:00Z`)
  if (Number.isNaN(dateValue.getTime()) || dateValue.toISOString().slice(0, 10) !== date) throw new Error('Invalid calendar date')
  const availability = await fetchAvailability(club, { from: date, to: date })
  if (!availability.slots.some(slot => slot.startDateTime === `${date}T${time}` && durations.includes(slot.durationMinutes))) throw new Error('Requested slot is no longer available at this date/time/duration')
  const fixed = loadFixedConfig()
  browser = await chromium.launch({ headless: Boolean(values['--headless']), timeout: fixed.browser.timeoutMs })
  const context = await browser.newContext({ locale: 'fr-FR', timezoneId: 'Europe/Paris', storageState: resolve(repositoryDirectory, '.auth/session.json') })
  await installPaymentGuard(context)
  if (!await checkSession(context, fixed.account.email)) throw new Error('Session expired; run npm run auth:login')
  page = await context.newPage()
  page.setDefaultTimeout(Math.min(fixed.browser.timeoutMs, 30000))
  const rejectCookies = page.locator('#axeptio_overlay').getByRole('button', { name: 'Non merci', exact: true })
  await page.addLocatorHandler(rejectCookies, button => button.click())
  stage = 'club page'
  await page.goto(`${club.url}?date=${date}`, { waitUntil: 'domcontentloaded' })
  // Wait for the authenticated client UI before clicking server-rendered slots.
  await page.locator('a[href="/fr/compte"]').waitFor()
  stage = 'time selection'
  await page.getByRole('button', { name: new RegExp(`^${time},`) }).click()
  const sheet = page.getByTestId('booking-sheet')
  stage = 'court selection'
  const selected = await selectCourtIfOffered(page, { durationsMinutes: durations, court: values['--court'], courtEnvironment })
  const duration = selected.durationMinutes
  stage = 'checkout summary'
  const formattedDate = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris' }).format(dateValue)
  await sheet.filter({ hasText: formattedDate }).filter({ hasText: `${time} (${duration} min)` }).waitFor()
  const { summary } = await inspectCheckout(page, club.id)
  if (!summary.includes(formattedDate)) throw new Error('Selected date does not match the request')
  if (!summary.includes(`${time} (${duration} min)`)) throw new Error('Selected time/duration does not match the request')
  if (selected.court && !summary.split('\n').includes(selected.court)) throw new Error('Selected court does not match the request')
  await assertCheckoutDuration(sheet, durations, duration)
  await assertCheckoutEnvironment(sheet, courtEnvironment, selected.environment)
  const total = summary.match(/Total à payer\s+([\d\s,.]+)\s*€/)
  if (!total || Number(total[1].replace(/\s/g, '').replace(',', '.')) <= 0) throw new Error('Missing or unexpected checkout amount')
  console.log(`Duration preference order: ${durations.join(' > ')} min`)
  console.log(`Court environment preference: ${courtEnvironment.join(' > ')}`)
  if (selected.environment) console.log(`Selected environment: ${selected.environment}`)
  if (selected.usedModal) console.log(`Court selected: ${selected.court}`)
  console.log(`${club.name} — ${date} ${time}, ${duration} min, total ${total[1].trim()} EUR`)
  if (values['--to-stripe']) {
    stage = 'Stripe preparation'
    await prepareStripeCheckout(page, club.id, { courtEnvironment, expectedEnvironment: selected.environment, durationsMinutes: durations, expectedDuration: duration })
    console.log('Stripe form reached. No payment submitted. Browser closing; an unpaid cart/payment session may remain.')
  } else console.log('Checkout summary inspected. Terms unchecked and payment preparation not requested. A server-side cart may exist.')
} catch (error) {
  if (page) {
    await page.screenshot({ path: resolve(repositoryDirectory, '.auth/checkout-failure.png') }).catch(() => {})
    const sheet = page.getByTestId('booking-sheet')
    const details = { stage, summary: await sheet.innerText({ timeout: 1000 }).catch(() => null), frames: await sheet.locator('iframe').evaluateAll(elements => elements.map(element => ({ title: element.title, host: new URL(element.src).hostname }))).catch(() => []) }
    writeFileSync(resolve(repositoryDirectory, '.auth/checkout-failure.json'), JSON.stringify(details, null, 2), { mode: 0o600 })
  }
  console.error(error.message.includes('Call log:') ? `Browser step failed at ${stage}. Retry visibly and inspect the page; never retry Pay blindly.` : error.message)
  process.exitCode = 1
} finally {
  await browser?.close()
}

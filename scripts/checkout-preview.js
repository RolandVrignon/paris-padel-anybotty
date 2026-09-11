#!/usr/bin/env node
import { parseDurationsArgument } from '../lib/duration-preferences.js'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium } from 'playwright'
import { loadFixedConfig, repositoryDirectory, resolveCourtEnvironment, resolveDurationsMinutes, resolveMaxPricePerHourEUR } from '../lib/config.js'
import { checkSession } from '../lib/anybuddy-session.js'
import { fetchAvailability } from '../lib/availability.js'
import { parseCourtEnvironmentArgument } from '../lib/court-environment.js'
import { previewBookingOffer } from '../lib/booking-preview.js'
import { fillStripeCard, validateCardConfig } from '../lib/stripe-card.js'
import { installPaymentGuard, prepareStripeCheckout } from '../lib/checkout.js'

let browser
let page
let stage = 'configuration'
let sensitiveStage = false
try {
  const values = {}
  const args = process.argv.slice(2)
  const flags = new Set(['--to-stripe', '--headless', '--fill-card'])
  for (let i = 0; i < args.length; i++) {
    const key = args[i]
    if (key in values || !['--club', '--date', '--time', '--duration', '--durations', '--court', '--court-environment', '--max-price-per-hour', ...flags].includes(key)) throw new Error('Unknown or repeated argument')
    values[key] = flags.has(key) ? true : args[++i]
    if (!values[key] || String(values[key]).startsWith('--')) throw new Error('Missing argument value')
  }
  if (values['--fill-card'] && !values['--to-stripe']) throw new Error('--fill-card requires --to-stripe; final payment is never submitted')
  const clubs = JSON.parse(readFileSync(new URL('../data/clubs.json', import.meta.url), 'utf8'))
  const club = clubs.find(club => club.id === values['--club'])
  const date = values['--date']
  const time = values['--time']
  const courtEnvironment = resolveCourtEnvironment(values['--court-environment'] === undefined ? undefined : parseCourtEnvironmentArgument(values['--court-environment']))
  if (values['--duration'] !== undefined && values['--durations'] !== undefined) throw new Error('Use --duration or --durations, not both')
  const override = values['--durations'] !== undefined ? parseDurationsArgument(values['--durations']) : values['--duration'] !== undefined ? [Number(values['--duration'])] : undefined
  const durations = resolveDurationsMinutes(override)
  const maxPricePerHourEUR = resolveMaxPricePerHourEUR(values['--max-price-per-hour'] === undefined ? undefined : Number(values['--max-price-per-hour']))
  if (!club || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('Usage: checkout-preview.js --club ID --date YYYY-MM-DD --time HH:mm [--duration 60|90|120 | --durations 60,90,120] [--court NAME] [--court-environment indoor,outdoor|outdoor,indoor|indoor|outdoor|any] [--max-price-per-hour EUR] [--to-stripe [--fill-card]] [--headless]')
  const dateValue = new Date(`${date}T12:00:00Z`)
  if (Number.isNaN(dateValue.getTime()) || dateValue.toISOString().slice(0, 10) !== date) throw new Error('Invalid calendar date')
  const availability = await fetchAvailability(club, { from: date, to: date })
  if (!availability.slots.some(slot => slot.startDateTime === `${date}T${time}` && durations.includes(slot.durationMinutes))) throw new Error('Requested slot is no longer available at this date/time/duration')
  const fixed = loadFixedConfig()
  if (values['--fill-card']) validateCardConfig(fixed.payment)
  browser = await chromium.launch({ headless: Boolean(values['--headless']), timeout: fixed.browser.timeoutMs })
  const context = await browser.newContext({ locale: 'fr-FR', timezoneId: 'Europe/Paris', storageState: resolve(repositoryDirectory, '.auth/session.json'), serviceWorkers: 'block' })
  await installPaymentGuard(context)
  if (!await checkSession(context, fixed.account.email)) throw new Error('Session expired; run npm run auth:login')
  page = await context.newPage()
  page.setDefaultTimeout(Math.min(fixed.browser.timeoutMs, 30000))
  const result = await previewBookingOffer(page, club, { date, startTime: time, durationsMinutes: durations, courtEnvironment, maxPricePerHourEUR, court: values['--court'] }, { onStage: value => { stage = value } })
  console.log(`Duration preference order: ${durations.join(' > ')} min`)
  console.log(`Court environment preference: ${courtEnvironment.join(' > ')}`)
  if (result.environment) console.log(`Selected environment: ${result.environment}`)
  if (result.usedModal) console.log(`Court selected: ${result.court}`)
  console.log(`${club.name} — ${date} ${time}, ${result.durationMinutes} min, total ${result.totalEUR} EUR (${result.pricePerHourEUR.toFixed(2)} EUR/h)`)
  if (values['--to-stripe']) {
    stage = 'Stripe preparation'
    await prepareStripeCheckout(page, club.id, { courtEnvironment, expectedEnvironment: result.environment, durationsMinutes: durations, expectedDuration: result.durationMinutes, maxPricePerHourEUR })
    if (values['--fill-card']) {
      sensitiveStage = true
      stage = 'Stripe card entry'
      console.log(JSON.stringify(await fillStripeCard(page, fixed.payment)))
    }
    console.log('Stripe form reached. No payment submitted. Browser closing; an unpaid cart/payment session may remain.')
  } else console.log('Checkout summary inspected. Terms unchecked and payment preparation not requested. A server-side cart may exist.')
} catch (error) {
  if (page && !sensitiveStage) {
    await page.screenshot({ path: resolve(repositoryDirectory, '.auth/checkout-failure.png') }).catch(() => {})
    const sheet = page.getByTestId('booking-sheet')
    const details = { stage, summary: await sheet.innerText({ timeout: 1000 }).catch(() => null), frames: await sheet.locator('iframe').evaluateAll(elements => elements.map(element => ({ title: element.title, host: new URL(element.src).hostname }))).catch(() => []) }
    writeFileSync(resolve(repositoryDirectory, '.auth/checkout-failure.json'), JSON.stringify(details, null, 2), { mode: 0o600 })
  }
  console.error(sensitiveStage ? 'Stripe card entry failed; no screenshot or field values saved, and no final payment requested.' : error.message.includes('Call log:') ? `Browser step failed at ${stage}. Retry visibly and inspect the page; never retry Pay blindly.` : error.message)
  process.exitCode = 1
} finally {
  await browser?.close()
}

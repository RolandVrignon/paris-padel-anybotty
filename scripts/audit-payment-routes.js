#!/usr/bin/env node
// Inspect live empty Stripe forms. Never import card filling or final payment.
import { chromium } from 'playwright'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc.js'
import timezone from 'dayjs/plugin/timezone.js'
import { repositoryDirectory, loadFixedConfig } from '../lib/config.js'
import { checkSession } from '../lib/anybuddy-session.js'
import { fetchAvailability } from '../lib/availability.js'
import { previewBookingOffer } from '../lib/booking-preview.js'
import { prepareStripeCheckout, installPaymentGuard } from '../lib/checkout.js'
import { findStripeCardFrame, CARD_SELECTORS } from '../lib/stripe-card.js'
import { acquireLock } from '../lib/observation-store.js'

dayjs.extend(utc)
dayjs.extend(timezone)
let browser
let release
try {
  const args = process.argv.slice(2)
  if (args.length && (args.length !== 2 || args[0] !== '--club')) throw new Error('Usage: audit-payment-routes.js [--club ID]')
  const catalogue = JSON.parse(readFileSync(new URL('../data/clubs.json', import.meta.url)))
  const clubs = args.length ? catalogue.filter(club => club.id === args[1]) : catalogue
  if (!clubs.length) throw new Error('Unknown club')
  const fixed = loadFixedConfig()
  const directory = resolve(repositoryDirectory, '.auth/payment-routes-audit')
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  release = acquireLock(resolve(repositoryDirectory, '.auth/booking-search'))
  if (!release) throw new Error('A booking search or audit is already running')
  browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ storageState: resolve(repositoryDirectory, '.auth/session.json'), locale: 'fr-FR', timezoneId: 'Europe/Paris', serviceWorkers: 'block' })
  const guard = await installPaymentGuard(context)
  context.setDefaultTimeout(15000)
  if (!await checkSession(context, fixed.account.email)) throw new Error('Session expired; run npm run auth:login')
  const from = dayjs().tz('Europe/Paris').add(1, 'day').format('YYYY-MM-DD')
  const to = dayjs(from).add(14, 'day').format('YYYY-MM-DD')
  const results = []
  for (const club of clubs) {
    let stage = 'availability'
    let result = { clubId: club.id, clubName: club.name, checkedAt: new Date().toISOString(), status: 'unverified' }
    try {
      const snapshot = await fetchAvailability(club, { from, to })
      const slots = snapshot.slots.filter(slot => [60, 90, 120].includes(slot.durationMinutes)).slice(0, 3)
      if (!slots.length) result.status = 'no_available_slot'
      for (const slot of slots) {
        const page = await context.newPage()
        try {
          stage = 'checkout'
          const request = { date: slot.startDateTime.slice(0, 10), startTime: slot.startDateTime.slice(11), durationsMinutes: [slot.durationMinutes], courtEnvironment: ['any'], maxPricePerHourEUR: null }
          const offer = await previewBookingOffer(page, club, request)
          stage = 'stripe'
          await prepareStripeCheckout(page, club.id, { ...request, expectedDuration: offer.durationMinutes, expectedEnvironment: offer.environment })
          stage = 'card_route'
          let route
          const frame = await findStripeCardFrame(page, { onDetected: value => { route = value } })
          const fields = []
          for (const [key, selector] of Object.entries(CARD_SELECTORS)) {
            const field = frame.locator(selector)
            if (await field.count() === 1 && await field.isVisible()) {
              fields.push(await field.evaluate((element, key) => ({ key, tag: element.tagName.toLowerCase(), id: element.id, name: element.getAttribute('name'), autocomplete: element.getAttribute('autocomplete') }), key))
            }
          }
          if (!['cardNumber', 'expiry', 'cvc'].every(key => fields.some(field => field.key === key))) throw new Error('Required card fields absent')
          delete result.failedStage
          result = { ...result, status: 'verified', ...route, date: request.date, startTime: request.startTime, durationMinutes: offer.durationMinutes, court: offer.court, totalEUR: offer.totalEUR, usedCourtModal: offer.usedModal, fields, paymentSubmitted: false, cardFilled: false }
          break
        } catch {
          result = { ...result, status: 'unverified', failedStage: stage }
          // Retry only a lost offer before Stripe, never the payment-preparation click.
          if (stage !== 'checkout') break
        } finally { await page.close().catch(() => {}) }
      }
    } catch (error) {
      result = { ...result, status: 'unverified', failedStage: stage, ...(error.httpStatus ? { httpStatus: error.httpStatus } : {}) }
      if ([401, 403, 429].includes(error.httpStatus)) {
        results.push(result)
        console.log(JSON.stringify(result))
        break
      }
    }
    results.push(result)
    writeFileSync(resolve(directory, 'latest.json'), JSON.stringify({ checkedAt: new Date().toISOString(), scope: clubs.map(club => club.id), results, paymentSubmitted: guard.submitted, cardFilled: false }, null, 2), { mode: 0o600 })
    console.log(JSON.stringify(result))
  }
  writeFileSync(resolve(directory, 'latest.json'), JSON.stringify({ checkedAt: new Date().toISOString(), scope: clubs.map(club => club.id), results, paymentSubmitted: guard.submitted, cardFilled: false }, null, 2), { mode: 0o600 })
  if (guard.submitted) throw new Error('Unexpected payment confirmation')
  if (results.length !== clubs.length || results.some(result => result.status !== 'verified')) process.exitCode = 2
  if (await checkSession(context, fixed.account.email)) await context.storageState({ path: resolve(repositoryDirectory, '.auth/session.json') })
} catch (error) {
  console.error(error.message.includes('Call log:') ? 'Audit browser error; no payment authorized' : error.message)
  process.exitCode = 1
} finally {
  try { await browser?.close() } finally { release?.() }
}

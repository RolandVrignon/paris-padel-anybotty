#!/usr/bin/env node
import { readFileSync, writeFileSync, renameSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium } from 'playwright'
import { loadRequestConfig, loadFixedConfig, repositoryDirectory, validateAccount } from '../lib/config.js'
import { validateRequest } from '../lib/plan.js'
import { checkSession } from '../lib/anybuddy-session.js'
import { fetchAvailability } from '../lib/availability.js'
import { previewBookingOffer } from '../lib/booking-preview.js'
import { searchBooking } from '../lib/booking-search.js'
import { payBookingOffer, paymentStore, reconcilePayment, sameMatchTime } from '../lib/booking-payment.js'
import { validateCardConfig } from '../lib/stripe-card.js'
import { discoverMatchesAction, readMatchesPage } from '../lib/anybuddy-actions.js'
import { listReservations } from '../lib/account-reservations.js'
import { installPaymentGuard } from '../lib/checkout.js'
import { acquireLock } from '../lib/observation-store.js'

let browser
let release
try {
  const args = process.argv.slice(2)
  let path
  let headless = false
  let pay = false
  let reconcile = false
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--pay' && !pay) pay = true
    else if (args[i] === '--reconcile' && !reconcile) reconcile = true
    else if (args[i] === '--headless' && !headless) headless = true
    else if (args[i] === '--config' && path === undefined && args[i + 1] && !args[i + 1].startsWith('--')) path = args[++i]
    else throw new Error('Usage: booking-search.js [--config PATH] [--headless] [--pay | --reconcile]')
  }
  if (pay && reconcile) throw new Error('Use either --pay or --reconcile')
  const clubs = JSON.parse(readFileSync(new URL('../data/clubs.json', import.meta.url), 'utf8'))
  const input = loadRequestConfig({ path })
  const request = validateRequest(input, clubs)
  const fixed = loadFixedConfig()
  validateAccount(fixed, { requirePassword: false })
  const directory = resolve(repositoryDirectory, '.auth/booking-search')
  release = acquireLock(directory)
  if (!release) throw new Error('Another booking search is running')
  const store = paymentStore(resolve(repositoryDirectory, '.auth/payments'), fixed.account.email, request)
  if (pay && !store.read()) validateCardConfig(fixed.payment)
  let context
  let action
  const getContext = async () => {
    try {
      if (!context) {
        browser = await chromium.launch({ headless, timeout: fixed.browser.timeoutMs })
        context = await browser.newContext({ locale: 'fr-FR', timezoneId: 'Europe/Paris', storageState: resolve(repositoryDirectory, '.auth/session.json'), serviceWorkers: 'block' })
        await installPaymentGuard(context)
        context.setDefaultTimeout(Math.min(fixed.browser.timeoutMs, 30000))
      }
      if (!await checkSession(context, fixed.account.email)) {
        const error = new Error('Session expired; run npm run auth:login')
        error.code = 'SESSION_EXPIRED'
        throw error
      }
      return context
    } catch {
      const error = new Error('Browser or session unavailable; check auth:check before retrying')
      error.code = 'SESSION_UNAVAILABLE'
      throw error
    }
  }
  const readReservations = async () => {
    const activeContext = await getContext()
    if (!action) {
      const discovery = await activeContext.newPage()
      try { action = await discoverMatchesAction(discovery) } finally { await discovery.close() }
    }
    return listReservations(after => readMatchesPage(activeContext, action, after))
  }
  let result
  if ((pay || reconcile) && store.read()) {
    const journal = store.read()
    result = await reconcilePayment(journal, readReservations)
    store.save({ ...journal, ...result })
  } else if (reconcile) result = { status: 'not_run', paymentSubmitted: false, reservationConfirmed: false }
  else if (pay) {
    const existing = (await readReservations()).find(row => sameMatchTime(row, request))
    if (existing) result = { status: 'existing_reservation', reservation: existing, paymentSubmitted: false, reservationConfirmed: existing.reservationConfirmed }
  }
  if (!result) result = await searchBooking(input, clubs, {
    mode: pay ? 'pay' : 'preview',
    fetchAvailability,
    attempt: async (club, request, options) => {
      const activeContext = await getContext()
      const page = await activeContext.newPage()
      let stage = 'start'
      let sensitive = false
      try {
        const offer = await previewBookingOffer(page, club, request, { ...options, onStage: value => { stage = value } })
        if (!pay) return offer
        sensitive = true
        try { return await payBookingOffer(page, offer, request, { payment: fixed.payment, store, readReservations, headed: !headless, onEvent: event => console.error(JSON.stringify(event)) }) } catch {
          if (store.read()) return { status: 'payment_unverified', paymentSubmitted: true, reservationConfirmed: false }
          throw Object.assign(new Error('Payment preparation failed before final submission'), { code: 'PAYMENT_PREPARATION' })
        }
      } catch (error) {
        if (!sensitive && !['NO_MATCHING_OFFER', 'PRICE_LIMIT'].includes(error.code)) {
          await page.screenshot({ path: resolve(directory, 'failure.png') }).catch(() => {})
          writeFileSync(resolve(directory, 'failure.json'), JSON.stringify({ clubId: club.id, stage }), { mode: 0o600 })
        }
        throw error
      } finally { await page.close().catch(() => {}) }
    },
    onEvent: event => console.error(JSON.stringify(event)),
  })
  const report = { ...result, request, finishedAt: new Date().toISOString(), mode: pay ? 'pay' : reconcile ? 'reconcile' : 'preview', note: pay || reconcile ? 'Only a confirmed Anybuddy reservation proves success. Never retry an uncertain payment.' : 'No conditions accepted or payment submitted. An unpaid server cart may remain.' }
  const temporary = resolve(directory, 'latest.json.tmp')
  writeFileSync(temporary, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 })
  renameSync(temporary, resolve(directory, 'latest.json'))
  console.log(JSON.stringify(report, null, 2))
  process.exitCode = ['checkout_ready', 'booked', 'existing_reservation'].includes(result.status) ? 0 : result.status === 'no_match' ? 2 : 1
} catch (error) {
  console.error(error.message.includes('Call log:') || error.message.includes('browser.newContext') ? 'Browser/session error; check auth:check and retry visibly.' : error.message)
  process.exitCode = 1
} finally {
  try { await browser?.close() } finally { release?.() }
}

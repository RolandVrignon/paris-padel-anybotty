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
import { installPaymentGuard } from '../lib/checkout.js'
import { acquireLock } from '../lib/observation-store.js'

let browser
let release
try {
  const args = process.argv.slice(2)
  let path
  let headless = false
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--headless' && !headless) headless = true
    else if (args[i] === '--config' && path === undefined && args[i + 1] && !args[i + 1].startsWith('--')) path = args[++i]
    else throw new Error('Usage: booking-search.js [--config PATH] [--headless]')
  }
  const clubs = JSON.parse(readFileSync(new URL('../data/clubs.json', import.meta.url), 'utf8'))
  const input = loadRequestConfig({ path })
  const request = validateRequest(input, clubs)
  const fixed = loadFixedConfig()
  validateAccount(fixed, { requirePassword: false })
  const directory = resolve(repositoryDirectory, '.auth/booking-search')
  release = acquireLock(directory)
  if (!release) throw new Error('Another booking search is running')
  let context
  const getContext = async () => {
    try {
      if (!context) {
        browser = await chromium.launch({ headless, timeout: fixed.browser.timeoutMs })
        context = await browser.newContext({ locale: 'fr-FR', timezoneId: 'Europe/Paris', storageState: resolve(repositoryDirectory, '.auth/session.json') })
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
  const result = await searchBooking(input, clubs, {
    fetchAvailability,
    attempt: async (club, request, options) => {
      const activeContext = await getContext()
      const page = await activeContext.newPage()
      let stage = 'start'
      try {
        return await previewBookingOffer(page, club, request, { ...options, onStage: value => { stage = value } })
      } catch (error) {
        if (!['NO_MATCHING_OFFER', 'PRICE_LIMIT'].includes(error.code)) {
          await page.screenshot({ path: resolve(directory, 'failure.png') }).catch(() => {})
          writeFileSync(resolve(directory, 'failure.json'), JSON.stringify({ clubId: club.id, stage }), { mode: 0o600 })
        }
        throw error
      } finally { await page.close() }
    },
    onEvent: event => console.error(JSON.stringify(event)),
  })
  const report = { ...result, request, finishedAt: new Date().toISOString(), mode: 'preview', note: 'No conditions accepted or payment submitted. An unpaid server cart may remain. This run does not schedule future attempts.' }
  const temporary = resolve(directory, 'latest.json.tmp')
  writeFileSync(temporary, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 })
  renameSync(temporary, resolve(directory, 'latest.json'))
  console.log(JSON.stringify(report, null, 2))
  process.exitCode = result.status === 'checkout_ready' ? 0 : result.status === 'no_match' ? 2 : 1
} catch (error) {
  console.error(error.message.includes('Call log:') || error.message.includes('browser.newContext') ? 'Browser/session error; check auth:check and retry visibly.' : error.message)
  process.exitCode = 1
} finally {
  try { await browser?.close() } finally { release?.() }
}

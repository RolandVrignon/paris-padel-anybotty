#!/usr/bin/env node
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium } from 'playwright'
import { loadFixedConfig, repositoryDirectory, validateAccount } from '../lib/config.js'
import { checkSession, loginWithPage, saveSession } from '../lib/anybuddy-session.js'

let browser
try {
  const args = process.argv.slice(2)
  if (args.some(arg => !['--headed', '--headless', '--check', '--manual'].includes(arg)) || (args.includes('--headed') && args.includes('--headless')) || (args.includes('--check') && args.includes('--manual'))) throw new Error('Usage: login.js [--headed|--headless] [--check|--manual]')
  const fixed = loadFixedConfig()
  const checkOnly = args.includes('--check')
  const manual = args.includes('--manual')
  validateAccount(fixed, { requirePassword: !checkOnly && !manual })
  const headed = args.includes('--headed') || (!args.includes('--headless') && fixed.browser.headed)
  if (manual && !headed) throw new Error('Manual login requires a visible browser (--headed)')
  const sessionPath = resolve(repositoryDirectory, '.auth/session.json')
  if (checkOnly && !existsSync(sessionPath)) throw new Error('No saved session; run npm run auth:login first')
  browser = await chromium.launch({ headless: !headed, timeout: fixed.browser.timeoutMs })
  const context = await browser.newContext(checkOnly ? { storageState: sessionPath } : {})
  if (checkOnly) {
    if (!await checkSession(context, fixed.account.email)) throw new Error('Saved session has expired; run npm run auth:login again')
    console.log('Saved Anybuddy session is authenticated and matches the configured account.')
  } else {
    const page = await context.newPage()
    if (manual) console.log(`Complete the login in Chromium; waiting up to ${fixed.browser.timeoutMs / 1000} seconds.`)
    await loginWithPage(page, fixed, { manual })
    await saveSession(context, sessionPath)
    console.log('Anybuddy login verified. Private session saved in .auth/session.json.')
  }
} catch (error) {
  // Playwright errors can include fill values or authenticated request details.
  console.error(error.name === 'TimeoutError' ? 'Login timed out; inspect the visible browser or retry with --manual.' : error.message.includes('Call log:') || error.message.includes('browser.newContext') ? 'Browser operation failed; check Chromium and the local session file.' : error.message)
  process.exitCode = 1
} finally {
  await browser?.close()
}

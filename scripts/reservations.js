#!/usr/bin/env node
import { chromium } from 'playwright'
import { readFileSync, existsSync, writeFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { loadFixedConfig, repositoryDirectory, validateAccount } from '../lib/config.js'
import { checkSession } from '../lib/anybuddy-session.js'
import { discoverMatchesAction, readMatchesPage } from '../lib/anybuddy-actions.js'
import { listReservations, cancelReservation, cancellationDialog } from '../lib/account-reservations.js'
import { acquireLock } from '../lib/observation-store.js'

let browser
let release
try {
  const [command, ...args] = process.argv.slice(2)
  if (!['list', 'show', 'cancel'].includes(command)) throw new Error('Usage: reservations.js list [--scope active|all|past|cancelled|pending] | show --id ID | cancel --id ID [--confirm --expected-version HASH]')
  const options = {}
  for (let index = 0; index < args.length; index++) {
    const key = args[index]
    const allowed = command === 'list' ? ['--scope'] : command === 'show' ? ['--id'] : ['--id', '--confirm', '--expected-version']
    if (!allowed.includes(key) || Object.hasOwn(options, key)) throw new Error('Invalid or repeated reservation argument')
    if (key === '--confirm') options[key] = true
    else {
      if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error('Missing reservation argument')
      options[key] = args[++index]
    }
  }
  const scope = options['--scope'] || 'active'
  if (!['active', 'all', 'past', 'cancelled', 'pending'].includes(scope)) throw new Error('Invalid scope')
  const id = options['--id']
  if (command !== 'list' && !/^[a-zA-Z\d_-]{1,100}$/.test(id || '')) throw new Error('Use a reservation ID returned by list')
  if (options['--confirm'] && !/^[a-f\d]{64}$/.test(options['--expected-version'] || '')) throw new Error('--confirm requires --expected-version from a fresh cancellation preview')
  const fixed = loadFixedConfig()
  validateAccount(fixed, { requirePassword: false })
  const directory = join(repositoryDirectory, '.auth/reservations')
  release = acquireLock(directory)
  if (!release) throw new Error('Another reservations operation is running')
  browser = await chromium.launch({ headless: true, timeout: fixed.browser.timeoutMs })
  const context = await browser.newContext({ storageState: join(repositoryDirectory, '.auth/session.json'), locale: 'fr-FR', timezoneId: 'Europe/Paris' })
  context.setDefaultTimeout(20000)
  const assertSession = async () => {
    if (!await checkSession(context, fixed.account.email)) throw new Error('Session expired; run npm run auth:login')
  }
  await assertSession()
  const page = await context.newPage()
  const action = await discoverMatchesAction(page)
  const read = async () => {
    await assertSession()
    return listReservations(after => readMatchesPage(context, action, after))
  }
  let result
  if (command === 'list') {
    const all = await read()
    result = { status: 'ok', checkedAt: new Date().toISOString(), scope, total: all.length, counts: Object.fromEntries(['upcoming', 'pending', 'past', 'cancelled'].map(category => [category, all.filter(item => item.category === category).length])), reservations: all.filter(item => scope === 'all' || (scope === 'active' ? ['upcoming', 'pending'].includes(item.category) : item.category === scope)) }
  } else if (command === 'show') {
    const reservation = (await read()).find(item => item.id === id)
    if (!reservation) throw new Error('Reservation not found')
    result = { status: 'ok', checkedAt: new Date().toISOString(), reservation }
  } else {
    let dialog
    const journal = join(directory, `cancel-${id}.json`)
    const save = entry => {
      const temporary = `${journal}.tmp`
      writeFileSync(temporary, JSON.stringify({ ...entry, updatedAt: new Date().toISOString() }), { mode: 0o600 })
      renameSync(temporary, journal)
    }
    result = await cancelReservation({ id, read, confirm: options['--confirm'], expectedVersion: options['--expected-version'],
      openDialog: async reservation => { dialog = await cancellationDialog(page, reservation); return dialog.terms },
      beforeSubmit: async () => {
        await assertSession()
        if (existsSync(journal) && ['cancellation_started', 'cancellation_unverified'].includes(JSON.parse(readFileSync(journal, 'utf8')).status)) throw new Error('Previous cancellation outcome requires reconciliation')
        save({ status: 'cancellation_started', id })
      },
      submit: () => dialog.submit(),
    })
    // Keep uncertainty across runs; previews cannot erase an earlier submitted action.
    if (result.submitted || result.verified) save(result)
    if (['not_cancellable', 'cancellation_unverified'].includes(result.status)) process.exitCode = 2
  }
  console.log(JSON.stringify(result, null, 2))
} catch (error) {
  console.log(JSON.stringify({ status: 'error', message: error.message.includes('Call log:') || error.message.includes('browser.newContext') ? 'Reservation page or session unavailable; check auth:check. No cancellation success inferred.' : error instanceof SyntaxError ? 'Invalid private operation state' : error.message }))
  process.exitCode = 1
} finally {
  try { await browser?.close() } finally { release?.() }
}

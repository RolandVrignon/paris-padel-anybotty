#!/usr/bin/env node
import { parseArgs } from 'node:util'
import { join } from 'node:path'
import { createFourPadelSession } from '../lib/fourpadel-session.js'
import { listFourPadelReservations } from '../lib/fourpadel-account.js'
import { cancelFourPadel } from '../lib/fourpadel-cancellation.js'
import { bookFourPadelWallet, reconcileFourPadelWallet, readFourPadelWallet } from '../lib/fourpadel-wallet.js'
import { normalizeFourPadelRequest } from '../lib/fourpadel-booking.js'
import { ucpaActionStore } from '../lib/ucpa-actions.js'
import { acquireLock } from '../lib/observation-store.js'
import { repositoryDirectory, loadRequestConfig, resolveDurationsMinutes, resolveCourtEnvironment, resolveMaxPricePerHourEUR } from '../lib/config.js'
import { parseDurationsArgument } from '../lib/duration-preferences.js'
import { parseCourtEnvironmentArgument } from '../lib/court-environment.js'

let session
let release
let stage = 'configuration'
try {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    help: { type: 'boolean' }, headed: { type: 'boolean' }, confirm: { type: 'boolean' },
    club: { type: 'string' }, date: { type: 'string' }, time: { type: 'string' }, durations: { type: 'string' },
    'court-environment': { type: 'string' }, 'max-price-per-hour': { type: 'string' }, id: { type: 'string' }, 'expected-version': { type: 'string' },
  } })
  if (values.help) console.log('npm run 4padel -- book --club CLUB --date YYYY-MM-DD --time HH:mm [--durations 60,90 --court-environment indoor,outdoor --max-price-per-hour EUR] [--confirm]\nnpm run 4padel -- list|wallet\nnpm run 4padel -- show --id ID\nnpm run 4padel -- cancel --id ID [--confirm --expected-version HASH]\nnpm run 4padel -- reconcile --club CLUB --date YYYY-MM-DD --time HH:mm\nAdd --headed for a visible browser. book previews by default. --confirm pays ALL FOUR SHARES using wallet credit; no card or recharge fallback. No retry after uncertain submission. Cancellation uses the displayed deadline and returns credit, not a bank refund.')
  else {
    const [command] = positionals
    if (positionals.length !== 1 || !['book', 'list', 'show', 'wallet', 'cancel', 'reconcile'].includes(command)) throw new Error('Use 4padel book|list|show|wallet|cancel|reconcile; see --help')
    const allowed = { book: ['club', 'date', 'time', 'durations', 'court-environment', 'max-price-per-hour', 'confirm'], list: [], wallet: [], show: ['id'], cancel: ['id', 'confirm', 'expected-version'], reconcile: ['club', 'date', 'time'] }[command]
    for (const key of Object.keys(values)) if (!['headed', 'help', ...allowed].includes(key)) throw new Error('Option does not apply to this 4PADEL action')
    if (['show', 'cancel'].includes(command) && !/^\d+$/.test(values.id || '')) throw new Error('Use --id from 4padel list')
    if (command === 'cancel' && values.confirm && !/^[a-f0-9]{64}$/.test(values['expected-version'] || '')) throw new Error('Use --expected-version from the cancellation preview')
    let request
    if (['book', 'reconcile'].includes(command)) {
      if (!values.club) throw new Error('An explicit --club is required')
      const defaults = !values.date || !values.time ? loadRequestConfig() : {}
      request = normalizeFourPadelRequest({ clubId: values.club, date: values.date || defaults.date, startTime: values.time || defaults.startTime,
        durationsMinutes: resolveDurationsMinutes(values.durations === undefined ? undefined : parseDurationsArgument(values.durations)),
        courtEnvironment: resolveCourtEnvironment(values['court-environment'] === undefined ? undefined : parseCourtEnvironmentArgument(values['court-environment'])),
        maxPricePerHourEUR: resolveMaxPricePerHourEUR(values['max-price-per-hour'] === undefined ? undefined : Number(values['max-price-per-hour'])),
      })
    }
    stage = 'authentication'
    session = await createFourPadelSession({ headed: values.headed })
    const directory = join(repositoryDirectory, '.auth/fourpadel-actions', session.accountScope)
    release = acquireLock(directory)
    if (!release) throw new Error('Another 4PADEL operation is running')
    const store = ucpaActionStore(directory)
    stage = command
    let result
    if (command === 'book') result = await bookFourPadelWallet(session, store, request, { confirm: values.confirm, onStage: value => { stage = value } })
    if (command === 'reconcile') result = await reconcileFourPadelWallet(session, store, request)
    if (command === 'list') result = await listFourPadelReservations(session)
    if (command === 'show') result = { provider: '4padel', reservation: (await listFourPadelReservations(session)).reservations.find(r => r.id === values.id) || null }
    if (command === 'wallet') result = { provider: '4padel', status: 'ok', ...await readFourPadelWallet(session) }
    if (command === 'cancel') result = await cancelFourPadel(session, store, values.id, { confirm: values.confirm, expectedVersion: values['expected-version'] })
    console.log(JSON.stringify(result, null, 2))
    if (['booking_unverified', 'cancellation_unverified', 'pending_not_visible_in_portal', 'insufficient_wallet_balance'].includes(result.status)) process.exitCode = 2
  }
} catch (error) {
  console.error(JSON.stringify({ provider: '4padel', status: 'error', stage, message: error.name === 'SyntaxError' || error.message.includes('Call log:') ? '4PADEL operation failed; no private details logged' : error.message }))
  process.exitCode = 1
} finally { await session?.close(); release?.() }

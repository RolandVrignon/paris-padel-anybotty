#!/usr/bin/env node
import { parseArgs } from 'node:util'
import { join } from 'node:path'
import { createUcpaSession } from '../lib/ucpa-session.js'
import { createUcpaAccountClient } from '../lib/ucpa-account.js'
import { bookUcpa, cancelUcpa, reconcileUcpaBooking, showUcpaReservation, ucpaActionStore } from '../lib/ucpa-actions.js'
import { loadRequestConfig, repositoryDirectory, resolveDurationsMinutes, resolveCourtEnvironment, resolveMaxPricePerHourEUR } from '../lib/config.js'
import { parseDurationsArgument } from '../lib/duration-preferences.js'
import { parseCourtEnvironmentArgument } from '../lib/court-environment.js'
import { normalizeUcpaRequest } from '../lib/ucpa-booking.js'
import { acquireLock } from '../lib/observation-store.js'

let session
let release
let stage = 'configuration'
try {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    help: { type: 'boolean' }, headed: { type: 'boolean', default: false }, confirm: { type: 'boolean', default: false },
    date: { type: 'string' }, time: { type: 'string' }, durations: { type: 'string' }, 'court-environment': { type: 'string' }, 'max-price-per-hour': { type: 'string' },
    id: { type: 'string' }, scope: { type: 'string' }, 'expected-version': { type: 'string' },
  } })
  const [command] = positionals
  if (values.help) console.log('npm run ucpa -- book [--confirm] [--date YYYY-MM-DD --time HH:mm --durations 60,90 --court-environment indoor --max-price-per-hour EUR]\nnpm run ucpa -- list [--scope active|past|all]\nnpm run ucpa -- show --id ID\nnpm run ucpa -- cancel --id ID [--confirm --expected-version HASH]\nnpm run ucpa -- reconcile [--date YYYY-MM-DD --time HH:mm]\nAdd --headed for a visible browser. book without --confirm is a preview; --confirm creates a real booking using the saved UCPA card. Cancellation is whole-party, captain-only and more than 48 hours before play.')
  else {
    if (positionals.length !== 1 || !['book', 'list', 'show', 'cancel', 'reconcile'].includes(command)) throw new Error('Use ucpa book|list|show|cancel|reconcile; see --help')
    const allowed = { book: ['date', 'time', 'durations', 'court-environment', 'max-price-per-hour', 'confirm'], list: ['scope'], show: ['id'], cancel: ['id', 'confirm', 'expected-version'], reconcile: ['date', 'time'] }[command]
    for (const [key, value] of Object.entries(values)) if (value !== false && !['headed', 'help', ...allowed].includes(key)) throw new Error('Option does not apply to this UCPA action')
    if (['show', 'cancel'].includes(command) && !/^\d{1,20}$/.test(values.id || '')) throw new Error('Use --id from ucpa list')
    if (values.scope && !['active', 'past', 'all'].includes(values.scope)) throw new Error('Use --scope active|past|all')
    if (command === 'cancel' && values.confirm && !/^[a-f0-9]{64}$/.test(values['expected-version'] || '')) throw new Error('Cancellation confirmation requires --expected-version from its preview')
    let request
    if (['book', 'reconcile'].includes(command)) {
      const defaults = !values.date || !values.time ? loadRequestConfig() : {}
      if ((!values.date || !values.time) && !defaults.clubs?.includes('ucpa-paris')) throw new Error('UCPA is absent from configured clubs; provide explicit --date and --time')
      request = normalizeUcpaRequest({ date: values.date || defaults.date, startTime: values.time || defaults.startTime,
        durationsMinutes: resolveDurationsMinutes(values.durations === undefined ? undefined : parseDurationsArgument(values.durations)),
        courtEnvironment: resolveCourtEnvironment(values['court-environment'] === undefined ? undefined : parseCourtEnvironmentArgument(values['court-environment'])),
        maxPricePerHourEUR: resolveMaxPricePerHourEUR(values['max-price-per-hour'] === undefined ? undefined : Number(values['max-price-per-hour'])),
      })
    }
    stage = 'authentication'
    session = await createUcpaSession({ headed: values.headed })
    const directory = join(repositoryDirectory, '.auth/ucpa-actions', session.accountScope)
    release = acquireLock(directory)
    if (!release) throw new Error('Another UCPA account operation is running')
    const store = ucpaActionStore(directory)
    const client = await createUcpaAccountClient(session.context)
    stage = command
    let result
    if (command === 'book') result = await bookUcpa(session, client, store, request, { confirm: values.confirm, onStage: value => { stage = value } })
    if (command === 'list') result = { provider: 'ucpa', status: 'ok', scope: values.scope || 'active', reservations: await client.list({ scope: values.scope || 'active' }), checkedAt: new Date().toISOString() }
    if (command === 'show') result = await showUcpaReservation(client, store, values.id)
    if (command === 'cancel') result = await cancelUcpa(session, client, store, values.id, { confirm: values.confirm, expectedVersion: values['expected-version'] })
    if (command === 'reconcile') result = await reconcileUcpaBooking(client, store, request)
    console.log(JSON.stringify(result, null, 2))
    if (['booking_unverified', 'cancellation_unverified'].includes(result.status)) process.exitCode = 2
  }
} catch (error) {
  console.error(JSON.stringify({ provider: 'ucpa', status: 'error', stage, message: error.name === 'SyntaxError' || error.message.includes('Call log:') ? 'UCPA operation could not be verified; no private details logged' : error.message }))
  process.exitCode = 1
} finally {
  await session?.close()
  release?.()
}

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
import { DEFAULT_UCPA_CENTER, resolveUcpaCenter, UCPA_CENTERS } from '../lib/ucpa-centers.js'

let session
let release
let stage = 'configuration'
try {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    help: { type: 'boolean' }, headed: { type: 'boolean', default: false }, confirm: { type: 'boolean', default: false },
    date: { type: 'string' }, time: { type: 'string' }, durations: { type: 'string' }, 'court-environment': { type: 'string' }, 'max-price-per-hour': { type: 'string' },
    club: { type: 'string' }, id: { type: 'string' }, scope: { type: 'string' }, 'expected-version': { type: 'string' }, retry: { type: 'boolean', default: false },
  } })
  const [command] = positionals
  if (values.help) console.log(`npm run ucpa -- book [--club ${UCPA_CENTERS.map(center => center.id).join('|')}] [--confirm] [--date YYYY-MM-DD --time HH:mm --durations 60,90 --court-environment indoor --max-price-per-hour EUR]\nnpm run ucpa -- list [--club CLUB] [--scope active|past|all]\nnpm run ucpa -- show --club CLUB --id ID\nnpm run ucpa -- cancel --club CLUB --id ID [--retry] [--confirm --expected-version HASH]\nnpm run ucpa -- reconcile [--club CLUB --date YYYY-MM-DD --time HH:mm]\nAdd --headed for a visible browser. book without --confirm is a preview; --confirm creates a real booking using the saved UCPA card. Cancellation is whole-party, captain-only and more than 48 hours before play.`)
  else {
    if (positionals.length !== 1 || !['book', 'list', 'show', 'cancel', 'reconcile'].includes(command)) throw new Error('Use ucpa book|list|show|cancel|reconcile; see --help')
    const allowed = { book: ['club', 'date', 'time', 'durations', 'court-environment', 'max-price-per-hour', 'confirm'], list: ['club', 'scope'], show: ['club', 'id'], cancel: ['club', 'id', 'confirm', 'expected-version', 'retry'], reconcile: ['club', 'date', 'time'] }[command]
    for (const [key, value] of Object.entries(values)) if (value !== false && !['headed', 'help', ...allowed].includes(key)) throw new Error('Option does not apply to this UCPA action')
    if (['show', 'cancel'].includes(command) && !/^\d{1,20}$/.test(values.id || '')) throw new Error('Use --id from ucpa list')
    if (values.scope && !['active', 'past', 'all'].includes(values.scope)) throw new Error('Use --scope active|past|all')
    if (command === 'cancel' && values.confirm && !/^[a-f0-9]{64}$/.test(values['expected-version'] || '')) throw new Error('Cancellation confirmation requires --expected-version from its preview')
    const requestDefaults = ['book', 'reconcile'].includes(command) && (!values.date || !values.time) ? loadRequestConfig() : null
    const configuredCenter = requestDefaults?.clubs?.map(id => UCPA_CENTERS.find(center => center.id === id)).find(Boolean)
    const center = resolveUcpaCenter(values.club || configuredCenter?.id || DEFAULT_UCPA_CENTER.id)
    let request
    if (['book', 'reconcile'].includes(command)) {
      const defaults = requestDefaults || {}
      if ((!values.date || !values.time) && !defaults.clubs?.includes(center.id)) throw new Error(`${center.id} is absent from configured clubs; provide explicit --date and --time`)
      request = normalizeUcpaRequest({ date: values.date || defaults.date, startTime: values.time || defaults.startTime,
        durationsMinutes: resolveDurationsMinutes(values.durations === undefined ? undefined : parseDurationsArgument(values.durations)),
        courtEnvironment: resolveCourtEnvironment(values['court-environment'] === undefined ? undefined : parseCourtEnvironmentArgument(values['court-environment'])),
        maxPricePerHourEUR: resolveMaxPricePerHourEUR(values['max-price-per-hour'] === undefined ? undefined : Number(values['max-price-per-hour'])),
      })
    }
    stage = 'authentication'
    session = await createUcpaSession({ headed: values.headed })
    const accountDirectory = join(repositoryDirectory, '.auth/ucpa-actions', session.accountScope)
    const directory = center.id === DEFAULT_UCPA_CENTER.id ? accountDirectory : join(accountDirectory, center.id)
    release = acquireLock(directory)
    if (!release) throw new Error('Another UCPA account operation is running')
    const store = ucpaActionStore(directory)
    const client = await createUcpaAccountClient(session.context, { center })
    stage = command
    let result
    if (command === 'book') result = await bookUcpa(session, client, store, request, { center, confirm: values.confirm, onStage: value => { stage = value } })
    if (command === 'list') result = { provider: 'ucpa', status: 'ok', scope: values.scope || 'active', reservations: await client.list({ scope: values.scope || 'active' }), checkedAt: new Date().toISOString() }
    if (command === 'show') result = await showUcpaReservation(client, store, values.id)
    if (command === 'cancel') result = await cancelUcpa(session, client, store, values.id, { center, confirm: values.confirm, expectedVersion: values['expected-version'], retry: values.retry })
    if (command === 'reconcile') result = await reconcileUcpaBooking(client, store, request, { center })
    console.log(JSON.stringify(result, null, 2))
    if (['booking_unverified', 'cancellation_unverified'].includes(result.status)) process.exitCode = 2
  }
} catch (error) {
  console.error(JSON.stringify({ provider: 'ucpa', status: 'error', stage, ...(error.name === 'ProviderAuthError' ? { code: error.code } : {}), message: error.name === 'SyntaxError' || error.message.includes('Call log:') ? 'UCPA operation could not be verified; no private details logged' : error.message }))
  process.exitCode = 1
} finally {
  await session?.close()
  release?.()
}

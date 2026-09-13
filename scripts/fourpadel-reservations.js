#!/usr/bin/env node
import { parseArgs } from 'node:util'
import { join } from 'node:path'
import { createFourPadelSession } from '../lib/fourpadel-session.js'
import { listFourPadelReservations } from '../lib/fourpadel-account.js'
import { cancelFourPadel } from '../lib/fourpadel-cancellation.js'
import { ucpaActionStore } from '../lib/ucpa-actions.js'
import { repositoryDirectory } from '../lib/config.js'
import { acquireLock } from '../lib/observation-store.js'
let session
let release
try {
  const { values } = parseArgs({ options: { cancel: { type: 'string' }, confirm: { type: 'boolean' }, 'expected-version': { type: 'string' }, headed: { type: 'boolean' }, help: { type: 'boolean' } } })
  if (values.help) console.log('npm run reservations:4padel -- [--headed]\nnpm run reservations:4padel -- --cancel ID [--confirm --expected-version HASH]\nCancellation previews by default. A confirmed cancellation uses credit under the displayed deadline; the credit amount must be checked separately.')
  else {
    if ((values.confirm || values['expected-version']) && !values.cancel) throw new Error('--confirm/--expected-version require --cancel ID')
    if (values.cancel && !/^\d+$/.test(values.cancel)) throw new Error('Use a reservation ID from the list')
    if (values.confirm && !/^[a-f0-9]{64}$/.test(values['expected-version'] || '')) throw new Error('Use --expected-version from the cancellation preview')
    session = await createFourPadelSession({ headed: values.headed })
    const directory = join(repositoryDirectory, '.auth/fourpadel-actions', session.accountScope)
    release = acquireLock(directory)
    if (!release) throw new Error('Another 4PADEL account operation is running')
    const result = values.cancel ? await cancelFourPadel(session, ucpaActionStore(directory), values.cancel, { confirm: values.confirm, expectedVersion: values['expected-version'] }) : await listFourPadelReservations(session)
    console.log(JSON.stringify(result, null, 2))
    if (['cancellation_unverified', 'pending_not_visible_in_portal'].includes(result.status)) process.exitCode = 2
  }
} catch (error) {
  console.error(JSON.stringify({ provider: '4padel', status: 'error', message: error.message.includes('Call log:') ? '4PADEL account operation failed; no private details logged' : error.message }))
  process.exitCode = 1
} finally { await session?.close(); release?.() }

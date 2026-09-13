#!/usr/bin/env node
import { parseArgs } from 'node:util'
import { createFourPadelSession } from '../lib/fourpadel-session.js'
import { loadRequestConfig, resolveCourtEnvironment, resolveDurationsMinutes, resolveMaxPricePerHourEUR } from '../lib/config.js'
import { parseDurationsArgument } from '../lib/duration-preferences.js'
import { parseCourtEnvironmentArgument } from '../lib/court-environment.js'
import { normalizeFourPadelRequest, previewFourPadelBooking } from '../lib/fourpadel-booking.js'

let session
let stage = 'configuration'
try {
  const { values } = parseArgs({ options: {
    club: { type: 'string' }, date: { type: 'string' }, time: { type: 'string' }, durations: { type: 'string' },
    'court-environment': { type: 'string' }, 'max-price-per-hour': { type: 'string' }, headed: { type: 'boolean', default: false },
    help: { type: 'boolean', default: false }, parts: { type: 'string', default: '1' },
  } })
  if (values.help) {
    console.log('npm run checkout:4padel -- --club CLUB_ID [--date YYYY-MM-DD --time HH:mm] [--durations 60,90,120] [--court-environment indoor,outdoor|outdoor,indoor|indoor|outdoor|any] [--max-price-per-hour EUR] [--parts 1|2|3|4] [--headed]\nDefaults: config.request.json. Official 4PADEL preview only. List club IDs with npm run 4padel -- clubs. Stops before Payer maintenant. No reservation or payment is submitted. Cancellation generates credit, not a bank refund.')
  } else {
    const defaults = !values.date || !values.time ? loadRequestConfig() : {}
    if (!values.club) throw new Error('An explicit --club is required')
    const request = normalizeFourPadelRequest({
      clubId: values.club,
      date: values.date || defaults.date, startTime: values.time || defaults.startTime,
      durationsMinutes: resolveDurationsMinutes(values.durations === undefined ? undefined : parseDurationsArgument(values.durations)),
      courtEnvironment: resolveCourtEnvironment(values['court-environment'] === undefined ? undefined : parseCourtEnvironmentArgument(values['court-environment'])),
      maxPricePerHourEUR: resolveMaxPricePerHourEUR(values['max-price-per-hour'] === undefined ? undefined : Number(values['max-price-per-hour'])),
    })
    const parts = Number(values.parts)
    if (![1, 2, 3, 4].includes(parts)) throw new Error('--parts must be 1, 2, 3 or 4')
    stage = 'authentication'
    session = await createFourPadelSession({ headed: values.headed })
    const page = await session.context.newPage()
    page.setDefaultTimeout(30000)
    const result = await previewFourPadelBooking(page, request, { accountScope: session.accountScope, parts, onStage: value => { stage = value } })
    console.log(JSON.stringify(result, null, 2))
  }
} catch (error) {
  // Do not log browser call logs, API bodies, account details or saved card data.
  console.error(JSON.stringify({ provider: '4padel', status: 'error', stage, message: error.name === 'SyntaxError' ? 'Unexpected 4PADEL response format' : error.message.includes('Call log:') ? '4PADEL browser step failed; inspect with --headed' : error.message }))
  process.exitCode = 1
} finally {
  await session?.close()
}

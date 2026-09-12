#!/usr/bin/env node
import { parseArgs } from 'node:util'
import { createUcpaSession } from '../lib/ucpa-session.js'
import { loadRequestConfig, resolveCourtEnvironment, resolveDurationsMinutes, resolveMaxPricePerHourEUR } from '../lib/config.js'
import { parseDurationsArgument } from '../lib/duration-preferences.js'
import { parseCourtEnvironmentArgument } from '../lib/court-environment.js'
import { normalizeUcpaRequest, previewUcpaBooking } from '../lib/ucpa-booking.js'

let session
let stage = 'configuration'
try {
  const { values } = parseArgs({ options: {
    date: { type: 'string' }, time: { type: 'string' }, durations: { type: 'string' },
    'court-environment': { type: 'string' }, 'max-price-per-hour': { type: 'string' }, headed: { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  } })
  if (values.help) {
    console.log('npm run checkout:ucpa -- [--date YYYY-MM-DD --time HH:mm] [--durations 60,90,120] [--court-environment indoor,outdoor|outdoor,indoor|indoor|outdoor|any] [--max-price-per-hour EUR] [--headed]\nDefaults: config.request.json. UCPA Paris 19 only. Preview stops before accepting terms or reserving; no payment is submitted.')
  } else {
    const defaults = !values.date || !values.time ? loadRequestConfig() : {}
    if ((!values.date || !values.time) && !defaults.clubs?.includes('ucpa-paris')) throw new Error('UCPA is absent from request clubs; use explicit --date and --time')
    const request = normalizeUcpaRequest({
      date: values.date || defaults.date, startTime: values.time || defaults.startTime,
      durationsMinutes: resolveDurationsMinutes(values.durations === undefined ? undefined : parseDurationsArgument(values.durations)),
      courtEnvironment: resolveCourtEnvironment(values['court-environment'] === undefined ? undefined : parseCourtEnvironmentArgument(values['court-environment'])),
      maxPricePerHourEUR: resolveMaxPricePerHourEUR(values['max-price-per-hour'] === undefined ? undefined : Number(values['max-price-per-hour'])),
    })
    stage = 'authentication'
    session = await createUcpaSession({ headed: values.headed })
    const page = await session.context.newPage()
    page.setDefaultTimeout(30000)
    const result = await previewUcpaBooking(page, request, { onStage: value => { stage = value } })
    console.log(JSON.stringify(result, null, 2))
  }
} catch (error) {
  // Do not log browser call logs, API bodies, account details or saved card data.
  console.error(JSON.stringify({ provider: 'ucpa', status: 'error', stage, message: error.name === 'SyntaxError' ? 'Unexpected UCPA response format' : error.message.includes('Call log:') ? 'UCPA browser step failed; inspect with --headed' : error.message }))
  process.exitCode = 1
} finally {
  await session?.close()
}

#!/usr/bin/env node
import { parseArgs } from 'node:util'
import { createUcpaSession } from '../lib/ucpa-session.js'
import { loadRequestConfig, resolveCourtEnvironment, resolveDurationsMinutes, resolveMaxPricePerHourEUR } from '../lib/config.js'
import { parseDurationsArgument } from '../lib/duration-preferences.js'
import { parseCourtEnvironmentArgument } from '../lib/court-environment.js'
import { normalizeUcpaRequest, previewUcpaBooking } from '../lib/ucpa-booking.js'
import { DEFAULT_UCPA_CENTER, resolveUcpaCenter, UCPA_CENTERS } from '../lib/ucpa-centers.js'

let session
let stage = 'configuration'
try {
  const { values } = parseArgs({ options: {
    date: { type: 'string' }, time: { type: 'string' }, durations: { type: 'string' },
    'court-environment': { type: 'string' }, 'max-price-per-hour': { type: 'string' }, headed: { type: 'boolean', default: false },
    club: { type: 'string' },
    help: { type: 'boolean', default: false },
  } })
  if (values.help) {
    console.log(`npm run checkout:ucpa -- [--club ${UCPA_CENTERS.map(center => center.id).join('|')}] [--date YYYY-MM-DD --time HH:mm] [--durations 60,90,120] [--court-environment indoor,outdoor|outdoor,indoor|indoor|outdoor|any] [--max-price-per-hour EUR] [--headed]\nDefaults: config.request.json. Preview stops before accepting terms or reserving; no payment is submitted.`)
  } else {
    const defaults = !values.date || !values.time ? loadRequestConfig() : {}
    const configuredCenter = defaults.clubs?.map(id => UCPA_CENTERS.find(center => center.id === id)).find(Boolean)
    const center = resolveUcpaCenter(values.club || configuredCenter?.id || DEFAULT_UCPA_CENTER.id)
    if ((!values.date || !values.time) && !defaults.clubs?.includes(center.id)) throw new Error(`${center.id} is absent from request clubs; use explicit --date and --time`)
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
    const result = await previewUcpaBooking(page, request, { center, onStage: value => { stage = value } })
    console.log(JSON.stringify(result, null, 2))
  }
} catch (error) {
  // Do not log browser call logs, API bodies, account details or saved card data.
  console.error(JSON.stringify({ provider: 'ucpa', status: 'error', stage, message: error.name === 'SyntaxError' ? 'Unexpected UCPA response format' : error.message.includes('Call log:') ? 'UCPA browser step failed; inspect with --headed' : error.message }))
  process.exitCode = 1
} finally {
  await session?.close()
}

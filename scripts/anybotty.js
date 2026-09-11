#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildPlan } from '../lib/plan.js'
import { loadRequestConfig } from '../lib/config.js'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const [command = 'status', ...args] = process.argv.slice(2)
const readJson = path => JSON.parse(readFileSync(path, 'utf8'))
try {
  const catalog = readJson(resolve(root, 'data/clubs.json'))
  let result
  if (command === 'status' && !args.length) result = {
    project: 'Paris Padel - anybotty', phase: 'booking_payment', automaticBooking: true,
    openingMonitoring: 'available_via_observe_script', bookingSearch: 'preview_default_or_explicit_pay', clubs: catalog.length,
    nextStep: 'Run observe:report for recorded evidence; scheduling status must be checked on the host.',
  }
  else if (command === 'clubs' && !args.length) result = catalog
  else if (command === 'plan') {
    if (args.length && (args.length !== 2 || args[0] !== '--config' || !args[1])) throw new Error('Usage: plan [--config PATH]')
    result = buildPlan(loadRequestConfig({ path: args[1] }), catalog)
  } else throw new Error('Usage: anybotty.js status|clubs|plan [--config PATH]')
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
} catch (error) {
  process.stderr.write(`${error.message}\n`)
  process.exitCode = 1
}

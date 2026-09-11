#!/usr/bin/env node
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { repositoryDirectory, readConfig } from '../lib/config.js'
import { findClubs, readRequest, saveRequest, summarizeAvailability } from '../lib/hermes-padel.js'
import { fetchAvailability } from '../lib/availability.js'
import { parseDurationsArgument } from '../lib/duration-preferences.js'

const options = (args, allowed) => {
  const values = {}
  for (let i = 0; i < args.length; i += 2) {
    if (!allowed.includes(args[i]) || Object.hasOwn(values, args[i]) || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('Unknown, repeated or missing argument')
    values[args[i]] = args[i + 1]
  }
  return values
}
try {
  const [command, ...args] = process.argv.slice(2)
  const clubs = JSON.parse(readFileSync(new URL('../data/clubs.json', import.meta.url), 'utf8'))
  let result
  if (command === 'clubs') {
    const [action, ...rest] = args
    if (action === 'list' && !rest.length) result = { clubs }
    else if (action === 'find') result = findClubs(clubs, options(rest, ['--query'])['--query'])
    else throw new Error('Usage: clubs list | clubs find --query NAME')
  } else if (command === 'availability') {
    const values = options(args, ['--club', '--date', '--time', '--durations'])
    const club = clubs.find(club => club.id === values['--club'])
    const date = values['--date']
    const parsed = new Date(`${date}T12:00:00Z`)
    if (!club || !/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) throw new Error('Use a catalogue --club ID and --date YYYY-MM-DD')
    const time = values['--time']
    if (time !== undefined && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('--time must use HH:mm')
    const durations = values['--durations'] === undefined ? undefined : parseDurationsArgument(values['--durations'])
    result = summarizeAvailability(club, await fetchAvailability(club, { from: date, to: date }), { time, durations })
  } else if (command === 'request') {
    const [action, ...rest] = args
    const path = resolve(process.env.ANYBOTTY_REQUEST_CONFIG_PATH || resolve(repositoryDirectory, 'config.request.json'))
    if (action === 'show' && !rest.length) result = readRequest(path, clubs)
    else if (action === 'set') {
      const values = options(rest, ['--input', '--expected-version'])
      if (!values['--input']) throw new Error('Provide a complete variable request with --input PATH')
      result = saveRequest(path, readConfig(resolve(values['--input'])), values['--expected-version'], clubs)
    } else throw new Error('Usage: request show | request set --input PATH --expected-version VERSION')
  } else if (command === 'result' && !args.length) {
    const path = resolve(repositoryDirectory, '.auth/booking-search/latest.json')
    result = existsSync(path) ? readConfig(path) : { status: 'not_run', reservationConfirmed: false, paymentSubmitted: false }
  } else throw new Error('Usage: padel.js clubs|availability|request|result')
  console.log(JSON.stringify(result, null, 2))
} catch (error) {
  console.log(JSON.stringify({ status: 'error', message: error.message, ...(error.httpStatus ? { httpStatus: error.httpStatus, retryAfterMs: error.retryAfterMs ?? 0 } : {}) }))
  process.exitCode = 1
}

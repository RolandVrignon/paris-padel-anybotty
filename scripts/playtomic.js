#!/usr/bin/env node
import { parseArgs } from 'node:util'
import { playtomicCatalog, playtomicClub } from '../lib/playtomic-clubs.js'
import { fetchPlaytomicDay } from '../lib/playtomic-availability.js'
import { previewPlaytomicBooking } from '../lib/playtomic-booking.js'
import { parseDurationsArgument } from '../lib/duration-preferences.js'

try {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    help: { type: 'boolean' }, club: { type: 'string' }, date: { type: 'string' }, time: { type: 'string' }, durations: { type: 'string' }, 'max-price-per-hour': { type: 'string' }, confirm: { type: 'boolean' }, headed: { type: 'boolean' },
  } })
  const [command] = positionals
  if (values.help) console.log('npm run playtomic -- clubs\nnpm run playtomic -- availability --club CLUB --date YYYY-MM-DD\nnpm run playtomic -- book --club CLUB --date YYYY-MM-DD --time HH:mm [--durations 60,90 --max-price-per-hour EUR]\nBooking is a safe preview: it returns the exact Playtomic checkout URL and never submits payment.')
  else if (positionals.length !== 1 || !['clubs', 'availability', 'book'].includes(command)) throw new Error('Use playtomic clubs|availability|book; see --help')
  else if (values.confirm) throw new Error('Playtomic payment confirmation is not implemented; preview the checkout without --confirm')
  else if (command === 'clubs') console.log(JSON.stringify({ provider: 'playtomic', status: 'ok', clubs: playtomicCatalog }, null, 2))
  else {
    const club = playtomicClub(values.club)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(values.date || '')) throw new Error('Use --date YYYY-MM-DD')
    if (command === 'availability') console.log(JSON.stringify({ provider: 'playtomic', status: 'ok', club: { id: club.id, name: club.name }, date: values.date, slots: await fetchPlaytomicDay(club, values.date) }, null, 2))
    else {
      if (!values.time) throw new Error('Use --time HH:mm')
      const durationsMinutes = values.durations ? parseDurationsArgument(values.durations) : [90]
      const maxPricePerHourEUR = values['max-price-per-hour'] === undefined ? null : Number(values['max-price-per-hour'])
      console.log(JSON.stringify(await previewPlaytomicBooking({ clubId: club.id, date: values.date, startTime: values.time, durationsMinutes, maxPricePerHourEUR }), null, 2))
    }
  }
} catch (error) {
  console.error(JSON.stringify({ provider: 'playtomic', status: 'error', message: error.message }))
  process.exitCode = 1
}

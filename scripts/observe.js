#!/usr/bin/env node
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fetchAvailability, failureRecord } from '../lib/availability.js'
import { acquireLock, latestRecord, saveRecord, pruneRecords } from '../lib/observation-store.js'

import { calendarWindow, calendarSummary } from '../lib/calendar-monitor.js'

import { monitoringTargets, providerPauses, successfulObservation, horizonSummary } from '../lib/monitoring-targets.js'
import { fetchUcpaAvailability } from '../lib/ucpa-monitoring.js'
import { createFourPadelSession, fetchFourPadelAvailability } from '../lib/fourpadel-monitoring.js'
import { openingReference } from '../lib/opening-reference.js'

const root = fileURLToPath(new URL('..', import.meta.url))
const args = process.argv.slice(2)
if (args.length > 1 || (args.length && args[0] !== '--report')) throw new Error('Usage: node scripts/observe.js [--report]')
const directory = resolve(process.env.ANYBOTTY_OBSERVATIONS_DIR || resolve(root, 'observations'))
const clubs = monitoringTargets(root)
const summary = record => ({ clubId: record.clubId, provider: record.provider, canonicalClubId: record.canonicalClubId, horizon: horizonSummary(record.snapshot), name: record.name, status: record.status, attemptedAt: record.attemptedAt, attemptedAtParis: record.attemptedAtParis, lastSuccessAt: record.snapshot?.finishedAt ?? null, lastAvailableDate: record.snapshot?.slots.at(-1)?.startDateTime.slice(0, 10) ?? null, slotCount: record.snapshot?.slots.length ?? null, window: record.snapshot?.window ?? null, reachesWindowEnd: Boolean(record.snapshot?.slots.some(slot => slot.startDateTime.startsWith(record.snapshot.window.to))), nextRetryAt: record.nextRetryAt, error: record.error, recentOpenings: record.recentOpenings || [], openingWatch: record.openingWatch ?? null, calendar: calendarSummary(record.calendar), completedWatches: record.completedWatches || [], measuredOpeningDays: (record.completedWatches || []).filter(watch => watch.openingInterval && watch.confirmations.length === 5).length })
if (args[0] === '--report') {
  console.log(JSON.stringify(clubs.map(club => ({ ...summary({ ...club, clubId: club.id, status: 'not_observed', ...latestRecord(directory, club.id) }), bookingOpeningReference: openingReference(club, id => latestRecord(directory, id)) })), null, 2))
} else {
  const release = acquireLock(directory)
  if (!release) {
    console.log('Another collector is running; skipped')
  } else {
    const controller = new AbortController()
    const stop = () => controller.abort()
    process.once('SIGTERM', stop)
    process.once('SIGINT', stop)
    let fourPadelSession
    try {
      const pauses = providerPauses(clubs, id => latestRecord(directory, id))
      for (const [provider, nextRetryAt] of pauses) console.log(JSON.stringify({ provider, status: 'provider_backoff', nextRetryAt }))
      const outcomes = await Promise.allSettled(clubs.filter(club => !pauses.has(club.provider)).map(async club => {
        if (controller.signal.aborted) return
        const previous = latestRecord(directory, club.id) || {}
        if (previous.nextRetryAt && Date.parse(previous.nextRetryAt) > Date.now()) {
          console.log(JSON.stringify({ clubId: club.id, status: 'backoff', nextRetryAt: previous.nextRetryAt }))
          return
        }
        let record
        try {
          const options = { signal: controller.signal }
          let snapshot
          if (club.provider === 'anybuddy') snapshot = await fetchAvailability(club, calendarWindow(club), options)
          else if (club.provider === 'ucpa') snapshot = await fetchUcpaAvailability(club, calendarWindow(club), options)
          else if (club.provider === '4padel') {
            fourPadelSession ??= createFourPadelSession(options)
            snapshot = await fetchFourPadelAvailability(club, calendarWindow(club), { ...options, session: await fourPadelSession })
          } else throw new Error('Unsupported monitoring provider')
          record = successfulObservation(club, previous, snapshot)
        } catch (error) {
          if (controller.signal.aborted) return
          record = failureRecord(club, previous, error)
          process.exitCode = 1
        }
        record.provider = club.provider
        record.canonicalClubId = club.canonicalClubId
        saveRecord(directory, record)
        pruneRecords(directory, club.id)
        console.log(JSON.stringify({ ...summary(record), recentOpenings: undefined, events: record.events }))
      }))
      for (const outcome of outcomes) if (outcome.status === 'rejected') {
        console.error(outcome.reason)
        process.exitCode = 1
      }
      // Resolve references only after all concurrent observations have been saved.
      for (const club of clubs.filter(club => club.monitoring?.openingReference)) {
        console.log(JSON.stringify({ clubId: club.id, bookingOpeningReference: openingReference(club, id => latestRecord(directory, id)) }))
      }
    } finally {
      if (fourPadelSession) await fourPadelSession.then(session => session.close()).catch(() => {})
      release()
      process.removeListener('SIGTERM', stop)
      process.removeListener('SIGINT', stop)
    }
  }
}

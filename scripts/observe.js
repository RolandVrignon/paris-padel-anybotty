#!/usr/bin/env node
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fetchAvailability, failureRecord } from '../lib/availability.js'
import { acquireLock, latestRecord, saveRecord, pruneRecords } from '../lib/observation-store.js'

import { calendarWindow, calendarSummary } from '../lib/calendar-monitor.js'

import { monitoringTargets, providerPauses, successfulObservation, horizonSummary } from '../lib/monitoring-targets.js'
import { fetchUcpaAvailability } from '../lib/ucpa-monitoring.js'
import { createFourPadelSession, fetchFourPadelAvailability } from '../lib/fourpadel-monitoring.js'
import { notifyMonitoringAlert } from '../lib/monitoring-alert.js'
import { monitoringPlan } from '../lib/monitoring-plan.js'
import { openingReference } from '../lib/opening-reference.js'
import { fetchPlaytomicAvailability } from '../lib/playtomic-availability.js'

const root = fileURLToPath(new URL('..', import.meta.url))
const args = process.argv.slice(2)
if (args.length > 1 || (args.length && !['--report', '--plan'].includes(args[0]))) throw new Error('Usage: node scripts/observe.js [--report|--plan]')
const directory = resolve(process.env.ANYBOTTY_OBSERVATIONS_DIR || resolve(root, 'observations'))
const clubs = monitoringTargets(root)
const summary = record => ({ clubId: record.clubId, provider: record.provider, canonicalClubId: record.canonicalClubId, horizon: horizonSummary(record.snapshot), name: record.name, scanMode: record.snapshot?.scanMode ?? null, lastFullScan: record.lastFullScan ?? null, monitoringAlert: record.monitoringAlert ?? null, status: record.status, attemptedAt: record.attemptedAt, attemptedAtParis: record.attemptedAtParis, lastSuccessAt: record.snapshot?.finishedAt ?? null, lastAvailableDate: record.snapshot?.slots.at(-1)?.startDateTime.slice(0, 10) ?? null, slotCount: record.snapshot?.slots.length ?? null, window: record.snapshot?.window ?? null, reachesWindowEnd: Boolean(record.snapshot?.slots.some(slot => slot.startDateTime.startsWith(record.snapshot.window.to))), nextRetryAt: record.nextRetryAt, error: record.error, recentOpenings: record.recentOpenings || [], openingWatch: record.openingWatch ?? null, calendar: calendarSummary(record.calendar), completedWatches: record.completedWatches || [], measuredOpeningDays: (record.completedWatches || []).filter(watch => watch.openingInterval && watch.confirmations.length === 5).length })
if (args[0] === '--plan') {
  console.log(JSON.stringify(clubs.map(club => ({ clubId: club.id, ...monitoringPlan(club, latestRecord(directory, club.id)) })), null, 2))
} else if (args[0] === '--report') {
  console.log(JSON.stringify(clubs.map(club => ({ ...summary({ ...club, clubId: club.id, status: 'not_observed', ...latestRecord(directory, club.id) }), nextScan: monitoringPlan(club, latestRecord(directory, club.id)), bookingOpeningReference: openingReference(club, id => latestRecord(directory, id)) })), null, 2))
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
      for (const club of clubs) {
        if (controller.signal.aborted) break
        if (pauses.has(club.provider)) continue
        const previous = latestRecord(directory, club.id) || {}
        if (previous.nextRetryAt && Date.parse(previous.nextRetryAt) > Date.now()) {
          console.log(JSON.stringify({ clubId: club.id, status: 'backoff', nextRetryAt: previous.nextRetryAt }))
          continue
        }
        const plan = monitoringPlan(club, previous)
        if (plan.mode === 'skip') {
          console.log(JSON.stringify({ clubId: club.id, status: 'skipped', ...plan }))
          continue
        }
        let record
        try {
          const options = { signal: controller.signal, targeted: plan.mode === 'targeted' }
          let snapshot
          if (club.provider === 'anybuddy') snapshot = await fetchAvailability(club, plan.window, options)
          else if (club.provider === 'playtomic') snapshot = await fetchPlaytomicAvailability(club, plan.window, options)
          else if (club.provider === 'ucpa') snapshot = await fetchUcpaAvailability(club, plan.window, { ...options, previousBoundary: previous.lastFullScan?.frontier })
          else if (club.provider === '4padel') {
            fourPadelSession ??= createFourPadelSession({ ...options, checkOnly: true })
            snapshot = await fetchFourPadelAvailability(club, plan.window, { ...options, calendarFrom: calendarWindow(club).from, session: await fourPadelSession })
          } else throw new Error('Unsupported monitoring provider')
          record = successfulObservation(club, previous, { ...snapshot, scanMode: plan.mode })
        } catch (error) {
          if (controller.signal.aborted) break
          record = failureRecord(club, previous, error)
          record.provider = club.provider
          if (record.monitoringAlert) {
            pauses.set(club.provider, record.nextRetryAt)
            record.monitoringAlert.delivery = await notifyMonitoringAlert(record)
            console.error(JSON.stringify({ alert: record.monitoringAlert, nextRetryAt: record.nextRetryAt }))
          }
          process.exitCode = 1
        }
        record.provider = club.provider
        record.canonicalClubId = club.canonicalClubId
        saveRecord(directory, record)
        pruneRecords(directory, club.id)
        console.log(JSON.stringify({ clubId: club.id, provider: club.provider, status: record.status, scanMode: plan.mode, window: record.snapshot?.window, slotCount: record.snapshot?.slots.length, nextRetryAt: record.nextRetryAt, error: record.error }))
      }
      // Resolve references only after the observations have been saved.
      for (const club of clubs.filter(club => club.monitoring?.openingReference)) {
        console.log(JSON.stringify({ clubId: club.id, nextScan: monitoringPlan(club, latestRecord(directory, club.id)), bookingOpeningReference: openingReference(club, id => latestRecord(directory, id)) }))
      }
    } finally {
      if (fourPadelSession) await fourPadelSession.then(session => session.close()).catch(() => {})
      release()
      process.removeListener('SIGTERM', stop)
      process.removeListener('SIGINT', stop)
    }
  }
}

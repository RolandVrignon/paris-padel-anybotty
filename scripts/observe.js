#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fetchAvailability, nextRecord, failureRecord } from '../lib/availability.js'
import { acquireLock, latestRecord, saveRecord, pruneRecords } from '../lib/observation-store.js'

import { prepareCampaign, rememberCompletedWatch, advanceWatch, watchIsDue } from '../lib/opening-watch.js'

const root = fileURLToPath(new URL('..', import.meta.url))
const args = process.argv.slice(2)
if (args.length > 1 || (args.length && args[0] !== '--report')) throw new Error('Usage: node scripts/observe.js [--report]')
const directory = resolve(process.env.ANYBOTTY_OBSERVATIONS_DIR || resolve(root, 'observations'))
const clubs = JSON.parse(readFileSync(resolve(root, 'data/clubs.json'), 'utf8')).filter(club => club.monitoring?.enabled !== false)
const summary = record => ({ clubId: record.clubId, name: record.name, status: record.status, attemptedAt: record.attemptedAt, attemptedAtParis: record.attemptedAtParis, lastSuccessAt: record.snapshot?.finishedAt ?? null, lastAvailableDate: record.snapshot?.slots.at(-1)?.startDateTime.slice(0, 10) ?? null, slotCount: record.snapshot?.slots.length ?? null, window: record.snapshot?.window ?? null, reachesWindowEnd: Boolean(record.snapshot?.slots.some(slot => slot.startDateTime.startsWith(record.snapshot.window.to))), nextRetryAt: record.nextRetryAt, error: record.error, recentOpenings: record.recentOpenings || [], openingWatch: record.openingWatch ?? null, completedWatches: record.completedWatches || [], measuredOpeningDays: (record.completedWatches || []).filter(watch => watch.openingInterval && watch.confirmations.length === 5).length })
if (args[0] === '--report') {
  console.log(JSON.stringify(clubs.map(club => summary(latestRecord(directory, club.id) || { ...club, clubId: club.id, status: 'not_observed' })), null, 2))
} else {
  const release = acquireLock(directory)
  if (!release) {
    console.log('Another collector is running; skipped')
  } else {
    const controller = new AbortController()
    const stop = () => controller.abort()
    process.once('SIGTERM', stop)
    process.once('SIGINT', stop)
    try {
      const globalPause = clubs.map(club => latestRecord(directory, club.id)).find(record => [401, 403, 429].includes(record?.httpStatus) && Date.parse(record.nextRetryAt) > Date.now())
      if (globalPause) console.log(JSON.stringify({ status: 'global_backoff', nextRetryAt: globalPause.nextRetryAt }))
      const outcomes = await Promise.allSettled((globalPause ? [] : clubs).map(async club => {
        if (controller.signal.aborted) return
        let previous = latestRecord(directory, club.id)
        const campaign = prepareCampaign(club, previous)
        const watch = campaign.openingWatch
        if (!watchIsDue(watch)) {
          console.log(JSON.stringify({ clubId: club.id, status: watch.phase === 'complete' ? 'completed' : 'not_due', targetDate: watch.targetDate, confirmations: watch.confirmations.length, nextCheckAt: watch.nextCheckAt }))
          return
        }
        previous = { ...previous, ...campaign }
        if (previous.nextRetryAt && Date.parse(previous.nextRetryAt) > Date.now()) {
          console.log(JSON.stringify({ clubId: club.id, status: 'backoff', nextRetryAt: previous.nextRetryAt }))
          return
        }
        let record
        try {
          const snapshot = await fetchAvailability(club, { from: watch.targetDate, to: watch.targetDate }, { signal: controller.signal })
          const updated = advanceWatch(watch, snapshot)
          record = { ...nextRecord(club, previous, snapshot), openingWatch: updated, completedWatches: rememberCompletedWatch(previous.completedWatches, updated) }
        } catch (error) {
          if (controller.signal.aborted) return
          record = failureRecord(club, previous, error)
          process.exitCode = 1
        }
        saveRecord(directory, record)
        pruneRecords(directory, club.id)
        console.log(JSON.stringify({ ...summary(record), recentOpenings: undefined, events: record.events }))
      }))
      for (const outcome of outcomes) if (outcome.status === 'rejected') {
        console.error(outcome.reason)
        process.exitCode = 1
      }
    } finally {
      release()
      process.removeListener('SIGTERM', stop)
      process.removeListener('SIGINT', stop)
    }
  }
}

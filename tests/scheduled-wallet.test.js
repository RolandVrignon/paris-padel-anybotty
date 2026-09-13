import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createJobStore } from '../lib/scheduled-booking.js'
import { calculateSchedule } from '../lib/booking-schedule.js'
import { walletRequirement, evaluateWallet, scheduledBookingArgs } from '../lib/scheduled-wallet.js'

const now = new Date('2026-09-13T12:00:00Z')
const request = { date: '30/09/2026', startTime: '20:00', clubs: ['4padel-saint-ouen'], durationsMinutes: [60, 90], courtEnvironment: ['indoor', 'outdoor'], maxPricePerHourEUR: 80 }
const input = { provider: '4padel', mode: 'pay', request, opening: { mode: 'daily', horizonDays: 14, localTime: '08:00', source: 'user_instruction', evidence: 'Hypothetical user-specified opening for this test' } }
const wallet = (balanceEUR, checkedAt = now.toISOString()) => ({ balanceEUR, checkedAt })
const makeStore = t => {
  const root = mkdtempSync(join(tmpdir(), 'anybotty-wallet-jobs-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return { root, store: createJobStore({ directory: join(root, 'jobs'), scriptsDirectory: join(root, 'scripts'), projectDirectory: '/project with spaces', node: '/node' }) }
}

test('wallet funding applies only to paid official 4PADEL and covers the longest duration', () => {
  assert.equal(walletRequirement('anybuddy', 'pay', request), null)
  assert.equal(walletRequirement('ucpa', 'pay', request), null)
  assert.equal(walletRequirement('4padel', 'preview', request), null)
  assert.equal(walletRequirement('4padel', 'pay', request).requiredEUR, 120)
  assert.equal(walletRequirement('4padel', 'pay', { ...request, durationsMinutes: [120, 60, 90] }).requiredEUR, 160)
  assert.equal(walletRequirement('4padel', 'pay', { ...request, maxPricePerHourEUR: 10.01 }).requiredEUR, 15.02)
  assert.throws(() => calculateSchedule({ ...input, request: { ...request, maxPricePerHourEUR: null } }, [], { now }), /maxPricePerHourEUR/)
  assert.throws(() => calculateSchedule({ ...input, provider: 'ucpa' }, [], { now }), /provider/)
})

test('unknown, stale and insufficient balances never create a paid cron', t => {
  const { store } = makeStore(t)
  for (const balance of [undefined, wallet(-1), wallet(NaN), wallet(500, '2026-09-12T12:00:00Z'), wallet(500, '2026-09-14T12:00:00Z')]) {
    assert.equal(store.prepare(input, [], { now, walletCheck: balance }).status, 'wallet_check_failed')
  }
  const rejected = store.prepare(input, [], { now, walletCheck: wallet(119) })
  assert.equal(rejected.status, 'insufficient_wallet_balance')
  assert.equal(rejected.walletCheck.missingEUR, 1)
  assert.deepEqual(store.list(), [])
  assert.equal(evaluateWallet({ requiredEUR: 120 }, wallet(120), now).status, 'wallet_ready')
})

test('17-day match schedules its funding check 24 hours before the booking cron, not the match', t => {
  const { root, store } = makeStore(t)
  const job = store.prepare(input, [], { now, walletCheck: wallet(160) })
  assert.equal(job.openingAt, '2026-09-16T06:00:00.000Z')
  assert.equal(job.walletRecheck.schedule, '2026-09-15T06:00:00.000Z')
  assert.equal(job.walletCheck.fundsReserved, false)
  assert.match(readFileSync(join(root, 'scripts', job.walletRecheck.script), 'utf8'), /check-wallet --id/)
  assert.throws(() => store.attach(job.id, 'booking-cron'), /24-hour/)
  store.attachWallet(job.id, 'wallet-cron')
  assert.throws(() => store.attachWallet(job.id, 'another-cron'), /already attached/)
  assert.throws(() => store.attach(job.id, 'wallet-cron'), /different cron/)
  assert.equal(store.attach(job.id, 'booking-cron').status, 'scheduled')
})

test('a lower balance at the reminder alerts without cancelling the booking and cannot replay', async t => {
  const { store } = makeStore(t)
  const job = store.prepare(input, [], { now, walletCheck: wallet(160) })
  store.attachWallet(job.id, 'wallet-cron')
  store.attach(job.id, 'booking-cron')
  await assert.rejects(store.checkWallet(job.id, () => assert.fail('Early network request'), { now }), /not due/)
  const due = new Date(job.walletRecheck.schedule)
  const result = await store.checkWallet(job.id, async () => wallet(38, due.toISOString()), { now: due })
  assert.equal(result.status, 'insufficient_wallet_balance')
  assert.equal(result.walletCheck.missingEUR, 82)
  assert.equal(store.read(job.id).status, 'scheduled')
  assert.equal((await store.checkWallet(job.id, () => assert.fail('Repeated wallet check'), { now: due })).status, 'skipped')
  // The actual booking uses the current wallet and real price, not this older provision.
  const booked = await store.run(job.id, async (actual, mode, provider) => {
    assert.equal(provider, '4padel'); assert.equal(mode, 'pay'); assert.deepEqual(actual, request)
    return { status: 'booked', reservationConfirmed: true }
  }, { now: new Date(job.openingAt) })
  assert.equal(booked.status, 'booked')
  assert.equal((await store.run(job.id, () => assert.fail('Duplicate booking'))).status, 'skipped')
})

test('cancel disables both jobs; a failed balance read stays unknown', async t => {
  const { store } = makeStore(t)
  const job = store.prepare(input, [], { now, walletCheck: wallet(160) })
  store.attachWallet(job.id, 'wallet-cron'); store.attach(job.id, 'booking-cron')
  const result = await store.checkWallet(job.id, async () => { throw new Error('Network offline') }, { now: new Date(job.walletRecheck.schedule) })
  assert.equal(result.walletCheck.balanceEUR, null)
  assert.equal(result.status, 'wallet_check_failed')
  assert.equal(store.read(job.id).status, 'scheduled')
  const cancelled = store.cancel(job.id)
  assert.equal(cancelled.walletRecheck.cronJobId, 'wallet-cron')
  assert.equal((await store.run(job.id, () => assert.fail('Cancelled booking'))).status, 'skipped')
  assert.equal((await store.checkWallet(job.id, () => assert.fail('Cancelled reminder'))).status, 'skipped')
})

test('a cancellation during wallet IO remains cancelled and suppresses its reminder', async t => {
  const { store } = makeStore(t)
  const job = store.prepare(input, [], { now, walletCheck: wallet(160) })
  store.attachWallet(job.id, 'wallet-cron'); store.attach(job.id, 'booking-cron')
  let finish
  const checking = store.checkWallet(job.id, () => new Promise(resolve => { finish = resolve }), { now: new Date(job.walletRecheck.schedule) })
  store.cancel(job.id)
  finish(wallet(100, job.walletRecheck.schedule))
  assert.equal((await checking).status, 'skipped')
  assert.equal(store.read(job.id).status, 'cancelled')
})

test('less than 24 hours notice uses the initial check and no past reminder', t => {
  const { store } = makeStore(t)
  const shortNotice = new Date('2026-09-15T18:00:00Z')
  const job = store.prepare(input, [], { now: shortNotice, walletCheck: wallet(160, shortNotice.toISOString()) })
  assert.equal(job.walletRecheck.status, 'covered_by_initial_check')
  assert.equal(job.walletRecheck.cronJobId, null)
  assert.equal(store.attach(job.id, 'booking-cron').status, 'scheduled')
})

test('DST recheck is exactly 24 elapsed hours before execution', () => {
  const plan = calculateSchedule({ ...input, request: { ...request, date: '08/11/2026' } }, [], { now })
  assert.equal(plan.openingAt, '2026-10-25T07:00:00.000Z')
  assert.equal(new Date(Date.parse(plan.openingAt) - 86400000).toISOString(), '2026-10-24T07:00:00.000Z')
})

test('preview never requires wallet provisioning; execution arguments freeze provider and preferences', t => {
  const { store } = makeStore(t)
  const job = store.prepare({ ...input, mode: 'preview' }, [], { now })
  assert.equal(job.walletRecheck, null)
  assert.equal(store.attach(job.id, 'preview-cron').status, 'scheduled')
  const args = scheduledBookingArgs(request, 'pay', '4padel', '/tmp/request')
  assert.equal(args[0], 'scripts/fourpadel.js')
  assert.ok(args.includes('--confirm')); assert.ok(!args.includes('--pay'))
  assert.equal(args[args.indexOf('--durations') + 1], '60,90')
  assert.equal(args[args.indexOf('--max-price-per-hour') + 1], '80')
  assert.ok(!scheduledBookingArgs(request, 'preview', '4padel', '/tmp/request').includes('--confirm'))
  assert.equal(scheduledBookingArgs(request, 'pay', 'anybuddy', '/tmp/request')[0], 'scripts/booking-search.js')
  assert.throws(() => scheduledBookingArgs(request, 'pay', 'ucpa', '/tmp/request'), /Unsupported/)
})

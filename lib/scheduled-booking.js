import { mkdirSync, writeFileSync, readFileSync, renameSync, readdirSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { calculateSchedule } from './booking-schedule.js'
import { evaluateWallet } from './scheduled-wallet.js'

const quote = value => `'${value.replaceAll('\'', '\'\\\'\'')}'`
const active = new Set(['prepared', 'scheduled', 'running'])
export const createJobStore = ({ directory, scriptsDirectory, projectDirectory, node = process.execPath }) => {
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  mkdirSync(scriptsDirectory, { recursive: true, mode: 0o700 })
  const path = id => {
    if (!/^[0-9a-f-]{36}$/.test(id || '')) throw new Error('Invalid request ID')
    return join(directory, `${id}.json`)
  }
  const read = id => JSON.parse(readFileSync(path(id), 'utf8'))
  const save = record => {
    const temp = `${path(record.id)}.${randomUUID()}.tmp`
    writeFileSync(temp, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 })
    renameSync(temp, path(record.id))
    return record
  }
  const locked = fn => {
    const lock = join(directory, '.lock')
    try { writeFileSync(lock, String(process.pid), { flag: 'wx', mode: 0o600 }) } catch { throw new Error('Schedule store is locked; reconcile any interrupted writer before retrying') }
    try { return fn() } finally { unlinkSync(lock) }
  }
  const list = () => readdirSync(directory).filter(name => /^[0-9a-f-]{36}\.json$/.test(name)).map(name => read(name.slice(0, -5)))
  return {
    read, list,
    prepare(input, catalog, { now = new Date(), walletCheck } = {}) {
      const plan = calculateSchedule(input, catalog, { now })
      if (plan.status !== 'ready') return plan
      const funding = plan.walletRequirement ? evaluateWallet(plan.walletRequirement, walletCheck, now) : null
      if (funding && funding.status !== 'wallet_ready') return { status: funding.status, provider: plan.provider, walletCheck: funding, scheduled: false }
      const recheckAt = new Date(Date.parse(plan.openingAt) - 24 * 60 * 60 * 1000).toISOString()
      return locked(() => {
        if (list().some(job => active.has(job.status) && (job.openingAt === plan.openingAt || (job.request.date === plan.request.date && job.request.startTime === plan.request.startTime)))) throw new Error('An active job already targets this match or opening time; inspect or cancel it first')
        const id = randomUUID()
        const script = `anybotty-${id}.sh`
        const walletRecheck = funding ? { status: Date.parse(recheckAt) > new Date(now).getTime() ? 'prepared' : 'covered_by_initial_check', schedule: recheckAt, script: `anybotty-wallet-${id}.sh`, cronName: `Crédits 4PADEL ${plan.request.date} ${plan.request.startTime}`, cronJobId: null, workdir: projectDirectory } : null
        const record = { ...plan, id, status: 'prepared', createdAt: new Date(now).toISOString(), cronJobId: null, script, walletCheck: funding, walletRecheck }
        save(record)
        try {
          writeFileSync(join(scriptsDirectory, script), `#!/bin/bash\nset -eu\nexec ${quote(node)} ${quote(join(projectDirectory, 'scripts/booking-jobs.js'))} run --id ${quote(id)}\n`, { flag: 'wx', mode: 0o700 })
          if (walletRecheck?.status === 'prepared') writeFileSync(join(scriptsDirectory, walletRecheck.script), `#!/bin/bash\nset -eu\nexec ${quote(node)} ${quote(join(projectDirectory, 'scripts/booking-jobs.js'))} check-wallet --id ${quote(id)}\n`, { flag: 'wx', mode: 0o700 })
        } catch (error) { save({ ...record, status: 'failed_preparation' }); throw error }
        return { ...record, schedule: plan.openingAt, cronName: `Padel ${plan.request.clubs[0]} ${plan.request.date} ${plan.request.startTime}`, workdir: projectDirectory }
      })
    },
    attach(id, cronJobId) {
      if (typeof cronJobId !== 'string' || !cronJobId.trim()) throw new Error('cron job ID required')
      return locked(() => {
        const job = read(id)
        if (job.status === 'scheduled' && job.cronJobId === cronJobId) return job
        if (job.status !== 'prepared') throw new Error('Only prepared jobs can be attached')
        if (job.walletRecheck?.status === 'prepared') throw new Error('Attach the 24-hour wallet check before the booking cron')
        if (job.walletRecheck?.cronJobId === cronJobId) throw new Error('Booking and wallet check require different cron IDs')
        return save({ ...job, cronJobId, status: 'scheduled' })
      })
    },
    attachWallet(id, cronJobId) {
      if (typeof cronJobId !== 'string' || !cronJobId.trim()) throw new Error('cron job ID required')
      return locked(() => {
        const job = read(id)
        if (job.status !== 'prepared' || !job.walletRecheck || !['prepared', 'scheduled'].includes(job.walletRecheck.status)) throw new Error('No wallet recheck awaiting attachment')
        if (job.walletRecheck.cronJobId && job.walletRecheck.cronJobId !== cronJobId) throw new Error('Wallet recheck already attached')
        return save({ ...job, walletRecheck: { ...job.walletRecheck, cronJobId, status: 'scheduled' } })
      })
    },
    async checkWallet(id, inspect, { now } = {}) {
      const startedAt = now ?? new Date()
      const job = locked(() => {
        const current = read(id)
        if (!['prepared', 'scheduled'].includes(current.status) || current.walletRecheck?.status !== 'scheduled') return null
        if (new Date(startedAt).getTime() < Date.parse(current.walletRecheck.schedule)) throw new Error('Wallet recheck is not due yet')
        if (new Date(startedAt).getTime() >= Date.parse(current.openingAt)) return null
        return save({ ...current, walletRecheck: { ...current.walletRecheck, status: 'running' } })
      })
      if (!job) return { status: 'skipped', id }
      let wallet
      try { wallet = await inspect() } catch { /* Failure is reported as unknown balance, never zero. */ }
      const result = evaluateWallet(job.walletRequirement, wallet, now ?? new Date())
      return locked(() => {
        const current = read(id)
        const walletRecheck = { ...current.walletRecheck, status: result.status, result }
        save({ ...current, walletRecheck })
        return { id, status: current.status === 'cancelled' ? 'skipped' : result.status, request: job.request, openingAt: job.openingAt, walletCheck: result }
      })
    },
    cancel(id) {
      return locked(() => {
        const job = read(id)
        if (job.status === 'running') throw new Error('Job is running; inspect its result before cancelling or retrying')
        if (!['prepared', 'scheduled'].includes(job.status)) return job
        return save({ ...job, status: 'cancelled', cancelledAt: new Date().toISOString() })
      })
    },
    async run(id, execute, { now = new Date() } = {}) {
      const claimed = locked(() => {
        const job = read(id)
        if (job.status !== 'scheduled') return null
        const delay = new Date(now).getTime() - Date.parse(job.openingAt)
        if (delay < 0) throw new Error('Opening has not started; job remains scheduled')
        if (delay > 5 * 60 * 1000) return save({ ...job, status: 'missed', finishedAt: new Date().toISOString() })
        return save({ ...job, status: 'running', startedAt: new Date().toISOString() })
      })
      if (!claimed) return { status: 'skipped', id }
      if (claimed.status === 'missed') return claimed
      let result
      try {
        result = await execute(claimed.request, claimed.mode, claimed.provider ?? 'anybuddy')
        const statuses = ['checkout_ready', 'no_match', 'incomplete', 'blocked']
        if (claimed.provider === '4padel') statuses.push('not_open', 'outside_assumed_horizon', 'insufficient_wallet_balance', 'already_reserved_or_pending', 'error')
        if (claimed.provider === '4padel' && claimed.mode === 'pay') statuses.push('booking_unverified', 'cancelled')
        if (claimed.mode === 'pay') statuses.push('booked', 'existing_reservation', 'payment_failed', 'payment_action_required', 'payment_unverified')
        if (!statuses.includes(result?.status) || (claimed.mode !== 'pay' && (result.paymentSubmitted === true || result.reservationConfirmed === true)) || (result.status === 'booked' && result.reservationConfirmed !== true)) throw new Error('Invalid booking result')
      } catch { result = { status: claimed.mode === 'pay' ? 'payment_unverified' : 'blocked', paymentSubmitted: claimed.mode === 'pay' ? null : false, reservationConfirmed: false, reason: 'Search interrupted or invalid result; reconcile payment before any retry' } }
      return locked(() => save({ ...read(id), status: result.status, result, paymentSubmitted: result.paymentSubmitted ?? null, reservationConfirmed: result.reservationConfirmed === true, finishedAt: new Date().toISOString() }))
    },
  }
}

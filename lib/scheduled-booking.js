import { mkdirSync, writeFileSync, readFileSync, renameSync, readdirSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { calculateSchedule } from './booking-schedule.js'

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
    prepare(input, catalog, options) {
      const plan = calculateSchedule(input, catalog, options)
      if (plan.status !== 'ready') return plan
      return locked(() => {
        if (list().some(job => active.has(job.status) && (job.openingAt === plan.openingAt || (job.request.date === plan.request.date && job.request.startTime === plan.request.startTime)))) throw new Error('An active job already targets this match or opening time; inspect or cancel it first')
        const id = randomUUID()
        const script = `anybotty-${id}.sh`
        const record = { ...plan, id, status: 'prepared', mode: 'preview', createdAt: new Date().toISOString(), cronJobId: null, script }
        save(record)
        try {
          writeFileSync(join(scriptsDirectory, script), `#!/bin/bash\nset -eu\nexec ${quote(node)} ${quote(join(projectDirectory, 'scripts/booking-jobs.js'))} run --id ${quote(id)}\n`, { flag: 'wx', mode: 0o700 })
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
        return save({ ...job, cronJobId, status: 'scheduled' })
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
        result = await execute(claimed.request)
        if (!['checkout_ready', 'no_match', 'incomplete', 'blocked'].includes(result?.status) || result.paymentSubmitted === true || result.reservationConfirmed === true) throw new Error('Invalid preview result')
      } catch { result = { status: 'blocked', reason: 'Search failed or produced an invalid result; inspect local search logs before retrying' } }
      return locked(() => save({ ...claimed, status: result.status, result, paymentSubmitted: false, reservationConfirmed: false, finishedAt: new Date().toISOString() }))
    },
  }
}

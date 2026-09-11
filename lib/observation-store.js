import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync, gunzipSync } from 'node:zlib'
import { hostname } from 'node:os'

const entries = directory => existsSync(directory) ? readdirSync(directory) : []
export const latestRecord = (root, clubId) => {
  const clubDirectory = join(root, clubId)
  const days = entries(clubDirectory).filter(name => /^\d{4}-\d{2}-\d{2}$/.test(name)).sort().reverse()
  for (const day of days) {
    const files = entries(join(clubDirectory, day)).filter(name => name.endsWith('.json.gz')).sort()
    if (files.length) return JSON.parse(gunzipSync(readFileSync(join(clubDirectory, day, files.at(-1)))))
  }
  return null
}

export const saveRecord = (root, record) => {
  const directory = join(root, record.clubId, record.attemptedAt.slice(0, 10))
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const target = join(directory, `${record.attemptedAt.replaceAll(':', '-')}.json.gz`)
  const temp = `${target}.${process.pid}.tmp`
  writeFileSync(temp, gzipSync(JSON.stringify(record)), { mode: 0o600 })
  renameSync(temp, target)
}

// Keep a rolling month of raw observations; the latest record carries forward
// the last successful snapshot and up to 100 observed horizon extensions.
export const pruneRecords = (root, clubId, now = new Date()) => {
  const cutoff = new Date(now.getTime() - 30 * 86400000).toISOString().slice(0, 10)
  const directory = join(root, clubId)
  const days = entries(directory).filter(name => /^\d{4}-\d{2}-\d{2}$/.test(name)).sort()
  for (const day of days.slice(0, -1)) if (day < cutoff) rmSync(join(directory, day), { recursive: true, force: true })
}

export const acquireLock = root => {
  mkdirSync(root, { recursive: true, mode: 0o700 })
  const file = join(root, '.collector.lock')
  const create = () => writeFileSync(file, JSON.stringify({ pid: process.pid, host: hostname() }), { flag: 'wx', mode: 0o600 })
  try { create() } catch (error) {
    if (error.code !== 'EEXIST') throw error
    let owner
    try { owner = JSON.parse(readFileSync(file, 'utf8')) } catch {
      // A just-created lock may not yet contain its owner.
      if (Date.now() - statSync(file).mtimeMs < 60000) return null
    }
    if (owner) {
      if (owner.host !== hostname()) return null
      try { process.kill(owner.pid, 0); return null } catch (error) { if (error.code !== 'ESRCH') return null }
    }
    // Only one contender wins removal; another process may acquire before us.
    try { rmSync(file) } catch (error) { if (error.code === 'ENOENT') return null; throw error }
    try { create() } catch (error) { if (error.code === 'EEXIST') return null; throw error }
  }
  return () => rmSync(file, { force: true })
}

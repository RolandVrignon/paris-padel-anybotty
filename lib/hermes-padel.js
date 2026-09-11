import { createHash, randomUUID } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { validateRequest } from './plan.js'

const normalizeName = value => value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[^a-z0-9]/g, '')
export const findClubs = (clubs, query) => {
  if (typeof query !== 'string' || !normalizeName(query)) throw new Error('Provide a club name or ID')
  const normalized = normalizeName(query)
  const exact = clubs.filter(club => [club.id, club.name].some(value => normalizeName(value) === normalized))
  const matches = exact.length ? exact : clubs.filter(club => [club.id, club.name].some(value => normalizeName(value).includes(normalized)))
  return { status: matches.length === 0 ? 'not_found' : matches.length > 1 ? 'ambiguous' : exact.length ? 'exact' : 'unique_partial', matches }
}

const versionOf = text => createHash('sha256').update(text).digest('hex')
export const readRequest = (path, clubs) => {
  if (!existsSync(path)) return { status: 'not_configured', version: 'missing', request: null }
  const text = readFileSync(path, 'utf8')
  let input
  try { input = JSON.parse(text) } catch { throw new Error('Invalid request JSON') }
  const request = { ...validateRequest(input, clubs), date: input.date }
  return { status: 'configured', version: versionOf(text), request }
}

export const saveRequest = (path, input, expectedVersion, clubs) => {
  if (typeof expectedVersion !== 'string' || !expectedVersion) throw new Error('Read request show and supply --expected-version before saving')
  const request = { ...validateRequest(input, clubs), date: input.date }
  // Serialize writers with an exclusive file; never overwrite changes from another chat.
  const lock = `${path}.lock.local.json`
  try { writeFileSync(lock, String(process.pid), { flag: 'wx', mode: 0o600 }) } catch (error) {
    if (error.code === 'EEXIST') throw new Error('Request update locked; inspect the active writer before retrying', { cause: error })
    throw error
  }
  const temporary = resolve(dirname(path), `config.request.${randomUUID()}.local.json`)
  try {
    const oldText = existsSync(path) ? readFileSync(path, 'utf8') : null
    const current = oldText === null ? 'missing' : versionOf(oldText)
    if (current !== expectedVersion) throw new Error('Request changed since it was read; reload before applying changes')
    if (oldText !== null) {
      const backupDirectory = resolve(dirname(path), '.auth/request-backups')
      mkdirSync(backupDirectory, { recursive: true, mode: 0o700 })
      writeFileSync(resolve(backupDirectory, `${Date.now()}-${randomUUID()}.json`), oldText, { mode: 0o600 })
    }
    writeFileSync(temporary, `${JSON.stringify(request, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
    renameSync(temporary, path)
    return { ...readRequest(path, clubs), status: 'saved', scheduled: false }
  } finally {
    rmSync(temporary, { force: true })
    rmSync(lock, { force: true })
  }
}

export const summarizeAvailability = (club, snapshot, { time, durations } = {}) => ({
  clubId: club.id, name: club.name, checkedAt: snapshot.finishedAt, window: snapshot.window,
  priceNote: 'Public listed prices for the whole court; the final checkout total is authoritative. Court environment is verified in the browser.',
  slots: snapshot.slots.filter(slot => (!time || slot.startDateTime.slice(11) === time) && (!durations || durations.includes(slot.durationMinutes))).map(slot => {
    const prices = slot.offers.map(offer => offer.priceCents).filter(price => Number.isFinite(price) && price >= 0)
    const minTotalEUR = prices.length ? Math.min(...prices) / 100 : null
    return { startDateTime: slot.startDateTime, durationMinutes: slot.durationMinutes, offerCount: slot.offers.length, minTotalEUR, minPricePerHourEUR: minTotalEUR === null ? null : minTotalEUR * 60 / slot.durationMinutes }
  }),
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync, statSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { findClubs, readRequest, saveRequest, summarizeAvailability } from '../lib/hermes-padel.js'
const clubs = JSON.parse(readFileSync(new URL('../data/clubs.json', import.meta.url), 'utf8'))
const request = { date: '21/09/2026', startTime: '20:00', clubs: ['paris-padel'], durationsMinutes: [60, 90], courtEnvironment: ['indoor', 'outdoor'], maxPricePerHourEUR: 80 }
const temporary = t => {
  const root = mkdtempSync(join(tmpdir(), 'padel-hermes-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return root
}

test('club lookup tolerates accents and spacing but never silently chooses among Bercy or 4padel clubs', () => {
  assert.equal(findClubs(clubs, '  4 PADEL paris 20 ').matches[0].id, '4padel-paris-20')
  assert.equal(findClubs(clubs, 'sportfield bercy').status, 'exact')
  assert.equal(findClubs(clubs, 'BERCY').status, 'ambiguous')
  assert.equal(findClubs(clubs, '4padel').matches.length, 2)
  assert.equal(findClubs(clubs, 'ucpa').status, 'unique_partial')
  assert.equal(findClubs(clubs, 'unknown').status, 'not_found')
  assert.throws(() => findClubs(clubs, ''))
})

test('request updates preserve preferences, validate full input and refuse stale chat versions', t => {
  const root = temporary(t)
  const path = join(root, 'config.request.json')
  assert.equal(readRequest(path, clubs).version, 'missing')
  const first = saveRequest(path, request, 'missing', clubs)
  assert.deepEqual(first.request, request)
  assert.equal(statSync(path).mode & 0o777, 0o600)
  const second = saveRequest(path, { ...request, maxPricePerHourEUR: 65 }, first.version, clubs)
  assert.equal(second.request.maxPricePerHourEUR, 65)
  assert.equal(second.request.date, '21/09/2026')
  assert.equal(second.scheduled, false)
  assert.throws(() => saveRequest(path, request, first.version, clubs), /changed/)
  assert.equal(readRequest(path, clubs).version, second.version)
  const backups = readdirSync(join(root, '.auth/request-backups'))
  assert.equal(backups.length, 1)
  assert.deepEqual(JSON.parse(readFileSync(join(root, '.auth/request-backups', backups[0]))), request)
  for (const invalid of [{ ...request, account: { password: 'private' } }, { ...request, clubs: ['unknown'] }, { ...request, maxPricePerHourEUR: -1 }]) {
    assert.throws(() => saveRequest(path, invalid, second.version, clubs))
  }
  assert.equal(readRequest(path, clubs).version, second.version)
  writeFileSync(`${path}.lock.local.json`, 'writer')
  assert.throws(() => saveRequest(path, request, second.version, clubs), /locked/)
  assert.ok(existsSync(`${path}.lock.local.json`))
})

test('request parsing never displays malformed content or credentials', t => {
  const path = join(temporary(t), 'config.request.json')
  writeFileSync(path, '{"password":"private" invalid}')
  assert.throws(() => readRequest(path, clubs), error => !error.message.includes('private'))
  writeFileSync(path, JSON.stringify({ ...request, account: { password: 'private' } }))
  assert.throws(() => readRequest(path, clubs), /Unsupported/)
})

test('availability summaries report public hourly price without leaking service IDs or inventing environment', () => {
  const result = summarizeAvailability(clubs[0], { finishedAt: '2026-09-11T10:00:00Z', window: { from: '2026-09-21', to: '2026-09-21' }, slots: [
    { startDateTime: '2026-09-21T20:00', durationMinutes: 120, offers: [{ serviceId: 'internal', priceCents: 12000 }] },
    { startDateTime: '2026-09-21T21:00', durationMinutes: 90, offers: [{ serviceId: 'internal2', priceCents: 9000 }] },
  ] }, { time: '20:00', durations: [120] })
  assert.equal(result.slots.length, 1)
  assert.equal(result.slots[0].minPricePerHourEUR, 60)
  assert.equal(result.slots[0].minTotalEUR, 120)
  assert.ok(!JSON.stringify(result).includes('internal'))
})

test('Hermes installer renders all skills, preserves unrelated skills and is repeatable', t => {
  const root = temporary(t)
  const env = { ...process.env, HERMES_HOME: root }
  for (let i = 0; i < 2; i++) {
    const result = spawnSync(process.execPath, ['scripts/install-hermes-skills.js'], { env, encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(JSON.parse(result.stdout).installed.length, 5)
  }
  for (const name of ['padel-booking', 'padel-clubs', 'padel-monitoring', 'padel-strategy', 'padel-scheduling']) {
    const directory = join(root, 'skills', name)
    const text = readFileSync(join(directory, 'SKILL.md'), 'utf8')
    assert.ok(!text.includes('{{PROJECT_DIR}}'))
    assert.ok(text.includes(process.cwd()))
    assert.deepEqual(readdirSync(directory), ['SKILL.md'])
  }
})

test('padel CLI rejects unsupported operations and can show a request without reading fixed secrets', t => {
  const path = join(temporary(t), 'config.request.json')
  writeFileSync(path, JSON.stringify(request))
  const run = args => spawnSync(process.execPath, ['scripts/padel.js', ...args], { env: { ...process.env, ANYBOTTY_REQUEST_CONFIG_PATH: path, ANYBOTTY_FIXED_CONFIG_PATH: '/missing/fixed.json' }, encoding: 'utf8' })
  const show = run(['request', 'show'])
  assert.equal(show.status, 0)
  assert.deepEqual(JSON.parse(show.stdout).request, request)
  for (const args of [['reservations', 'cancel'], ['request', 'set'], ['availability', '--club', 'paris-padel', '--date', '2026-02-30']]) {
    const result = run(args)
    assert.equal(result.status, 1)
    assert.equal(JSON.parse(result.stdout).status, 'error')
  }
})

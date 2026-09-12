import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, writeFileSync, readFileSync, statSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { createProviderSession, identityMatches, providerSessionFiles, saveProviderSession, savedProviderSession } from '../lib/provider-session.js'
import { authenticateFourPadel } from '../lib/fourpadel-session.js'
import { authenticateUcpa, readUcpaIdentity, UCPA_IDENTITY_URL } from '../lib/ucpa-session.js'
import { parseProviderAuthArgs } from '../lib/provider-auth-cli.js'

const email = 'fixture@example.test'
const fixture = t => {
  const root = mkdtempSync(join(tmpdir(), 'anybotty-provider-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  writeFileSync(join(root, 'config.fixed.json'), JSON.stringify({ providers: { ucpa: { account: { email, password: 'private-password' } }, '4padel': { account: { email, password: 'private-password' } } } }))
  return root
}
const state = { cookies: [], origins: [] }

test('provider sessions are private, isolated by provider and bound to the configured account', async t => {
  const root = fixture(t)
  await saveProviderSession({ storageState: async () => state }, root, 'ucpa', email)
  const files = providerSessionFiles(root, 'ucpa')
  assert.equal(statSync(files.state).mode & 0o777, 0o600)
  assert.equal(statSync(files.directory).mode & 0o777, 0o700)
  assert.deepEqual(savedProviderSession(root, 'ucpa', email.toUpperCase()), state)
  assert.equal(savedProviderSession(root, '4padel', email), null)
  assert.equal(savedProviderSession(root, 'ucpa', 'other@example.test'), null)
  assert.ok(!readFileSync(files.meta, 'utf8').includes(email))
  writeFileSync(files.state, 'malformed JSON')
  assert.equal(savedProviderSession(root, 'ucpa', email), null)
})

test('server identity is mandatory and mismatch diagnostics contain no identity values', () => {
  assert.doesNotThrow(() => identityMatches('ucpa', ' FIXTURE@EXAMPLE.TEST ', email))
  for (const actual of [null, '', 'private-other@example.test']) {
    assert.throws(() => identityMatches('ucpa', actual, email), error => ['identity_unverified', 'account_mismatch'].includes(error.code) && !error.message.includes('@'))
  }
})

test('a check without a bound saved session never launches a browser or a login', async t => {
  const root = fixture(t)
  let launches = 0
  t.mock.method(chromium, 'launch', async () => { launches++; throw new Error('Must not launch') })
  await assert.rejects(createProviderSession('ucpa', () => { throw new Error('Must not login') }, { root, checkOnly: true }), error => error.code === 'login_required')
  assert.equal(launches, 0)
})

test('successful checks do not overwrite session files; mismatched or failed logins cannot save', async t => {
  const root = fixture(t)
  await saveProviderSession({ storageState: async () => state }, root, 'ucpa', email)
  const files = providerSessionFiles(root, 'ucpa')
  const original = readFileSync(files.meta, 'utf8')
  let closes = 0
  const context = { newPage: async () => ({ setDefaultTimeout() {}, close: async () => {} }), storageState: async () => ({ cookies: [], origins: [{ origin: 'https://authent.ucpa.com', localStorage: [] }] }) }
  t.mock.method(chromium, 'launch', async () => ({ newContext: async () => context, close: async () => { closes++ } }))
  const session = await createProviderSession('ucpa', async () => ({ email }), { root, checkOnly: true })
  assert.equal(session.sessionSaved, false)
  await session.close()
  assert.equal(readFileSync(files.meta, 'utf8'), original)
  await assert.rejects(createProviderSession('ucpa', async () => ({ email: 'someone-else@example.test' }), { root, fresh: true }), error => error.code === 'account_mismatch')
  await assert.rejects(createProviderSession('ucpa', async () => { throw new Error('Call log: private-password') }, { root }), error => !error.message.includes('private-password') && !error.cause)
  assert.equal(readFileSync(files.meta, 'utf8'), original)
  assert.deepEqual(savedProviderSession(root, 'ucpa', email), state)
  assert.equal(closes, 3)
})

test('UCPA check uses only the server identity GET, rejects stale sessions and malformed responses', async () => {
  let requests = 0
  const context = status => ({ request: { get: async (url, options) => {
    requests++
    assert.equal(url, UCPA_IDENTITY_URL)
    assert.equal(options.maxRedirects, 0)
    return { status: () => status, ok: () => status === 200, json: async () => ({ success: true, data: { email } }) }
  } } })
  assert.equal(await readUcpaIdentity(context(403)), null)
  const page = { context: () => context(403), goto: async () => { throw new Error('check must not navigate/login') } }
  await assert.rejects(authenticateUcpa(page, { email }, { checkOnly: true, timeoutMs: 1000 }), error => error.code === 'login_required')
  assert.deepEqual(await readUcpaIdentity(context(200)), { email })
  await assert.rejects(readUcpaIdentity({ request: { get: async () => ({ status: () => 200, ok: () => true, json: async () => ({ success: false, data: { email } }) }) } }), error => error.code === 'identity_unverified')
  assert.equal(requests, 3)
})

test('4PADEL check refuses the login form without entering credentials', async () => {
  let fills = 0
  const page = {
    on() {}, removeListener() {}, goto: async () => {},
    locator: () => ({ first: () => ({ waitFor: async () => {} }), count: async () => 1, fill: async () => { fills++ } }),
  }
  await assert.rejects(authenticateFourPadel(page, { email, password: 'secret' }, { checkOnly: true }), error => error.code === 'login_required')
  assert.equal(fills, 0)
})

test('CLI keeps interactive login explicit and cannot combine it with a passive check', () => {
  assert.equal(parseProviderAuthArgs(['--check']).checkOnly, true)
  assert.equal(parseProviderAuthArgs(['--headed', '--manual']).manual, true)
  for (const args of [['--manual'], ['--check', '--manual'], ['--check', '--fresh'], ['--headed', '--headless'], ['--check', '--check'], ['--password=secret']]) assert.throws(() => parseProviderAuthArgs(args))
})

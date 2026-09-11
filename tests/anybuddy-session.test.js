import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, readFileSync, statSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { before, after, test } from 'node:test'
import { chromium } from 'playwright'
import { checkSession, loginWithPage, saveSession } from '../lib/anybuddy-session.js'

let browser
before(async () => { browser = await chromium.launch() })
after(async () => { await browser.close() })
const fixed = { account: { email: 'fixture@example.test', password: 'fixture-only' }, browser: { timeoutMs: 3000 } }
const fixture = async (t, { reject = false, email = fixed.account.email } = {}) => {
  const posts = []
  const server = createServer((request, response) => {
    if (request.method === 'POST') posts.push(request.url)
    if (request.url === '/fr/login') {
      response.setHeader('Content-Type', 'text/html')
      response.end('<form><label for="email">Email</label><input id="email"><label for="password">Mot de passe</label><input id="password" type="password"><button>Se connecter</button></form><script>document.querySelector(\'form\').onsubmit=async e=>{e.preventDefault();await fetch(\'/v1/accounts:signInWithPassword\',{method:\'POST\'})}</script>')
    } else if (request.url === '/v1/accounts:signInWithPassword') {
      response.statusCode = reject ? 400 : 200
      if (!reject) response.setHeader('Set-Cookie', 'session=fixture; HttpOnly; Path=/; SameSite=Lax')
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify(reject ? { error: 'invalid' } : { success: true }))
    } else if (request.url === '/api/me') {
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify({ user: request.headers.cookie?.includes('session=fixture') ? { email } : null }))
    } else { response.statusCode = 404; response.end() }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const context = await browser.newContext()
  t.after(async () => { await context.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) })
  return { origin: `http://127.0.0.1:${server.address().port}`, page: await context.newPage(), context, posts }
}

test('Playwright login verifies identity and restores a private saved session', async t => {
  const { origin, page, context, posts } = await fixture(t)
  assert.equal(await checkSession(context, fixed.account.email, { origin }), false)
  await loginWithPage(page, fixed, { origin })
  assert.equal(await checkSession(context, fixed.account.email, { origin }), true)
  const root = mkdtempSync(join(tmpdir(), 'anybotty-session-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const path = join(root, '.auth/session.json')
  await saveSession(context, path)
  assert.equal(statSync(path).mode & 0o777, 0o600)
  assert.equal(statSync(join(root, '.auth')).mode & 0o777, 0o700)
  const restored = await browser.newContext({ storageState: path })
  try { assert.equal(await checkSession(restored, fixed.account.email, { origin }), true) } finally { await restored.close() }
  assert.deepEqual(posts, ['/v1/accounts:signInWithPassword'])
  assert.equal(readFileSync(path, 'utf8').includes(fixed.account.password), false)
})

test('rejected password does not report authentication', async t => {
  const { origin, page, context } = await fixture(t, { reject: true })
  await assert.rejects(loginWithPage(page, fixed, { origin }), /Login refused/)
  assert.equal(await checkSession(context, fixed.account.email, { origin }), false)
})

test('successful login to a different identity is rejected', async t => {
  const { origin, page } = await fixture(t, { email: 'different@example.test' })
  await assert.rejects(loginWithPage(page, fixed, { origin }), /different account/)
})

test('Firebase persistence requests IndexedDB as well as cookies and local storage', async t => {
  const root = mkdtempSync(join(tmpdir(), 'anybotty-state-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  await saveSession({ storageState: async options => { assert.equal(options.indexedDB, true); return { cookies: [], origins: [] } } }, join(root, 'session.json'))
})

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { waitForUcpaIdentity, authenticateUcpa } from '../lib/ucpa-session.js'

const email = 'fixture@example.test'
const response = (status, body = { success: true, data: { email } }) => ({ status: () => status, ok: () => status === 200, json: async () => body })
const fixture = outcomes => {
  let time = 0, calls = 0
  const delays = [], logs = [], timeouts = []
  return {
    context: { request: { get: async (url, options) => {
      assert.equal(options.maxRedirects, 0)
      assert.ok(options.timeout > 0)
      timeouts.push(options.timeout)
      const outcome = outcomes[Math.min(calls++, outcomes.length - 1)]
      if (outcome instanceof Error) throw outcome
      return outcome
    } } },
    options: { now: () => time, pause: async delay => { delays.push(delay); time += delay }, onProgress: event => logs.push(event) },
    get calls() { return calls }, delays, logs, timeouts,
  }
}

test('UCPA retries transient identity failures, with bounded backoff and no private logs', async () => {
  const f = fixture([new Error('request timed out: private-token'), response(503), response(200)])
  assert.deepEqual(await waitForUcpaIdentity(f.context, f.options), { email })
  assert.deepEqual(f.delays, [2000, 4000])
  assert.deepEqual(f.logs.map(log => log.reason), ['identity_timeout', 'identity_unavailable'])
  assert.ok(!JSON.stringify(f.logs).includes('private-token'))
})

test('UCPA waits for a portal session after redirect but checks expired sessions without polling', async () => {
  const delayed = fixture([response(401), response(302), response(200)])
  assert.deepEqual(await waitForUcpaIdentity(delayed.context, { ...delayed.options, waitForSession: true }), { email })
  assert.equal(delayed.calls, 3)
  const expired = fixture([response(403)])
  assert.equal(await waitForUcpaIdentity(expired.context, expired.options), null)
  assert.equal(expired.calls, 1)
})

test('UCPA identity reads respect the shared deadline and stop at the retry limit', async () => {
  const f = fixture([response(503)])
  await assert.rejects(waitForUcpaIdentity(f.context, { ...f.options, timeoutMs: 5000 }), error => error.code === 'identity_unavailable')
  assert.deepEqual(f.timeouts, [5000, 3000])
  assert.equal(f.delays.reduce((a, b) => a + b), 5000)
  const capped = fixture([response(429)])
  await assert.rejects(waitForUcpaIdentity(capped.context, capped.options), error => error.code === 'identity_unavailable')
  assert.equal(capped.calls, 3)
})

test('UCPA does not retry malformed identities, permanent errors, or a closed browser', async () => {
  for (const outcome of [response(200, { success: false }), response(400), new Error('Target page, context or browser has been closed')]) {
    const f = fixture([outcome])
    await assert.rejects(waitForUcpaIdentity(f.context, f.options))
    assert.equal(f.calls, 1)
  }
  const mismatch = fixture([response(200, { success: true, data: { email: 'other@example.test' } })])
  assert.deepEqual(await waitForUcpaIdentity(mismatch.context, mismatch.options), { email: 'other@example.test' })
  // The shared provider session must perform its existing account identity check.
  assert.equal(mismatch.calls, 1)
})

test('UCPA reports a persistently absent session separately from a network failure', async () => {
  const f = fixture([response(401)])
  await assert.rejects(waitForUcpaIdentity(f.context, { ...f.options, waitForSession: true, timeoutMs: 5000 }), error => error.code === 'login_unconfirmed')
  const network = fixture([new Error('ECONNRESET private-url')])
  await assert.rejects(waitForUcpaIdentity(network.context, network.options), error => error.code === 'identity_network_error' && !error.message.includes('private-url'))
})

test('UCPA login submits credentials once even when portal session becomes ready late', async () => {
  let reads = 0, submits = 0, location = 'https://authent.ucpa.com/'
  const page = {
    context: () => ({ request: { get: async () => response(++reads < 3 ? 401 : 200) } }),
    goto: async () => {}, waitForURL: async () => {}, url: () => location,
    on() {}, removeListener() {},
    locator: () => ({ waitFor: async () => {}, fill: async () => {} }),
    getByRole: () => ({ click: async () => { submits++; location = 'https://www.ucpa.com/sport-station/espacepersonnel/paris-19/accueil' } }),
  }
  assert.deepEqual(await authenticateUcpa(page, { email, password: 'private' }, { timeoutMs: 5000 }), { email })
  assert.equal(submits, 1)
  assert.equal(reads, 3)
})

test('UCPA distinguishes a login service outage, bad credentials and an interactive challenge', async () => {
  for (const [status, body, code] of [[503, {}, 'login_service_unavailable'], [400, { __type: 'NotAuthorizedException' }, 'login_refused'], [200, { ChallengeName: 'SOFTWARE_TOKEN_MFA' }, 'interaction_required'], [200, {}, 'login_redirect_timeout']]) {
    let observer, waits = 0, submits = 0
    const page = {
      context: () => ({ request: { get: async () => response(401) } }),
      goto: async () => {}, url: () => 'https://authent.ucpa.com/',
      waitForURL: async () => { if (++waits === 2) throw new Error('timeout private-url') },
      on: (event, fn) => { observer = fn }, removeListener() {},
      locator: () => ({ waitFor: async () => {}, fill: async () => {} }),
      getByRole: () => ({ click: async () => { submits++; await observer({ url: () => 'https://cognito-idp.eu-west-1.amazonaws.com/', status: () => status, json: async () => body }) } }),
    }
    await assert.rejects(authenticateUcpa(page, { email, password: 'private' }, { timeoutMs: 1000 }), error => error.code === code && !error.message.includes('private'))
    assert.equal(submits, 1)
  }
})

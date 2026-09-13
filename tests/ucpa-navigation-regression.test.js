import assert from 'node:assert/strict'
import { test } from 'node:test'
import { chromium } from 'playwright'
import { authenticateUcpa, waitForUcpaLoginState } from '../lib/ucpa-session.js'
import { ucpaSlotButton } from '../lib/ucpa-booking.js'

const email = 'fixture@example.test'
const identityResponse = ready => ({ status: () => ready ? 200 : 401, ok: () => ready, json: async () => ({ success: true, data: { email } }) })

test('UCPA automatic SSO can return to the portal without a login form or credential submission', async () => {
  const browser = await chromium.launch()
  try {
    const context = await browser.newContext()
    let restored = false, posts = 0, reads = 0
    context.on('request', request => { if (request.method() !== 'GET') posts++ })
    await context.route('**/*', async route => {
      const url = new URL(route.request().url())
      let script
      if (url.searchParams.get('restored') === '1') { restored = true; script = '' }
      else if (url.origin === 'https://authent.ucpa.com') script = 'setTimeout(() => location.href=\'https://www.ucpa.com/sport-station/espacepersonnel/paris-19/accueil?restored=1\', 100)'
      else script = 'location.href=\'https://authent.ucpa.com/login\''
      await route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<main>SSO</main><script>${script}</script>` })
    })
    const realPage = await context.newPage()
    const page = new Proxy(realPage, { get(target, key) {
      if (key === 'context') return () => ({ request: { get: async () => { reads++; return identityResponse(restored) } } })
      const value = Reflect.get(target, key)
      return typeof value === 'function' ? value.bind(target) : value
    } })
    assert.deepEqual(await authenticateUcpa(page, { email, password: 'not-submitted' }, { timeoutMs: 10000 }), { email })
    assert.equal(posts, 0)
    assert.ok(reads >= 2)
    assert.equal(await realPage.locator('#email').count(), 0)
  } finally { await browser.close() }
})

test('UCPA intermediate portal URL without identity keeps waiting for the actual form', async () => {
  let time = 0, checks = 0
  const page = {
    url: () => time === 0 ? 'https://www.ucpa.com/sport-station/espacepersonnel/paris-19/accueil' : 'https://authent.ucpa.com/login',
    context: () => ({ request: { get: async () => { checks++; return identityResponse(false) } } }),
    locator: () => ({ isVisible: async () => true }),
  }
  assert.deepEqual(await waitForUcpaLoginState(page, 5000, { now: () => time, pause: async delay => { time += delay } }), { form: true })
  assert.equal(checks, 1)
  assert.ok(time > 0)
})

test('UCPA missing form and missing session report a bounded specific error', async () => {
  let time = 0
  const page = { url: () => 'https://authent.ucpa.com/login', locator: () => ({ isVisible: async () => false }) }
  await assert.rejects(waitForUcpaLoginState(page, 3000, { now: () => time, pause: async delay => { time += delay } }), error => error.code === 'login_form_unavailable')
  assert.equal(time, 3000)
})

test('UCPA calendar selects padded or unpadded single-digit days inside its shadow DOM', async () => {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({ viewport: { width: 600, height: 1000 } })
    for (const day of ['07', '7']) {
      await page.setContent('<web-component-planner></web-component-planner>')
      await page.evaluate(day => {
        const root = globalThis.document.querySelector('web-component-planner').attachShadow({ mode: 'open' })
        root.innerHTML = `<section class="mobile-day"><h3>mardi</h3><span>06</span><ul><li>07h00 - 08h00<button id="wrong-day">RÉSERVER</button></li></ul></section>
        <section class="mobile-day"><h3>mercredi</h3><span>${day}</span><ul><li>07h00 - 08h00<button id="correct">RÉSERVER</button></li><li>08h00 - 09h00<button id="wrong-time">RÉSERVER</button></li></ul></section>`
        root.addEventListener('click', event => { globalThis.selected = event.target.id })
      }, day)
      await ucpaSlotButton(page, { date: '2026-10-07', startTime: '07:00' }, 60).click({ timeout: 1000 })
      assert.equal(await page.evaluate(() => globalThis.selected), 'correct')
    }
  } finally { await browser.close() }
})

import { mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { setTimeout as pause } from 'node:timers/promises'

export const ANYBUDDY_ORIGIN = 'https://www.anybuddyapp.com'
const accountMatches = (user, email) => {
  if (!user || typeof user !== 'object' || typeof user.email !== 'string') throw new Error('Authenticated identity could not be verified from /api/me')
  if (user.email.trim().toLowerCase() !== email.trim().toLowerCase()) throw new Error('The session belongs to a different account; session was not saved')
}

export const checkSession = async (context, email, { origin = ANYBUDDY_ORIGIN, timeoutMs = 15000 } = {}) => {
  const response = await context.request.get(`${origin}/api/me`, { timeout: timeoutMs, maxRedirects: 0 })
  if ([401, 403].includes(response.status())) return false
  if (!response.ok()) throw new Error(`Unable to check session (HTTP ${response.status()})`)
  let body
  try { body = await response.json() } catch { throw new Error('Unexpected session response') }
  if (body.user === null) return false
  accountMatches(body.user, email)
  return true
}

export const loginWithPage = async (page, fixed, { origin = ANYBUDDY_ORIGIN, manual = false, timeoutMs = fixed.browser.timeoutMs } = {}) => {
  page.setDefaultTimeout(timeoutMs)
  await page.goto(`${origin}/fr/login`, { waitUntil: 'domcontentloaded', timeout: timeoutMs })
  await page.locator('#email').waitFor({ state: 'visible' })
  if (!manual) {
    await page.locator('#email').fill(fixed.account.email)
    await page.locator('#password').fill(fixed.account.password)
    const [response] = await Promise.all([
      page.waitForResponse(response => new URL(response.url()).pathname === '/v1/accounts:signInWithPassword', { timeout: timeoutMs }),
      page.getByRole('button', { name: 'Se connecter', exact: true }).click(),
    ])
    if (!response.ok()) throw new Error(`Login refused (HTTP ${response.status()}); check credentials or use --manual for an interactive login`)
  }
  const deadline = Date.now() + timeoutMs
  do {
    if (await checkSession(page.context(), fixed.account.email, { origin, timeoutMs: Math.min(15000, Math.max(1, deadline - Date.now())) })) return
    const remaining = deadline - Date.now()
    if (remaining > 0) await pause(Math.min(2000, remaining))
  } while (Date.now() < deadline)
  throw new Error('Login was not confirmed by /api/me before the timeout; no session saved')
}

export const saveSession = async (context, path) => {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.${process.pid}.tmp`
  writeFileSync(temporary, JSON.stringify(await context.storageState({ indexedDB: true })), { mode: 0o600, flag: 'wx' })
  renameSync(temporary, path)
}

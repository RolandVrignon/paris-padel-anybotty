import { createProviderSession, ProviderAuthError } from './provider-session.js'
import { setTimeout as sleep } from 'node:timers/promises'

export const UCPA_ACCOUNT_URL = 'https://www.ucpa.com/sport-station/espacepersonnel/paris-19'
export const UCPA_IDENTITY_URL = 'https://www.ucpa.com/sport-station/espacepersonnel/api/paris-19/user'

export const readUcpaIdentity = async (context, timeoutMs = 20000) => {
  let response
  try {
    response = await context.request.get(UCPA_IDENTITY_URL, { maxRedirects: 0, timeout: timeoutMs })
  } catch (error) {
    if (error.name === 'TimeoutError' || /timed out|timeout .*exceeded/i.test(error.message)) throw new ProviderAuthError('ucpa', 'identity_timeout', 'portal identity request timed out')
    if (/ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|net::ERR_/i.test(error.message)) throw new ProviderAuthError('ucpa', 'identity_network_error', 'portal identity request failed on the network')
    throw error
  }
  if ([301, 302, 303, 307, 308, 401, 403].includes(response.status())) return null
  if (!response.ok()) throw new ProviderAuthError('ucpa', response.status() === 408 || response.status() === 429 || response.status() >= 500 ? 'identity_unavailable' : 'identity_rejected', `identity check HTTP ${response.status()}`)
  let body
  try { body = await response.json() } catch { throw new ProviderAuthError('ucpa', 'identity_unverified', 'unexpected identity response') }
  if (body?.success !== true || typeof body.data?.email !== 'string') throw new ProviderAuthError('ucpa', 'identity_unverified', 'server did not confirm an authenticated identity')
  return { email: body.data.email }
}

// Retry only the read-only portal identity request; never submit the login again.
export const waitForUcpaIdentity = async (context, {
  timeoutMs = 60000, waitForSession = false, maxAttempts = waitForSession ? 10 : 3,
  now = Date.now, pause = sleep, onProgress = event => console.error(JSON.stringify({ provider: 'ucpa', ...event })),
} = {}) => {
  const deadline = now() + timeoutMs
  let lastError
  for (let attempt = 1; attempt <= maxAttempts && now() < deadline; attempt++) {
    try {
      const identity = await readUcpaIdentity(context, Math.min(20000, deadline - now()))
      if (identity || !waitForSession) return identity
      lastError = new ProviderAuthError('ucpa', 'login_unconfirmed', 'portal session still absent after login; credentials were not resubmitted')
    } catch (error) {
      if (!['identity_timeout', 'identity_network_error', 'identity_unavailable'].includes(error.code)) throw error
      lastError = error
    }
    const delayMs = Math.min(2000 * 2 ** (attempt - 1), 8000, deadline - now())
    if (attempt === maxAttempts || delayMs <= 0) break
    onProgress({ stage: waitForSession ? 'session_confirmation' : 'session_check', attempt, reason: lastError.code, delayMs })
    await pause(delayMs)
  }
  throw lastError || new ProviderAuthError('ucpa', 'identity_timeout', 'portal identity check deadline exceeded')
}

// The portal briefly visits /accueil before SSO, and SSO may restore the
// session without ever rendering an email field. Neither URL proves login.
export const waitForUcpaLoginState = async (page, timeoutMs, { now = Date.now, pause = sleep } = {}) => {
  const deadline = now() + timeoutMs
  let lastError
  while (now() < deadline) {
    const url = new URL(page.url())
    if (url.origin === 'https://authent.ucpa.com' && await page.locator('#email').isVisible() && await page.locator('#password').isVisible()) return { form: true }
    if (url.origin === 'https://www.ucpa.com' && url.pathname.startsWith('/sport-station/espacepersonnel/paris-19')) {
      try {
        const identity = await readUcpaIdentity(page.context(), Math.max(1, Math.min(20000, deadline - now())))
        if (identity) return { identity }
        lastError = null
      } catch (error) {
        if (!['identity_timeout', 'identity_network_error', 'identity_unavailable'].includes(error.code)) throw error
        lastError = error
      }
    }
    const delayMs = Math.min(2000, deadline - now())
    if (delayMs > 0) await pause(delayMs)
  }
  throw lastError || new ProviderAuthError('ucpa', 'login_form_unavailable', 'neither the login form nor an authenticated portal session became available')
}

export const authenticateUcpa = async (page, account, { checkOnly, manual, timeoutMs }) => {
  const identityTimeoutMs = Math.min(timeoutMs, 60000)
  const existing = await waitForUcpaIdentity(page.context(), { timeoutMs: identityTimeoutMs })
  if (existing) return existing
  if (checkOnly) throw new ProviderAuthError('ucpa', 'login_required', 'saved session expired; a new login is required')
  try {
    await page.goto(UCPA_ACCOUNT_URL, { waitUntil: 'domcontentloaded', timeout: timeoutMs })
  } catch {
    throw new ProviderAuthError('ucpa', 'login_page_unavailable', 'login page or SSO redirect unavailable within the wait limit')
  }
  const loginState = await waitForUcpaLoginState(page, timeoutMs)
  if (loginState.identity) return loginState.identity
  if (loginState.form) {
    let refused = false
    let challenge = false
    let unavailable = false
    const observe = async response => {
      if (new URL(response.url()).origin !== 'https://cognito-idp.eu-west-1.amazonaws.com') return
      if (response.status() === 429 || response.status() >= 500) unavailable = true
      try {
        const body = await response.json()
        if (['NotAuthorizedException', 'UserNotFoundException'].some(code => String(body.__type).endsWith(code))) refused = true
        if (['SMS_MFA', 'SOFTWARE_TOKEN_MFA', 'EMAIL_OTP', 'MFA_SETUP', 'NEW_PASSWORD_REQUIRED', 'SELECT_MFA_TYPE'].includes(body.ChallengeName)) challenge = true
      } catch { /* No private response body is logged. */ }
    }
    page.on('response', observe)
    try {
      if (!manual) {
        // Fill credentials only on the observed official identity-provider origin.
        if (new URL(page.url()).origin !== 'https://authent.ucpa.com') throw new ProviderAuthError('ucpa', 'unexpected_login_page', 'unexpected identity-provider origin')
        try {
          await page.locator('#email').fill(account.email)
          await page.locator('#password').fill(account.password)
          await page.getByRole('button', { name: 'Se connecter', exact: true }).click()
        } catch {
          const current = new URL(page.url())
          if (current.origin === 'https://www.ucpa.com' && current.pathname.startsWith('/sport-station/espacepersonnel/paris-19/')) return waitForUcpaIdentity(page.context(), { timeoutMs: identityTimeoutMs, waitForSession: true })
          throw new ProviderAuthError('ucpa', 'login_form_unavailable', 'login form changed or could not be submitted; credentials were not resubmitted')
        }
      }
      try {
        await page.waitForURL(url => url.origin === 'https://www.ucpa.com' && url.pathname.startsWith('/sport-station/espacepersonnel/paris-19/'), { timeout: timeoutMs })
      } catch {
        const code = refused ? 'login_refused' : challenge ? 'interaction_required' : unavailable ? 'login_service_unavailable' : 'login_redirect_timeout'
        const message = refused ? 'login refused by the identity provider; check credentials' : challenge ? 'additional authentication required; use --headed --manual' : unavailable ? 'identity provider temporarily unavailable or rate limited; login was not resubmitted' : 'portal redirect did not complete within the wait limit; this does not prove that credentials were refused'
        throw new ProviderAuthError('ucpa', code, message)
      }
    } finally { page.removeListener('response', observe) }
  }
  return waitForUcpaIdentity(page.context(), { timeoutMs: identityTimeoutMs, waitForSession: true })
}
export const createUcpaSession = (options = {}) => createProviderSession('ucpa', authenticateUcpa, { ...options, timeoutMs: options.timeoutMs ?? (options.manual ? 180000 : 120000) })

import { createProviderSession, ProviderAuthError } from './provider-session.js'

export const UCPA_ACCOUNT_URL = 'https://www.ucpa.com/sport-station/espacepersonnel/paris-19'
export const UCPA_IDENTITY_URL = 'https://www.ucpa.com/sport-station/espacepersonnel/api/paris-19/user'

export const readUcpaIdentity = async (context, timeoutMs = 20000) => {
  const response = await context.request.get(UCPA_IDENTITY_URL, { maxRedirects: 0, timeout: timeoutMs })
  if ([301, 302, 303, 307, 308, 401, 403].includes(response.status())) return null
  if (!response.ok()) throw new ProviderAuthError('ucpa', 'identity_unavailable', `identity check HTTP ${response.status()}`)
  let body
  try { body = await response.json() } catch { throw new ProviderAuthError('ucpa', 'identity_unverified', 'unexpected identity response') }
  if (body?.success !== true || typeof body.data?.email !== 'string') throw new ProviderAuthError('ucpa', 'identity_unverified', 'server did not confirm an authenticated identity')
  return { email: body.data.email }
}

export const authenticateUcpa = async (page, account, { checkOnly, manual, timeoutMs }) => {
  const existing = await readUcpaIdentity(page.context(), Math.min(timeoutMs, 20000))
  if (existing) return existing
  if (checkOnly) throw new ProviderAuthError('ucpa', 'login_required', 'saved session expired; a new login is required')
  await page.goto(UCPA_ACCOUNT_URL, { waitUntil: 'domcontentloaded' })
  await page.waitForURL(url => url.origin === 'https://authent.ucpa.com' || (url.origin === 'https://www.ucpa.com' && url.pathname.endsWith('/accueil')))
  // A surviving SSO cookie may restore the portal session without credentials.
  if (new URL(page.url()).origin === 'https://authent.ucpa.com') {
    await page.locator('#email').waitFor({ state: 'visible' })
    let refused = false
    let challenge = false
    const observe = async response => {
      if (new URL(response.url()).origin !== 'https://cognito-idp.eu-west-1.amazonaws.com') return
      if (response.status() >= 400) refused = true
      try {
        const body = await response.json()
        if (['SMS_MFA', 'SOFTWARE_TOKEN_MFA', 'EMAIL_OTP', 'MFA_SETUP', 'NEW_PASSWORD_REQUIRED', 'SELECT_MFA_TYPE'].includes(body.ChallengeName)) challenge = true
      } catch { /* No private response body is logged. */ }
    }
    page.on('response', observe)
    try {
      if (!manual) {
        // Fill credentials only on the observed official identity-provider origin.
        if (new URL(page.url()).origin !== 'https://authent.ucpa.com') throw new ProviderAuthError('ucpa', 'unexpected_login_page', 'unexpected identity-provider origin')
        await page.locator('#email').fill(account.email)
        await page.locator('#password').fill(account.password)
        await page.getByRole('button', { name: 'Se connecter', exact: true }).click()
      }
      try {
        await page.waitForURL(url => url.origin === 'https://www.ucpa.com' && url.pathname.startsWith('/sport-station/espacepersonnel/paris-19/'), { timeout: timeoutMs })
      } catch {
        throw new ProviderAuthError('ucpa', refused ? 'login_refused' : challenge ? 'interaction_required' : 'login_unconfirmed', refused ? 'login refused; check credentials' : 'login incomplete; use --headed --manual to complete any interactive step')
      }
    } finally { page.removeListener('response', observe) }
  }
  const identity = await readUcpaIdentity(page.context(), Math.min(timeoutMs, 20000))
  if (!identity) throw new ProviderAuthError('ucpa', 'login_unconfirmed', 'portal session was not confirmed after login')
  return identity
}
export const createUcpaSession = options => createProviderSession('ucpa', authenticateUcpa, options)

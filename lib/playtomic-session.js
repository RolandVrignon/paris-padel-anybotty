import { createProviderSession, ProviderAuthError } from './provider-session.js'

const LOGIN_URL = 'https://app.playtomic.com/login'
const IDENTITY_URL = 'https://playtomic.com/api/me'

const readIdentity = async context => {
  const response = await context.request.get(IDENTITY_URL, { maxRedirects: 0, timeout: 20000 })
  if ([301, 302, 303, 307, 308, 401, 403].includes(response.status())) return null
  if (!response.ok()) throw new ProviderAuthError('playtomic', 'identity_unavailable', `identity check HTTP ${response.status()}`)
  const body = await response.json()
  if (typeof body?.user_id !== 'string' || !body.user_id) return null
  return { userId: body.user_id }
}

export const authenticatePlaytomic = async (page, account, { checkOnly, manual, timeoutMs }) => {
  const existing = await readIdentity(page.context())
  if (existing) return { ...existing, email: account.email }
  if (checkOnly) throw new ProviderAuthError('playtomic', 'login_required', 'saved session expired; a new login is required')
  await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: timeoutMs })
  if (!manual) {
    if (new URL(page.url()).origin !== 'https://app.playtomic.com') throw new ProviderAuthError('playtomic', 'unexpected_login_page', 'unexpected login origin')
    await page.locator('input[name="email"]').fill(account.email)
    await page.locator('input[name="password"]').fill(account.password)
    await page.getByRole('button', { name: 'Log in', exact: true }).click()
  }
  await page.waitForURL(url => url.origin === 'https://app.playtomic.com' && url.pathname !== '/login', { timeout: timeoutMs }).catch(() => {})
  const identity = await readIdentity(page.context())
  if (!identity) throw new ProviderAuthError('playtomic', manual ? 'interaction_required' : 'login_refused', manual ? 'complete the login in the visible browser' : 'login refused or additional authentication required; use --headed --manual')
  return { ...identity, email: account.email }
}

export const createPlaytomicSession = options => createProviderSession('playtomic', authenticatePlaytomic, options)

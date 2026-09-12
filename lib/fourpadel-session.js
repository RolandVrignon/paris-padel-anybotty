import { createProviderSession, ProviderAuthError } from './provider-session.js'

const calendarUrl = 'https://www.4padel.fr/reservations/slots?center=105'
const identityUrl = 'https://api-front.lefive.fr/splf/v1/users/me?qoodos_refund=false&appId=2'

export const authenticateFourPadel = async (page, account, { checkOnly, manual, timeoutMs }) => {
  let authorization
  const capture = request => {
    const url = new URL(request.url())
    if (url.origin === 'https://api2-front.lefive.fr' && url.pathname.startsWith('/bookingrules/')) authorization = request.headers().authorization || authorization
  }
  page.on('request', capture)
  try {
    await page.goto(calendarUrl, { waitUntil: 'domcontentloaded' })
    await page.locator('#email2:visible, .lf-booking-date').first().waitFor()
    if (await page.locator('#email2:visible').count()) {
      if (checkOnly) throw new ProviderAuthError('4padel', 'login_required', 'saved session expired; a new login is required')
      if (!manual) {
        if (new URL(page.url()).origin !== 'https://www.4padel.fr') throw new ProviderAuthError('4padel', 'unexpected_login_page', 'unexpected login origin')
        await page.locator('#email2:visible').fill(account.email)
        await page.locator('#password2:visible').fill(account.password)
        const response = page.waitForResponse(r => new URL(r.url()).origin === 'https://api2-front.lefive.fr' && new URL(r.url()).pathname === '/login/client')
        response.catch(() => {})
        await page.getByRole('button', { name: /^Je me connecte$/i }).filter({ visible: true }).click()
        if (!(await response).ok()) throw new ProviderAuthError('4padel', 'login_refused', 'login refused; check credentials or use manual login')
      }
    }
    await page.locator('.lf-booking-date').first().waitFor()
    if (!authorization || /^Bearer (null|undefined)$/.test(authorization)) throw new ProviderAuthError('4padel', 'login_required', 'authenticated calendar token unavailable')
    const response = await page.context().request.get(identityUrl, { headers: { authorization }, maxRedirects: 0, timeout: Math.min(timeoutMs, 20000) })
    if ([401, 403].includes(response.status())) throw new ProviderAuthError('4padel', 'login_required', 'server rejected the saved session')
    if (!response.ok()) throw new ProviderAuthError('4padel', 'identity_unavailable', `identity check HTTP ${response.status()}`)
    const user = await response.json()
    return { email: user.email }
  } finally { page.removeListener('request', capture) }
}
export const createFourPadelSession = options => createProviderSession('4padel', authenticateFourPadel, options)

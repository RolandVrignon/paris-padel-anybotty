import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { chromium } from 'playwright'
import { loadFixedConfig, repositoryDirectory } from './config.js'

export class ProviderAuthError extends Error {
  constructor(provider, code, message) { super(`${provider}: ${message}`); this.code = code; this.name = 'ProviderAuthError' }
}
export const identityMatches = (provider, actual, expected) => {
  if (typeof actual !== 'string' || !actual.trim()) throw new ProviderAuthError(provider, 'identity_unverified', 'server identity could not be verified')
  if (actual.trim().toLowerCase() !== expected.trim().toLowerCase()) throw new ProviderAuthError(provider, 'account_mismatch', 'session belongs to a different account')
}
export const providerScope = email => createHash('sha256').update(email.trim().toLowerCase()).digest('hex')
export const providerSessionFiles = (root, provider) => {
  if (!['ucpa', '4padel'].includes(provider)) throw new Error('Unsupported authentication provider')
  const directory = join(root, '.auth/providers')
  return { directory, state: join(directory, `${provider}-session.json`), meta: join(directory, `${provider}-session.meta.json`) }
}
export const savedProviderSession = (root, provider, email) => {
  const files = providerSessionFiles(root, provider)
  try {
    if (!existsSync(files.state) || JSON.parse(readFileSync(files.meta, 'utf8')).accountScope !== providerScope(email)) return null
    return JSON.parse(readFileSync(files.state, 'utf8'))
  } catch { return null }
}
export const saveProviderSession = async (context, root, provider, email) => {
  const files = providerSessionFiles(root, provider)
  mkdirSync(files.directory, { recursive: true, mode: 0o700 })
  chmodSync(files.directory, 0o700)
  const write = (path, data) => {
    const temp = `${path}.${process.pid}.${randomUUID()}.tmp`
    writeFileSync(temp, JSON.stringify(data), { mode: 0o600, flag: 'wx' })
    renameSync(temp, path)
  }
  write(files.state, await context.storageState({ indexedDB: true }))
  write(files.meta, { accountScope: providerScope(email), verifiedAt: new Date().toISOString() })
}

export const createProviderSession = async (provider, authenticate, {
  root = repositoryDirectory, headed = false, signal, checkOnly = false, manual = false, fresh = false,
  timeoutMs = manual ? 180000 : 60000,
} = {}) => {
  if (manual && !headed) throw new ProviderAuthError(provider, 'invalid_options', 'manual login requires --headed')
  if (checkOnly && (manual || fresh)) throw new ProviderAuthError(provider, 'invalid_options', '--check cannot be combined with --manual or --fresh')
  const account = loadFixedConfig({ root }).providers?.[provider]?.account
  if (!account?.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(account.email) || (!checkOnly && !manual && !account.password)) throw new ProviderAuthError(provider, 'configuration_required', `set providers.${provider}.account in config.fixed.json`)
  const stored = fresh ? null : savedProviderSession(root, provider, account.email)
  if (checkOnly && !stored) throw new ProviderAuthError(provider, 'login_required', 'no saved session for this account; run login first')
  let browser
  const stop = () => { void browser?.close().catch(() => {}) }
  const close = async () => { signal?.removeEventListener('abort', stop); await browser?.close() }
  try {
    if (signal?.aborted) throw new ProviderAuthError(provider, 'aborted', 'authentication interrupted')
    browser = await chromium.launch({ headless: !headed })
    signal?.addEventListener('abort', stop, { once: true })
    if (signal?.aborted) throw new ProviderAuthError(provider, 'aborted', 'authentication interrupted')
    const context = await browser.newContext({ ...(stored ? { storageState: stored } : {}), timezoneId: 'Europe/Paris' })
    const page = await context.newPage()
    page.setDefaultTimeout(timeoutMs)
    const result = await authenticate(page, account, { checkOnly, manual, timeoutMs })
    identityMatches(provider, result.email, account.email)
    if (!checkOnly) await saveProviderSession(context, root, provider, account.email)
    await page.close()
    return { context, provider, accountScope: providerScope(account.email), authenticated: true, sessionSaved: !checkOnly, close }
  } catch (error) {
    await close()
    if (error instanceof ProviderAuthError) throw error
    // Omit browser call logs, which can contain credentials and session tokens.
    throw new ProviderAuthError(provider, signal?.aborted ? 'aborted' : 'authentication_unavailable', 'authentication could not be verified; inspect with --headed or --headed --manual')
  }
}

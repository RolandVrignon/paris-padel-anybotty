import { validateDurations } from './duration-preferences.js'
import { validateCourtEnvironment } from './court-environment.js'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const repositoryDirectory = fileURLToPath(new URL('..', import.meta.url))
export const REQUEST_KEYS = ['date', 'startTime', 'durationsMinutes', 'clubs', 'maxTotalPriceEUR', 'courtEnvironment']
export const FIXED_KEYS = ['account', 'browser']
export const readConfig = path => {
  let text
  try { text = readFileSync(path, 'utf8') } catch { throw new Error(`Cannot read configuration: ${path}`) }
  try { return JSON.parse(text) } catch { throw new Error(`Invalid JSON configuration: ${path}`) }
}
const object = (value, label) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`)
}
const checkKeys = (value, allowed, label) => {
  object(value, label)
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new Error(`Unsupported fields in ${label}`)
}
export const splitLegacy = config => {
  checkKeys(config, [...FIXED_KEYS, ...REQUEST_KEYS], 'legacy configuration')
  return {
    fixed: Object.fromEntries(Object.entries(config).filter(([key]) => FIXED_KEYS.includes(key))),
    request: Object.fromEntries(Object.entries(config).filter(([key]) => REQUEST_KEYS.includes(key))),
  }
}
export const loadRequestConfig = ({ root = repositoryDirectory, env = process.env, path } = {}) => {
  const selected = path || env.ANYBOTTY_REQUEST_CONFIG_PATH
  let request
  if (selected) request = readConfig(resolve(selected))
  else if (existsSync(resolve(root, 'config.request.json'))) request = readConfig(resolve(root, 'config.request.json'))
  else request = splitLegacy(readConfig(resolve(root, 'config.json'))).request
  checkKeys(request, REQUEST_KEYS, 'request configuration')
  if (request.courtEnvironment !== undefined) request.courtEnvironment = validateCourtEnvironment(request.courtEnvironment)
  if (request.durationsMinutes !== undefined) validateDurations(request.durationsMinutes)
  return request
}
export const loadFixedConfig = ({ root = repositoryDirectory, env = process.env } = {}) => {
  const selected = env.ANYBOTTY_FIXED_CONFIG_PATH
  let fixed
  if (selected) fixed = readConfig(resolve(selected))
  else if (existsSync(resolve(root, 'config.fixed.json'))) fixed = readConfig(resolve(root, 'config.fixed.json'))
  else fixed = splitLegacy(readConfig(resolve(root, 'config.json'))).fixed
  checkKeys(fixed, FIXED_KEYS, 'fixed configuration')
  if (fixed.account) checkKeys(fixed.account, ['email', 'password'], 'account')
  if (fixed.browser) {
    checkKeys(fixed.browser, ['headed', 'timeoutMs'], 'browser')
    if (fixed.browser.headed != null && typeof fixed.browser.headed !== 'boolean') throw new Error('browser.headed must be boolean')
    if (fixed.browser.timeoutMs != null && (!Number.isInteger(fixed.browser.timeoutMs) || fixed.browser.timeoutMs < 1000 || fixed.browser.timeoutMs > 300000)) throw new Error('browser.timeoutMs must be between 1000 and 300000')
  }
  return { ...fixed, browser: { headed: true, timeoutMs: 60000, ...fixed.browser } }
}
export const validateAccount = (config, { requirePassword = true } = {}) => {
  if (typeof config.account?.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(config.account.email)) throw new Error('Set account.email in config.fixed.json')
  if (requirePassword && (typeof config.account.password !== 'string' || !config.account.password)) throw new Error('Set account.password in config.fixed.json')
}

// The explicit preview arguments need no request file; an existing file supplies defaults.
export const resolveCourtEnvironment = (override, { root = repositoryDirectory, env = process.env } = {}) => {
  if (override !== undefined) return validateCourtEnvironment(override)
  const configured = env.ANYBOTTY_REQUEST_CONFIG_PATH || existsSync(resolve(root, 'config.request.json')) || existsSync(resolve(root, 'config.json'))
  return validateCourtEnvironment(configured ? loadRequestConfig({ root, env }).courtEnvironment : undefined)
}

export const resolveDurationsMinutes = (override, { root = repositoryDirectory, env = process.env } = {}) => {
  if (override !== undefined) return validateDurations(override)
  const configured = env.ANYBOTTY_REQUEST_CONFIG_PATH || existsSync(resolve(root, 'config.request.json')) || existsSync(resolve(root, 'config.json'))
  const durations = configured ? loadRequestConfig({ root, env }).durationsMinutes : undefined
  return validateDurations(durations === undefined ? [60, 90] : durations)
}

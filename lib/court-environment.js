export const COURT_ENVIRONMENTS = ['any', 'indoor', 'outdoor']
export const ENVIRONMENT_LABELS = { indoor: 'Intérieur', outdoor: 'Extérieur' }

export const checkoutCourtLocator = sheet => sheet.locator('p.font-bold:has(+ p.opacity-70), p.font-bold.text-sm.leading-tight')
const selectedEnvironments = new WeakMap()
export const clearCourtEnvironmentEvidence = page => selectedEnvironments.delete(page)
export const rememberCourtEnvironment = (page, court, environment) => {
  if (court && Object.hasOwn(ENVIRONMENT_LABELS, environment)) selectedEnvironments.set(page, { court, environment })
}

const LEGACY_PREFERENCES = {
  any: ['any'],
  indoor: ['indoor'],
  outdoor: ['outdoor'],
  indoor_preferred: ['indoor', 'outdoor'],
  outdoor_preferred: ['outdoor', 'indoor'],
}

export const validateCourtEnvironment = (value = ['any']) => {
  const preferences = typeof value === 'string' && Object.hasOwn(LEGACY_PREFERENCES, value) ? LEGACY_PREFERENCES[value] : value
  if (!Array.isArray(preferences) || !preferences.length || preferences.some(item => !COURT_ENVIRONMENTS.includes(item)) || new Set(preferences).size !== preferences.length || (preferences.includes('any') && preferences.length !== 1)) {
    throw new Error('courtEnvironment must be an ordered list of indoor/outdoor, or ["any"] alone, without duplicates')
  }
  return [...preferences]
}

export const parseCourtEnvironmentArgument = value => {
  if (typeof value !== 'string') throw new Error('Invalid --court-environment argument')
  return validateCourtEnvironment(value.includes(',') ? value.split(',').map(item => item.trim()) : value.trim())
}

// null means no filtering/ranking; other values define strict allowed preference order.
export const getCourtEnvironmentOrder = value => {
  const preferences = validateCourtEnvironment(value)
  return preferences[0] === 'any' ? null : preferences
}

// Read only the selected court's feature line, never the club's descriptive text.
// Observed markup: a bold court-name paragraph followed by the opacity-70 features.
export const assertCheckoutEnvironment = async (sheet, requested = ['any'], expectedEnvironment = null) => {
  const allowed = getCourtEnvironmentOrder(requested)
  if (expectedEnvironment !== null && (!Object.hasOwn(ENVIRONMENT_LABELS, expectedEnvironment) || (allowed && !allowed.includes(expectedEnvironment)))) throw new Error('Invalid selected court environment')
  if (allowed === null && expectedEnvironment === null) return
  const features = sheet.locator('p.font-bold + p.opacity-70')
  // The current checkout omits court features. Reuse only this page's modal
  // evidence, bound to the exact court still displayed in the final recap.
  if (!await features.count()) {
    const evidence = selectedEnvironments.get(sheet.page())
    const court = checkoutCourtLocator(sheet)
    if (evidence && expectedEnvironment === evidence.environment && await court.count() === 1 && await court.isVisible() && (await court.innerText()).trim() === evidence.court) return
  }
  try { await features.waitFor({ timeout: 5000 }) } catch {
    throw new Error('Selected court environment is missing or ambiguous; cannot verify the requested type')
  }
  const tokens = (await features.innerText()).split(/\s*[,·]\s*/).map(text => text.trim())
  const detected = Object.entries(ENVIRONMENT_LABELS).filter(([, label]) => tokens.includes(label)).map(([value]) => value)
  if (detected.length !== 1 || (allowed && !allowed.includes(detected[0])) || (expectedEnvironment !== null && detected[0] !== expectedEnvironment)) throw new Error(`Selected court does not match courtEnvironment=${requested}`)
}

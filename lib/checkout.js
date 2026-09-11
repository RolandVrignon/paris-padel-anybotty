import { assertCheckoutDuration } from './duration-preferences.js'
import { assertCheckoutEnvironment } from './court-environment.js'
import { readFileSync } from 'node:fs'

export const TERMS_LABEL = 'J\'accepte les Conditions Générales de Vente et les conditions du club'
export const MARKETING_OPT_OUT_LABEL = 'Je ne souhaite pas recevoir ces emails.'
export const STRIPE_FRAME = 'iframe[title="Cadre de saisie sécurisé pour le paiement"]'
const profiles = () => JSON.parse(readFileSync(new URL('../data/checkout-requirements.json', import.meta.url), 'utf8')).clubs

export const isPaymentConfirmation = (rawURL, method) => {
  const url = new URL(rawURL)
  return !['GET', 'HEAD', 'OPTIONS'].includes(method) &&
    (url.hostname === 'stripe.com' || url.hostname.endsWith('.stripe.com')) &&
    /\/(?:payment_intents|setup_intents)\/[^/]+\/confirm(?:\/|$)|\/charges(?:\/|$)|\/payment_pages\/[^/]+\/confirm(?:\/|$)/.test(url.pathname)
}

// Defence in depth only: the workflow itself never clicks the final Pay button.
export const installPaymentGuard = async context => {
  await context.route('**/*', route => isPaymentConfirmation(route.request().url(), route.request().method())
    ? route.abort('blockedbyclient') : route.continue())
}

export const inspectCheckout = async (page, clubId) => {
  const profile = profiles().find(club => club.clubId === clubId)
  if (!profile) throw new Error('Club checkout has not been audited')
  const sheet = page.getByTestId('booking-sheet')
  if (await sheet.getByText('Entrez vos informations de paiement', { exact: true }).isVisible()) throw new Error('Already at payment: refusing to click Pay again')
  await sheet.getByText('Confirmer et Payer', { exact: true }).waitFor()
  await sheet.getByRole('button', { name: /^Payer / }).waitFor()
  await sheet.filter({ hasText: /Total à payer\s*[\d\s,.]+€/ }).waitFor()
  const checkboxes = await sheet.getByRole('checkbox').evaluateAll(elements => elements.map(element => ({
    label: element.closest('label')?.textContent.trim() || element.getAttribute('aria-label') || '',
    checked: element.getAttribute('aria-checked') === 'true' || element.checked === true,
  })))
  const requiredLabels = profile.requiredLabels
  const allowed = new Set([...requiredLabels, MARKETING_OPT_OUT_LABEL])
  if (checkboxes.some(box => !allowed.has(box.label)) || requiredLabels.some(label => checkboxes.filter(box => box.label === label).length !== 1)) throw new Error('Checkout conditions changed; inspect the visible browser before continuing')
  const summary = await sheet.innerText()
  if (!summary.includes(profile.name)) throw new Error('Checkout club does not match the requested club')
  return { sheet, requiredLabels, checkboxes, summary }
}

// Call only after the caller has verified the selected date, court, duration and price.
// This starts a server-side cart/payment session, so it is not a read-only dry run.
export const prepareStripeCheckout = async (page, clubId, { courtEnvironment = ['any'], expectedEnvironment = null, durationsMinutes, expectedDuration = null } = {}) => {
  const { sheet, requiredLabels, summary } = await inspectCheckout(page, clubId)
  if (durationsMinutes !== undefined) await assertCheckoutDuration(sheet, durationsMinutes, expectedDuration)
  await assertCheckoutEnvironment(sheet, courtEnvironment, expectedEnvironment)
  for (const label of requiredLabels) await sheet.getByRole('checkbox', { name: label, exact: true }).check()
  await sheet.getByText('Confirmer et Payer', { exact: true }).waitFor()
  await sheet.getByRole('button', { name: /^Payer / }).click()
  // Never retry this click: the next stage has a second button with the same name.
  await sheet.getByText('Entrez vos informations de paiement', { exact: true }).waitFor({ timeout: 45000 })
  await sheet.locator(STRIPE_FRAME).waitFor({ timeout: 30000 })
  const host = await sheet.locator(STRIPE_FRAME).getAttribute('src').then(src => new URL(src).hostname)
  if (host !== 'js.stripe.com') throw new Error('Unexpected payment frame host')
  const frame = sheet.frameLocator(STRIPE_FRAME)
  await frame.getByText('Numéro de carte', { exact: true }).or(frame.getByRole('button', { name: 'Carte bancaire', exact: true })).waitFor({ timeout: 30000 })
  return { clubId, stage: 'stripe_form', paymentSubmitted: false, summary }
}

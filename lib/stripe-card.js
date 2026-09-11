import { setTimeout as pause } from 'node:timers/promises'
import { installPaymentGuard } from './checkout.js'

export const CARD_SELECTORS = {
  cardNumber: 'input[autocomplete="cc-number"]',
  expiry: 'input[autocomplete="cc-exp"]',
  cvc: 'input[autocomplete="cc-csc"]',
  cardholderName: 'input[autocomplete="cc-name"]',
  billingCountry: 'select[autocomplete="billing country"]',
  billingPostalCode: 'input[autocomplete="billing postal-code"]',
}

const belongsToCheckout = async frame => {
  for (let current = frame; current.parentFrame(); current = current.parentFrame()) {
    const element = await current.frameElement()
    if (await element.evaluate(node => Boolean(node.closest('[data-testid="booking-sheet"]')))) return true
  }
  return false
}

// Stripe also mounts telemetry and wallet frames. Identify the actual visible
// card form by its semantic field and checkout ancestry, never its frame index.
export const findStripeCardFrame = async (page, { timeoutMs = 30000, onDetected = () => {} } = {}) => {
  const deadline = Date.now() + timeoutMs
  let cardTabClicked = false
  const methods = new Set()
  do {
    const candidates = []
    for (const frame of page.frames()) {
      try {
        if (new URL(frame.url()).origin !== 'https://js.stripe.com' || !await belongsToCheckout(frame)) continue
        for (const label of ['Carte bancaire', 'Revolut Pay', 'Satispay', 'PayPal', 'Klarna', 'Apple Pay', 'Google Pay']) {
          if (await frame.getByRole('button', { name: label, exact: true }).isVisible()) methods.add(label)
        }
        const number = frame.locator(CARD_SELECTORS.cardNumber)
        if (await number.count() === 1 && await number.isVisible()) candidates.push(frame)
        else if (!cardTabClicked) {
          const tab = frame.getByRole('button', { name: 'Carte bancaire', exact: true })
          if (await tab.count() === 1 && await tab.isVisible()) { cardTabClicked = true; await tab.evaluate(element => element.click()) }
        }
      } catch { /* A loading frame can detach before it is ready. No card data yet. */ }
    }
    if (candidates.length > 1) throw new Error('Multiple Stripe card forms; refusing ambiguous input')
    if (candidates.length === 1) {
      onDetected({ route: cardTabClicked ? 'select_card' : 'direct_card', observedMethodButtons: [...methods] })
      return candidates[0]
    }
    await pause(200)
  } while (Date.now() < deadline)
  throw new Error('Visible Stripe card form unavailable in checkout')
}

export const validateCardConfig = payment => {
  const number = typeof payment?.cardNumber === 'string' ? payment.cardNumber.replace(/\s/g, '') : ''
  if (!/^\d{12,19}$/.test(number) || !/^(0[1-9]|1[0-2])$/.test(payment?.expiryMonth || '') || !/^20\d{2}$/.test(payment?.expiryYear || '') || !/^\d{3,4}$/.test(payment?.cvc || '')) throw new Error('Complete payment card fields in the private config (number, MM, YYYY, CVC); values are never logged')
  if (payment.billingCountry && !/^[A-Z]{2}$/.test(payment.billingCountry)) throw new Error('payment.billingCountry must use a two-letter country code')
  return { ...payment, cardNumber: number, expiry: `${payment.expiryMonth}${payment.expiryYear.slice(-2)}` }
}

export const fillStripeCard = async (page, payment) => {
  const card = validateCardConfig(payment)
  await installPaymentGuard(page.context())
  try {
    const frame = await findStripeCardFrame(page)
    const filledFields = []
    const absentFields = []
    const fill = async (key, value, required = true) => {
      const field = frame.locator(CARD_SELECTORS[key])
      if (!required && (!await field.count() || !await field.isVisible())) { absentFields.push(key); return }
      await field.waitFor({ state: 'visible' })
      if (key === 'billingCountry') await field.selectOption(value)
      else await field.fill(value)
      const actual = await field.inputValue()
      const same = ['cardNumber', 'expiry'].includes(key) ? actual.replace(/\D/g, '') === value : actual === value
      if (!same || await field.getAttribute('aria-invalid') === 'true') throw new Error('Card field not accepted')
      filledFields.push(key)
    }
    for (const key of ['cardNumber', 'expiry', 'cvc']) await fill(key, card[key])
    if (card.billingCountry) await fill('billingCountry', card.billingCountry, false)
    for (const key of ['cardholderName', 'billingPostalCode']) if (card[key]) await fill(key, card[key], false)
    return { stage: 'stripe_card_filled', filledFields, absentFields, paymentSubmitted: false, reservationConfirmed: false }
  } catch {
    // Playwright fill errors can contain the entire value. Never propagate them.
    throw new Error('Stripe card entry could not be verified; no final payment was requested. Inspect the visible browser; card values were not logged.')
  }
}

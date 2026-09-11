import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as pause } from 'node:timers/promises'
import { checkoutPrice, parseEURCents } from './booking-price.js'
import { installPaymentGuard, prepareStripeCheckout } from './checkout.js'
import { fillStripeCard, findStripeCardFrame, CARD_SELECTORS } from './stripe-card.js'
import { assertCheckoutDuration } from './duration-preferences.js'
import { assertCheckoutEnvironment } from './court-environment.js'

export const paymentStore = (directory, account, request) => {
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  // Same match time across alternative clubs/preferences is one purchase intent.
  const key = createHash('sha256').update(JSON.stringify([account.toLowerCase(), request.date, request.startTime])).digest('hex')
  const path = join(directory, `${key}.json`)
  return {
    read: () => existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null,
    save: value => {
      const temporary = `${path}.tmp`
      writeFileSync(temporary, JSON.stringify({ ...value, updatedAt: new Date().toISOString() }, null, 2), { mode: 0o600 })
      renameSync(temporary, path)
    },
    archiveForRetry: expected => {
      // The caller holds the same lock as booking-search. Never discard history.
      if (JSON.stringify(JSON.parse(readFileSync(path, 'utf8'))) !== JSON.stringify(expected)) throw new Error('Payment journal changed before reset')
      const archiveDirectory = join(directory, 'archive', key)
      mkdirSync(archiveDirectory, { recursive: true, mode: 0o700 })
      const archiveId = randomUUID()
      writeFileSync(join(archiveDirectory, `${archiveId}-decision.json`), JSON.stringify({
        action: 'manual_retry_authorized', duplicateRiskAccepted: true,
        previousPaymentCancelled: false, createdAt: new Date().toISOString(),
      }, null, 2), { mode: 0o600, flag: 'wx' })
      renameSync(path, join(archiveDirectory, `${archiveId}-journal.json`))
      return archiveId
    },
  }
}

export const sameMatchTime = (row, request) => row.dateTime === `${request.date}T${request.startTime}` && row.category !== 'cancelled' && row.hasOwnReservation
export const matchesPaidOffer = (row, offer) => sameMatchTime(row, offer) && row.club === offer.clubName && row.durationMinutes === offer.durationMinutes && row.court === offer.court
export const confirmedPaymentResult = (reservation, paymentSubmitted = true) => ({ status: 'booked', stage: 'booked', reservation, paymentSubmitted, reservationConfirmed: true })

export const resetPaymentForRetry = async ({ store, request, readReservations, acceptDuplicateRisk = false }) => {
  if (!acceptDuplicateRisk) throw new Error('Manual reset requires explicit acceptance of duplicate-payment risk')
  const journal = store.read()
  if (!journal) return { status: 'no_payment_to_reset', paymentSubmitted: false }
  if (journal.reservationConfirmed || journal.status === 'booked' || ['succeeded', 'processing', 'requires_capture'].includes(journal.stripeStatus)) throw new Error('Payment is confirmed or processing; reconcile it before resetting')
  const rows = await readReservations()
  if (rows.some(row => sameMatchTime(row, request))) throw new Error('An active or pending reservation already exists at this time; reset refused')
  const archiveId = store.archiveForRetry(journal)
  return { status: 'payment_reset', archiveId, previousStatus: journal.status, previousPaymentCancelled: false, duplicateRiskAccepted: true, paymentSubmitted: false }
}

// Read-only reconciliation. A missing reservation never makes a submitted intent retryable.
export const reconcilePayment = async (journal, readReservations) => {
  const rows = await readReservations()
  const matches = rows.filter(row => matchesPaidOffer(row, journal.offer) && !journal.baselineIds.includes(row.id))
  if (!journal.amountMismatch && matches.length === 1 && matches[0].reservationConfirmed) return confirmedPaymentResult(matches[0])
  return { status: journal.status === 'payment_failed' ? 'payment_failed' : journal.status === 'payment_action_required' ? 'payment_action_required' : 'payment_unverified', stage: 'payment', paymentSubmitted: true, reservationConfirmed: false, stripeStatus: journal.stripeStatus ?? null, authentication: journal.authentication ?? null, stripeStatusSource: 'last_observation_not_refreshed', ...(matches.length === 1 ? { reservation: matches[0] } : {}) }
}

export const verifyPaymentSummary = async (page, offer, request) => {
  const sheet = page.getByTestId('booking-sheet')
  const summary = await sheet.innerText()
  const dateLabel = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris' }).format(new Date(`${offer.date}T12:00:00Z`))
  if (!summary.includes(offer.clubName) || !summary.includes(dateLabel) || !summary.includes(`${offer.startTime} (${offer.durationMinutes} min)`) || !offer.court || !summary.split('\n').includes(offer.court)) throw new Error('Final checkout identity changed')
  await assertCheckoutDuration(sheet, request.durationsMinutes, offer.durationMinutes)
  await assertCheckoutEnvironment(sheet, request.courtEnvironment, offer.environment)
  const price = checkoutPrice(summary, offer.durationMinutes, request.maxPricePerHourEUR)
  if (price.totalCents !== offer.totalCents) throw new Error('Final checkout amount changed')
}

export const inspectFinalPayment = async (page, offer, request, expectedURL = page.url()) => {
  if (page.url() !== expectedURL) throw new Error('Payment page changed after checkout verification')
  const sheet = page.getByTestId('booking-sheet')
  await sheet.getByText('Entrez vos informations de paiement', { exact: true }).waitFor()
  // The real Stripe step hides club/court/date/total. Those are checked just
  // before prepareStripeCheckout; the final amount is now on the Pay button.
  const button = sheet.getByRole('button', { name: /^Payer\s+[\d\s,.]+\s*€$/ })
  if (await button.count() !== 1) throw new Error('Ambiguous final payment button')
  await button.waitFor({ state: 'visible' })
  await button.and(sheet.locator('button:enabled')).waitFor({ state: 'visible' })
  const label = await button.innerText()
  const amountText = label.replace(/^Payer\s+/, '').replace(/\s*€$/, '')
  if (parseEURCents(amountText) !== offer.totalCents || !await button.isEnabled()) throw new Error('Final payment button amount changed or disabled')
  checkoutPrice(`Total à payer ${amountText} €`, offer.durationMinutes, request.maxPricePerHourEUR)
  const frame = await findStripeCardFrame(page)
  for (const selector of [CARD_SELECTORS.cardNumber, CARD_SELECTORS.expiry, CARD_SELECTORS.cvc]) {
    const field = frame.locator(selector)
    if (!await field.isVisible() || !await field.inputValue() || await field.getAttribute('aria-invalid') === 'true') throw new Error('Card form is no longer ready')
  }
  return button
}

export const clickFinalPayment = async (button, totalCents) => {
  // The actual UCPA test exposed a layout shift towards Revolut Pay during a
  // coordinate click. Invoke only this verified DOM button, once, with no retry.
  await button.evaluate((element, expected) => {
    const label = element.textContent.replace(/\s/g, '')
    const match = /^Payer(\d+(?:[,.]\d{1,2})?)€$/.exec(label)
    if (element.tagName !== 'BUTTON' || element.disabled || !element.getClientRects().length || !match || Math.round(Number(match[1].replace(',', '.')) * 100) !== expected) throw new Error('Final payment button changed')
    element.click()
  }, totalCents)
}

export const payBookingOffer = async (page, offer, request, { payment, store, readReservations, headed = false, timeoutMs = headed ? 180000 : 60000, pollMs = 2000, verifySummary = verifyPaymentSummary, prepare = prepareStripeCheckout, fill = fillStripeCard, inspect = inspectFinalPayment, click = clickFinalPayment, onEvent = () => {} }) => {
  if (store.read()) return reconcilePayment(store.read(), readReservations)
  const before = await readReservations()
  const existing = before.filter(row => sameMatchTime(row, request))
  if (existing.length) return { status: 'existing_reservation', stage: 'existing_reservation', reservation: existing[0], paymentSubmitted: false, reservationConfirmed: existing[0].reservationConfirmed }
  await verifySummary(page, offer, request)
  const checkoutURL = page.url()
  await prepare(page, offer.clubId, { ...request, expectedDuration: offer.durationMinutes, expectedEnvironment: offer.environment })
  await fill(page, payment)
  const button = await inspect(page, offer, request, checkoutURL)
  // Recheck account/session and duplicates immediately before committing money.
  const baseline = await readReservations()
  if (baseline.some(row => sameMatchTime(row, request))) return { status: 'existing_reservation', stage: 'existing_reservation', paymentSubmitted: false, reservationConfirmed: false }
  const guard = await installPaymentGuard(page.context())
  let stripeStatus = null
  let nextActionType = null
  let sdkActionType = null
  let mismatch = false
  const listener = async response => {
    if (!guard.matches(response.url())) return
    try {
      const data = await response.json()
      const intent = data.error?.payment_intent || data
      if (intent.amount !== undefined && (intent.amount !== offer.totalCents || intent.currency !== 'eur')) mismatch = true
      if (['requires_action', 'requires_payment_method', 'requires_capture', 'succeeded', 'processing', 'canceled'].includes(intent.status)) stripeStatus = intent.status
      if (intent.next_action) {
        nextActionType = ['use_stripe_sdk', 'redirect_to_url'].includes(intent.next_action.type) ? intent.next_action.type : 'unknown'
        const type = intent.next_action.use_stripe_sdk?.type
        sdkActionType = type ? ['three_d_secure_2_fingerprint', 'three_d_secure_redirect'].includes(type) ? type : 'unknown' : null
      }
    } catch { /* No raw Stripe payloads or errors are logged. */ }
  }
  page.context().on('response', listener)
  const journal = { status: 'payment_started', offer, baselineIds: baseline.map(row => row.id), startedAt: new Date().toISOString() }
  let started = false
  try {
    store.save(journal)
    started = true
    guard.arm()
    try { await click(button, offer.totalCents) } catch { /* An interrupted click may already have submitted. Reconcile only. */ }
    const deadline = Date.now() + timeoutMs
    let last = { status: 'payment_unverified', stage: 'payment', paymentSubmitted: true, reservationConfirmed: false }
    let actionReported = false
    const authentication = () => ({ nextActionType, sdkActionType, notificationSent: null, browserMode: headed ? 'headed' : 'headless' })
    do {
      try { last = await reconcilePayment(journal, readReservations) } catch { /* Retain uncertainty and never move to another club. */ }
      if (!mismatch && last.reservationConfirmed) {
        const confirmed = { ...last, stripeStatus, ...(actionReported ? { authentication: { ...authentication(), waitExpired: false } } : {}) }
        store.save({ ...journal, ...confirmed })
        return { ...offer, ...confirmed }
      }
      if (stripeStatus === 'requires_action' && !actionReported) {
        actionReported = true
        store.save({ ...journal, status: 'payment_action_required', stripeStatus, authentication: authentication() })
        onEvent({ status: 'payment_action_required', authentication: authentication(), message: 'Stripe demande une action supplémentaire ; navigateur maintenu ouvert pendant la vérification. Aucune notification bancaire confirmée.' })
      }
      // requires_action can be an intermediate SDK fingerprinting step. Closing
      // headless Chromium here interrupts 3DS before a challenge can even load.
      if (mismatch || ['requires_payment_method', 'canceled'].includes(stripeStatus)) break
      await pause(pollMs)
    } while (Date.now() < deadline)
    const status = mismatch ? 'payment_unverified' : stripeStatus === 'requires_action' ? 'payment_action_required' : ['requires_payment_method', 'canceled'].includes(stripeStatus) ? 'payment_failed' : 'payment_unverified'
    const result = { ...offer, status, stage: 'payment', stripeStatus, ...(actionReported ? { authentication: { ...authentication(), waitExpired: Date.now() >= deadline } } : {}), paymentSubmitted: true, reservationConfirmed: false }
    store.save({ ...journal, ...result, amountMismatch: mismatch })
    return result
  } catch {
    if (!started) throw new Error('Payment journal could not be saved; no payment click requested')
    return { ...offer, status: 'payment_unverified', stage: 'payment', paymentSubmitted: true, reservationConfirmed: false }
  } finally {
    guard.disarm()
    page.context().off('response', listener)
  }
}

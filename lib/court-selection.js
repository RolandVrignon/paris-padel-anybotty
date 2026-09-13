import { ENVIRONMENT_LABELS, getCourtEnvironmentOrder, clearCourtEnvironmentEvidence, rememberCourtEnvironment } from './court-environment.js'
import { assertCheckoutDuration, validateDurations } from './duration-preferences.js'

export const offerKey = offer => JSON.stringify([offer.durationMinutes, offer.court ?? null])
export class NoMatchingOfferError extends Error {
  constructor(message = 'No available court matches the requested preferences') {
    super(message)
    this.code = 'NO_MATCHING_OFFER'
  }
}

// A club may show either path, depending on the offers left for this starting time.
export const selectCourtIfOffered = async (page, { durationMinutes, durationsMinutes, court = null, courtEnvironment = ['any'], excludedOffers = [], onSelected = () => {} }) => {
  clearCourtEnvironmentEvidence(page)
  if (durationMinutes !== undefined && durationsMinutes !== undefined) throw new Error('Use durationMinutes or durationsMinutes, not both')
  const durations = validateDurations(durationsMinutes ?? [durationMinutes])
  const environmentOrder = getCourtEnvironmentOrder(courtEnvironment)
  const sheet = page.getByTestId('booking-sheet')
  const confirmation = page.getByTestId('slot-selection-confirm')
  await sheet.or(confirmation).waitFor()
  if (await sheet.isVisible()) {
    let duration
    try { duration = await assertCheckoutDuration(sheet, durations) } catch (error) {
      if (error.code === 'DURATION_MISMATCH') throw new NoMatchingOfferError('Direct checkout duration is excluded or unavailable')
      throw error
    }
    const selected = { usedModal: false, court, durationMinutes: duration }
    if (excludedOffers.includes(offerKey(selected))) throw new NoMatchingOfferError('Direct checkout offer was already rejected')
    onSelected(selected)
    return selected
  }

  const modal = page.getByRole('dialog').filter({ has: confirmation })
  // Preference order: duration, environment, then the site's court display order.
  for (const duration of durations) {
    const durationControl = modal.getByRole('button', { name: new RegExp(`^${duration}\\s*min`) })
    const durationControls = await durationControl.count()
    if (durationControls > 1) throw new Error('Ambiguous duration controls')
    const renderedOptions = modal.getByTestId('slot-court-option')
      .filter({ has: page.getByText(new RegExp(`^${duration}\\s*min$`)) })
    if (durationControls === 1) {
      if (!await durationControl.isEnabled()) {
        if (durations.length === 1) throw new NoMatchingOfferError('Requested duration is unavailable')
        continue
      }
      await durationControl.click()
      // An enabled duration advertises offers. Wait for its cards before deciding.
      await renderedOptions.first().waitFor({ state: 'attached' })
    }
    const options = renderedOptions.and(modal.locator('button:enabled:not([aria-disabled="true"]):visible'))
    const eligible = court ? options.filter({ has: page.getByText(court, { exact: true }) }) : options
    if (!await eligible.count()) continue
    for (const environment of environmentOrder || [null]) {
      const matching = environment === null ? eligible : eligible.filter({
        has: page.getByText(ENVIRONMENT_LABELS[environment], { exact: true }),
        hasNot: page.getByText(ENVIRONMENT_LABELS[environment === 'indoor' ? 'outdoor' : 'indoor'], { exact: true }),
      })
      for (const chosen of await matching.all()) {
        const selectedCourt = (await chosen.locator('p').first().innerText()).trim()
        if (!selectedCourt) throw new Error('Cannot identify the selected court')
        const selected = { usedModal: true, court: selectedCourt, durationMinutes: duration, ...(environment ? { environment } : {}) }
        if (excludedOffers.includes(offerKey(selected))) continue
        onSelected(selected)
        await chosen.click()
        await modal.getByTestId('slot-selection-confirm').click()
        await sheet.waitFor()
        rememberCourtEnvironment(page, selectedCourt, environment)
        return selected
      }
    }
  }
  throw new NoMatchingOfferError(`No available court matches courtEnvironment=${courtEnvironment}, durationsMinutes=${durations.join(',')} and the requested court`)
}

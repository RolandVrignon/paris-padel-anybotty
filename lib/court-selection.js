import { ENVIRONMENT_LABELS, getCourtEnvironmentOrder } from './court-environment.js'
import { assertCheckoutDuration, validateDurations } from './duration-preferences.js'

// A club may show either path, depending on the offers left for this starting time.
export const selectCourtIfOffered = async (page, { durationMinutes, durationsMinutes, court = null, courtEnvironment = ['any'] }) => {
  if (durationMinutes !== undefined && durationsMinutes !== undefined) throw new Error('Use durationMinutes or durationsMinutes, not both')
  const durations = validateDurations(durationsMinutes ?? [durationMinutes])
  const environmentOrder = getCourtEnvironmentOrder(courtEnvironment)
  const sheet = page.getByTestId('booking-sheet')
  const confirmation = page.getByTestId('slot-selection-confirm')
  await sheet.or(confirmation).waitFor()
  if (await sheet.isVisible()) return { usedModal: false, court, durationMinutes: await assertCheckoutDuration(sheet, durations) }

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
        if (durations.length === 1) throw new Error('Requested duration is unavailable')
        continue
      }
      await durationControl.click()
      // An enabled duration advertises offers. Wait for its cards before deciding.
      await renderedOptions.first().waitFor({ state: 'attached' })
    }
    const options = renderedOptions.and(modal.locator('button:enabled:not([aria-disabled="true"]):visible'))
    const eligible = court ? options.filter({ has: page.getByText(court, { exact: true }) }) : options
    if (!await eligible.count()) continue
    let matching = eligible
    let selectedEnvironment = null
    if (environmentOrder) {
      for (const environment of environmentOrder) {
        const label = ENVIRONMENT_LABELS[environment]
        const opposite = ENVIRONMENT_LABELS[environment === 'indoor' ? 'outdoor' : 'indoor']
        const candidates = eligible.filter({ has: page.getByText(label, { exact: true }), hasNot: page.getByText(opposite, { exact: true }) })
        if (await candidates.count()) {
          matching = candidates
          selectedEnvironment = environment
          break
        }
      }
      if (!selectedEnvironment) continue
    }
    const chosen = court ? matching : matching.first()
    const selectedCourt = (await chosen.locator('p').first().innerText()).trim()
    if (!selectedCourt) throw new Error('Cannot identify the selected court')
    await chosen.click()
    await modal.getByTestId('slot-selection-confirm').click()
    await sheet.waitFor()
    return { usedModal: true, court: selectedCourt, durationMinutes: duration, ...(selectedEnvironment ? { environment: selectedEnvironment } : {}) }
  }
  throw new Error(`No available court matches courtEnvironment=${courtEnvironment}, durationsMinutes=${durations.join(',')} and the requested court`)
}

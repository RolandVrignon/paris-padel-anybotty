import { assertCheckoutDuration } from './duration-preferences.js'
import { assertCheckoutEnvironment } from './court-environment.js'
import { selectCourtIfOffered, NoMatchingOfferError } from './court-selection.js'
import { inspectCheckout } from './checkout.js'
import { checkoutPrice } from './booking-price.js'

// One attempt, without accepting conditions or preparing payment.
export const previewBookingOffer = async (page, club, request, { excludedOffers = [], onSelected = () => {}, onStage = () => {} } = {}) => {
  const { date, startTime: time, durationsMinutes, courtEnvironment, maxPricePerHourEUR, court } = request
  onStage('club page')
  const rejectCookies = page.locator('#axeptio_overlay').getByRole('button', { name: 'Non merci', exact: true })
  await page.addLocatorHandler(rejectCookies, button => button.click())
  await page.goto(`${club.url}?date=${date}`, { waitUntil: 'domcontentloaded' })
  await page.locator('a[href="/fr/compte"]').waitFor()
  onStage('time selection')
  const timeButton = page.getByRole('button', { name: new RegExp(`^${time},`) })
  await timeButton.waitFor()
  if (!await timeButton.isEnabled()) throw new NoMatchingOfferError('Requested starting time is unavailable')
  await timeButton.click()
  onStage('court selection')
  const selected = await selectCourtIfOffered(page, { durationsMinutes, courtEnvironment, court, excludedOffers, onSelected })
  onStage('checkout summary')
  const sheet = page.getByTestId('booking-sheet')
  const formattedDate = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris' }).format(new Date(`${date}T12:00:00Z`))
  await sheet.filter({ hasText: formattedDate }).filter({ hasText: `${time} (${selected.durationMinutes} min)` }).waitFor()
  const { summary } = await inspectCheckout(page, club.id)
  if (!summary.includes(formattedDate) || !summary.includes(`${time} (${selected.durationMinutes} min)`)) throw new Error('Checkout date/time does not match the request')
  if (selected.court && !summary.split('\n').includes(selected.court)) throw new Error('Selected court does not match the request')
  await assertCheckoutDuration(sheet, durationsMinutes, selected.durationMinutes)
  await assertCheckoutEnvironment(sheet, courtEnvironment, selected.environment)
  const price = checkoutPrice(summary, selected.durationMinutes, maxPricePerHourEUR)
  return { clubId: club.id, clubName: club.name, date, startTime: time, ...selected, ...price, stage: 'checkout_ready', paymentSubmitted: false, reservationConfirmed: false }
}

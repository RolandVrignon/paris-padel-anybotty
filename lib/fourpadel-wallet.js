import dayjs from 'dayjs'
import { providerScope } from './provider-session.js'
import { normalizeFourPadelRequest, FOURPADEL_CLUBS, previewFourPadelBooking, fourPadelPreviewRequestAllowed } from './fourpadel-booking.js'
import { listFourPadelReservations, normalizeFourPadelReservations } from './fourpadel-account.js'
import { parseEURCents } from './booking-price.js'

const API = 'https://api-front.lefive.fr/splf/v1'
export const fourPadelEndpointMatches = (url, path, params = {}) => {
  const actual = new URL(url)
  return actual.origin === 'https://api-front.lefive.fr' && actual.pathname === `/splf/v1${path}` && [...actual.searchParams].length === Object.keys(params).length && Object.entries(params).every(([key, value]) => actual.searchParams.get(key) === String(value))
}
export const fourPadelWalletKey = request => `book-${request.clubId}-${request.date}-${request.startTime.replace(':', '')}-wallet`
export const readFourPadelWallet = async session => {
  const page = await session.context.newPage()
  page.setDefaultTimeout(30000)
  try {
    await page.goto('https://www.4padel.fr/mon-compte/fid', { waitUntil: 'domcontentloaded' })
    await page.getByText(/actualiser mon solde/i).waitFor()
    const pending = page.waitForResponse(r => {
      const url = new URL(r.url())
      return url.origin === 'https://api2-front.lefive.fr' && url.pathname === '/users/me' && url.searchParams.get('qoodos_refund') === 'true' && r.request().method() === 'GET'
    }).then(async r => { if (!r.ok()) throw new Error('4PADEL wallet refresh failed'); return r.json() })
    pending.catch(() => {})
    await page.getByText(/actualiser mon solde/i).click()
    const user = await pending
    if (typeof user.email !== 'string' || providerScope(user.email) !== session.accountScope || !Number.isFinite(user.qoodosRefund) || user.qoodosRefund < 0) throw new Error('4PADEL wallet identity or balance unavailable')
    return { balanceEUR: user.qoodosRefund, checkedAt: new Date().toISOString() }
  } finally { await page.close() }
}

export const fourPadelCreateMatches = (body, offer) => body?.center?.id === FOURPADEL_CLUBS[offer.clubId].centerId && body.field?.id === offer.courtId && body.owner?.id === offer.accountUserId && Number.isInteger(offer.accountUserId) && body.localStartingDate?.slice(0, 16) === `${offer.date}T${offer.startTime}` && body.endingDate?.slice(0, 16) === dayjs(`${offer.date}T${offer.startTime}`).add(offer.durationMinutes, 'minute').format('YYYY-MM-DDTHH:mm') && body.duration === offer.durationMinutes && body.capacity === 4 && Math.round(body.price * 100) === offer.totalCents && body.sportType?.id === 3 && body.paidCredit === 0 && body.promoCode === null && body.booking_status === 'Pending'
export const fourPadelParticipationMatches = (body, offer, id, accountScope) => Array.isArray(body) && body.length === 1 && body[0]?.booking?.id === Number(id) && body[0].nbSlotPaid === 4 && Math.round(Number(body[0].price) * 100) === offer.totalCents && body[0].paidBy === offer.accountUserId && typeof body[0].email === 'string' && providerScope(body[0].email) === accountScope && body[0].isChannelWeb === true && body[0].promoCode === null && body[0].gymlibCode === null && body[0].offreItemMuchoMasId === null
export const fourPadelCreditMatches = (body, offer, participationId) => body?.id === participationId && body.status === 'Confirmed' && body.isChannelWeb === true && body.paidByCredit === true && Math.round(body.paidCreditAmount * 100) === offer.totalCents && body.nbParticipations === 4 && body.paidBy === offer.accountUserId && body.paymentLink === false && body.cartId === null
export const inspectFourPadelWalletSummary = (text, offer) => {
  const club = FOURPADEL_CLUBS[offer.clubId]
  const date = offer.date.split('-').reverse().join('/')
  const end = dayjs(`${offer.date}T${offer.startTime}`).add(offer.durationMinutes, 'minute').format('HH[h]mm')
  const price = text.match(/4 parts\s+([\d., ]+)€/i)
  if (!text.includes(`${club.name} en ${offer.court}`) || !text.includes(`le ${date}`) || !text.includes(`de ${offer.startTime.replace(':', 'h')} à ${end}`) || !price || parseEURCents(price[1]) !== offer.totalCents || offer.parts !== 4) throw new Error('4PADEL wallet checkout changed')
}

export const reconcileFourPadelWallet = async (session, store, request, { readReservations = listFourPadelReservations } = {}) => {
  const key = fourPadelWalletKey(request)
  const journal = store.read(key)
  if (!journal) return { provider: '4padel', status: 'no_attempt' }
  const rows = (await readReservations(session)).reservations
  const row = rows.find(row => row.id === journal.reservationId)
  if (row && (row.centerId !== FOURPADEL_CLUBS[request.clubId].centerId || row.dateTime !== `${request.date}T${request.startTime}` || row.durationMinutes !== journal.offer.durationMinutes || Math.round(row.totalEUR * 100) !== journal.offer.totalCents)) throw new Error('4PADEL reconciliation identity mismatch')
  const status = row && ['Cancelled', 'Canceled'].includes(row.status) ? 'cancelled' : row?.reservationConfirmed && row.fullyPaid && row.paidParts === 4 ? 'booked' : 'booking_unverified'
  const result = { provider: '4padel', status, reservation: row || null, reservationConfirmed: status === 'booked', paymentMethod: 'wallet', parts: 4, repeatedSubmission: false }
  store.save(key, { ...journal, ...result })
  return result
}

export const bookFourPadelWallet = async (session, store, input, { confirm = false, onStage = () => {}, preview = previewFourPadelBooking, readReservations = listFourPadelReservations, readWallet = readFourPadelWallet } = {}) => {
  const request = normalizeFourPadelRequest(input)
  const key = fourPadelWalletKey(request)
  if (confirm && store.read(key)) return reconcileFourPadelWallet(session, store, request, { readReservations })
  const baseline = (await readReservations(session)).reservations
  const existing = baseline.filter(r => r.centerId === FOURPADEL_CLUBS[request.clubId].centerId && r.dateTime === `${request.date}T${request.startTime}` && ['Pending', 'Confirmed'].includes(r.status))
  if (existing.length) return { provider: '4padel', status: 'already_reserved_or_pending', reservations: existing, submitted: false }
  const wallet = await readWallet(session)
  const page = await session.context.newPage()
  page.setDefaultTimeout(30000)
  let guard
  let journal
  try {
    const offer = await preview(page, request, { accountScope: session.accountScope, parts: 4, onStage })
    if (offer.status !== 'checkout_ready') return offer
    if (Math.round(wallet.balanceEUR * 100) < offer.totalCents) return { ...offer, status: 'insufficient_wallet_balance', wallet, submitted: false }
    if (!confirm) return { ...offer, wallet, paymentMethod: 'wallet', submitted: false }
    if (!Number.isInteger(offer.accountUserId)) throw new Error('4PADEL account ID unavailable')
    journal = { provider: '4padel', status: 'creation_started', offer, walletBeforeEUR: wallet.balanceEUR, baselineIds: baseline.map(r => r.id), startedAt: new Date().toISOString() }
    let createArmed = true
    let participationArmed = false
    let paymentArmed = false
    let participationId
    let participationResponse
    let blockedMutation = false
    const save = status => { journal.status = status; store.save(key, journal) }
    save('creation_started')
    guard = async route => {
      const req = route.request()
      const url = new URL(req.url())
      if (fourPadelPreviewRequestAllowed(req.url(), req.method())) return route.fallback()
      let body
      try { body = req.postDataJSON() } catch { /* Reject unknown mutation formats. */ }
      if (createArmed && fourPadelEndpointMatches(req.url(), '/bookings', { appId: 2, isChannelWeb: true }) && req.method() === 'PUT' && fourPadelCreateMatches(body, offer)) {
        createArmed = false
        return route.fallback()
      }
      if (participationArmed && fourPadelEndpointMatches(req.url(), '/userparticipations', { appId: 2, isChannelWeb: true, paymentLink: true, paidByCredit: true, paidCreditAmount: offer.totalCents / 100, paidBy: offer.accountUserId }) && req.method() === 'PUT' && fourPadelParticipationMatches(body, offer, journal.reservationId, session.accountScope)) {
        participationArmed = false
        return route.fallback()
      }
      if (paymentArmed && url.origin === 'https://api-front.lefive.fr' && /^\/splf\/v1\/userparticipations\/\d+\/status$/.test(url.pathname) && req.method() === 'POST') {
        try {
          const participants = await participationResponse
          participationId = participants?.[0]?.id
          if (Number.isInteger(participationId) && req.url() === `${API}/userparticipations/${participationId}/status` && fourPadelCreditMatches(body, offer, participationId)) {
            paymentArmed = false
            journal.participationId = participationId
            save('wallet_payment_submitted')
            return route.fallback()
          }
        } catch { /* Reject ambiguous participation state. */ }
      }
      blockedMutation = true
      return route.abort('blockedbyclient')
    }
    await session.context.route('**/*', guard)
    const created = page.waitForResponse(r => fourPadelEndpointMatches(r.url(), '/bookings', { appId: 2, isChannelWeb: true }) && r.request().method() === 'PUT').then(async r => { if (!r.ok()) throw new Error('4PADEL creation failed'); return r.json() })
    created.catch(() => {})
    onStage('creation')
    await page.getByRole('button', { name: /payer maintenant/i }).click()
    const raw = await created
    const reservation = normalizeFourPadelReservations([raw], session.accountScope)[0]
    if (!reservation || baseline.some(r => r.id === reservation.id) || raw.owner.id !== offer.accountUserId || raw.field.id !== offer.courtId || reservation.dateTime !== `${offer.date}T${offer.startTime}` || reservation.totalEUR * 100 !== offer.totalCents || reservation.centerId !== FOURPADEL_CLUBS[offer.clubId].centerId) throw new Error('4PADEL created reservation mismatch')
    journal.reservationId = reservation.id
    save('created_pending')
    await page.waitForURL(url => url.origin === 'https://www.4padel.fr' && url.pathname === '/paiement/method' && url.searchParams.get('bookingId') === reservation.id)
    await page.getByRole('button', { name: /je paye avec mon solde/i }).waitFor()
    inspectFourPadelWalletSummary(await page.locator('body').innerText(), offer)
    await page.getByRole('button', { name: /je paye avec mon solde/i }).click()
    await page.getByText('Confirmation de paiement', { exact: true }).waitFor()
    await page.getByText('Souhaitez-vous régler avec votre solde ? Confirmez-vous ?', { exact: true }).waitFor()
    participationResponse = page.waitForResponse(r => fourPadelEndpointMatches(r.url(), '/userparticipations', { appId: 2, isChannelWeb: true, paymentLink: true, paidByCredit: true, paidCreditAmount: offer.totalCents / 100, paidBy: offer.accountUserId }) && r.request().method() === 'PUT').then(async r => { if (!r.ok()) throw new Error('4PADEL participation failed'); return r.json() })
    participationResponse.catch(() => {})
    const paid = page.waitForResponse(r => r.url() === `${API}/userparticipations/${participationId}/status` && r.request().method() === 'POST').then(r => r.status() === 204)
    paid.catch(() => {})
    participationArmed = true
    paymentArmed = true
    save('wallet_payment_started')
    onStage('wallet_payment')
    await page.getByRole('button', { name: /^OK$/ }).click()
    journal.paymentResponseConfirmed = await paid
    journal.blockedMutation = blockedMutation
    save('payment_verification')
    await session.context.unroute('**/*', guard)
    guard = null
    const result = await reconcileFourPadelWallet(session, store, request, { readReservations })
    let walletAfter
    try { walletAfter = await readWallet(session) } catch { /* Booking truth comes from the reservation, never from a balance alone. */ }
    store.save(key, { ...store.read(key), walletAfter })
    return { ...result, walletBeforeEUR: wallet.balanceEUR, walletAfter, creditDebitObserved: walletAfter ? Math.round((wallet.balanceEUR - walletAfter.balanceEUR) * 100) === offer.totalCents : false }
  } catch (error) {
    if (!journal) throw error
    store.save(key, { ...journal, status: 'booking_unverified' })
    return { provider: '4padel', status: 'booking_unverified', reservationId: journal.reservationId || null, repeatedSubmission: false, paymentMethod: 'wallet' }
  } finally {
    if (guard) await session.context.unroute('**/*', guard)
    await page.close()
  }
}

// Reserve no funds: this is a conservative readiness check for all accepted durations.
export const walletRequirement = (provider, mode, request) => {
  if (provider !== '4padel' || mode !== 'pay') return null
  const hourlyCents = Math.round(request.maxPricePerHourEUR * 100)
  if (!Number.isSafeInteger(hourlyCents) || hourlyCents <= 0) throw new Error('Scheduled 4PADEL payment requires maxPricePerHourEUR to calculate the wallet requirement')
  const requiredCents = Math.ceil(hourlyCents * Math.max(...request.durationsMinutes) / 60)
  if (!Number.isSafeInteger(requiredCents)) throw new Error('Wallet requirement exceeds the supported amount')
  return { requiredEUR: requiredCents / 100, basis: 'hourly_limit_times_longest_duration', fundsReserved: false }
}

export const evaluateWallet = (requirement, wallet, now = new Date()) => {
  const age = new Date(now).getTime() - Date.parse(wallet?.checkedAt)
  if (!Number.isFinite(wallet?.balanceEUR) || wallet.balanceEUR < 0 || !Number.isFinite(age) || age < -5000 || age > 300000) {
    return { ...requirement, status: 'wallet_check_failed', balanceEUR: null, missingEUR: null, checkedAt: new Date(now).toISOString() }
  }
  const missingCents = Math.max(0, Math.round(requirement.requiredEUR * 100) - Math.round(wallet.balanceEUR * 100))
  return { ...requirement, status: missingCents ? 'insufficient_wallet_balance' : 'wallet_ready', balanceEUR: wallet.balanceEUR, missingEUR: missingCents / 100, checkedAt: wallet.checkedAt }
}

export const scheduledBookingArgs = (request, mode, provider = 'anybuddy', input) => {
  if (provider === '4padel') return ['scripts/fourpadel.js', 'book', '--club', request.clubs[0], '--date', request.date, '--time', request.startTime,
    '--durations', request.durationsMinutes.join(','), '--court-environment', request.courtEnvironment.join(','),
    ...(request.maxPricePerHourEUR === null ? [] : ['--max-price-per-hour', String(request.maxPricePerHourEUR)]), ...(mode === 'pay' ? ['--confirm'] : [])]
  if (provider !== 'anybuddy') throw new Error('Unsupported scheduled provider')
  return ['scripts/booking-search.js', '--config', input, '--headless', ...(mode === 'pay' ? ['--pay'] : [])]
}

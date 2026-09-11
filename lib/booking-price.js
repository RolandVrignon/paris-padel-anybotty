export const validatePriceLimit = (value = null) => {
  if (value !== null && (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || !Number.isSafeInteger(Math.round(value * 100)) || Math.abs(value * 100 - Math.round(value * 100)) > 1e-7)) throw new Error('maxPricePerHourEUR must be a positive amount with at most two decimals, or null')
  return value
}

// Never silently reinterpret an old total budget as a higher hourly budget.
export const normalizePriceConfig = input => {
  const { maxTotalPriceEUR, ...request } = input
  if (maxTotalPriceEUR !== undefined && maxTotalPriceEUR !== null) throw new Error('Replace maxTotalPriceEUR with maxPricePerHourEUR; the limit now applies per hour for the whole court')
  if (request.maxPricePerHourEUR !== undefined) validatePriceLimit(request.maxPricePerHourEUR)
  return request
}

export const parseEURCents = text => {
  const normalized = text.replace(/[\s\u00a0\u202f]/g, '')
  if (!/^\d+(?:[,.]\d{1,2})?$/.test(normalized)) throw new Error('Missing or ambiguous checkout price')
  const cents = Math.round(Number(normalized.replace(',', '.')) * 100)
  if (!Number.isSafeInteger(cents) || cents <= 0) throw new Error('Missing or unexpected checkout amount')
  return cents
}

export const checkoutPrice = (summary, durationMinutes, maxPricePerHourEUR = null) => {
  validatePriceLimit(maxPricePerHourEUR)
  if (![60, 90, 120].includes(durationMinutes)) throw new Error('Invalid duration for hourly price')
  const totals = [...summary.matchAll(/Total à payer\s+([\d\s,.]+)\s*€/g)]
  if (totals.length !== 1) throw new Error('Missing or ambiguous checkout total')
  const totalCents = parseEURCents(totals[0][1])
  // Compare unrounded amounts. Rounding is for display only.
  const withinBudget = maxPricePerHourEUR === null || BigInt(totalCents) * 60n <= BigInt(Math.round(maxPricePerHourEUR * 100)) * BigInt(durationMinutes)
  const price = { totalCents, totalEUR: totalCents / 100, pricePerHourEUR: totalCents * 60 / durationMinutes / 100, maxPricePerHourEUR }
  if (!withinBudget) {
    const error = new Error('Selected offer exceeds maxPricePerHourEUR')
    error.code = 'PRICE_LIMIT'
    error.price = price
    throw error
  }
  return price
}

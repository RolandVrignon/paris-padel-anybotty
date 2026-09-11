export const BOOKING_DURATIONS = [60, 90, 120]

export const validateDurations = durations => {
  if (!Array.isArray(durations) || !durations.length || durations.some(value => !BOOKING_DURATIONS.includes(value)) || new Set(durations).size !== durations.length) throw new Error('durationsMinutes must be a non-empty ordered list of unique values from 60, 90, 120')
  return [...durations]
}

export const parseDurationsArgument = value => {
  if (typeof value !== 'string' || !/^(60|90|120)(,(60|90|120))*$/.test(value)) throw new Error('Use --durations 60,90,120 (only the wanted durations, in preference order)')
  return validateDurations(value.split(',').map(Number))
}

export const assertCheckoutDuration = async (sheet, durations, expected = null) => {
  const allowed = validateDurations(durations)
  const label = sheet.getByText(/^\d{2}:\d{2}\s*\(\d+\s*min\)$/)
  await label.waitFor()
  const duration = Number((await label.innerText()).match(/\((\d+)\s*min\)/)?.[1])
  if (!allowed.includes(duration) || (expected !== null && duration !== expected)) throw new Error('Selected duration is excluded or differs from the chosen offer')
  return duration
}

// A timing reference is evidence from another calendar, never checkout validation.
export const openingReference = (target, readLatest, now = Date.now()) => {
  const reference = target.monitoring?.openingReference
  if (!reference) return null
  const source = readLatest(reference.targetId)
  const timestamp = Date.parse(source?.snapshot?.finishedAt)
  const fresh = source?.status === 'ok' && Number.isFinite(timestamp) && now >= timestamp && now - timestamp <= 10 * 60 * 1000
  const measurements = (source?.recentOpenings || [])
    .filter(event => event.type === 'new_day_candidate' && event.lastValidAbsentAt && event.firstAvailableAt)
    .map(event => {
      const watch = source.calendar?.watches?.[event.targetDate] || source.completedWatches?.find(watch => watch.targetDate === event.targetDate && watch.firstAvailableAt === event.firstAvailableAt)
      const sameAppearance = watch?.firstAvailableAt === event.firstAvailableAt
      return {
        targetDate: event.targetDate,
        after: event.lastValidAbsentAt,
        by: event.firstAvailableAt,
        confirmations: sameAppearance ? watch.confirmations.length : 0,
        sourceDateConfirmed: sameAppearance && watch.phase === 'complete' && watch.confirmations.length === 5,
      }
    })
  return {
    sourceTargetId: reference.targetId,
    status: 'hypothesis',
    assumedHorizonDays: target.observation.horizonDays,
    sourceStatus: !source ? 'not_observed' : fresh ? 'fresh' : 'unavailable_or_stale',
    sourceLastSuccessAt: source?.snapshot?.finishedAt ?? null,
    measurements,
    bookingAuthorizationVerified: false,
    interpretation: 'Boulogne calendar opening is a timing proxy only; no checkout or payment attempted',
  }
}

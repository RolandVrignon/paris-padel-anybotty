import assert from 'node:assert/strict'
import { test } from 'node:test'
import dayjs from 'dayjs'
import { normalizeUcpaWeek, assembleUcpaSnapshot } from '../lib/ucpa-monitoring.js'
import { normalizeFourPadelDates, normalizeFourPadelDay, fetchFourPadelAvailability } from '../lib/fourpadel-monitoring.js'
import { postFourPadelCalendar, calendarJSON } from '../lib/monitoring-http.js'
import { providerPauses, monitoringTargets, successfulObservation, horizonSummary } from '../lib/monitoring-targets.js'
import { repositoryDirectory } from '../lib/config.js'

const week = (from = '2026-09-07') => ({ planner: { columns: Array.from({ length: 7 }, (_, i) => ({ dateFormated: dayjs(from).add(i, 'day').format('YYYY-MM-DD'), items: [] })) } })
const ucpaOffer = (patch = {}) => ({ groupCode: 'PADEL', isDisabled: false, stock: 2,
  start_time: Date.parse('2026-09-13T07:00:00+02:00'), end_time: Date.parse('2026-09-13T07:59:59+02:00'), ...patch })

test('UCPA preserves full-day publication without interpreting full/disabled courts as bookable', () => {
  const body = week()
  body.planner.columns[6].items = [ucpaOffer(), ucpaOffer({ stock: 0, isDisabled: true }), ucpaOffer({ hoursReserveLimitation: true })]
  const normalized = normalizeUcpaWeek(body)
  assert.deepEqual(normalized.publishedDates, ['2026-09-13'])
  assert.deepEqual(normalized.slots, [{ startDateTime: '2026-09-13T07:00', durationMinutes: 60, offers: [{ availableCourts: 2 }] }])
  body.planner.columns[6].items = [ucpaOffer({ stock: 0, isDisabled: true })]
  assert.equal(normalizeUcpaWeek(body).slots.length, 0)
  assert.equal(normalizeUcpaWeek(body).publishedDates.length, 1)
})

test('UCPA rejects missing weeks, reordered dates, wrong sport and malformed stock', () => {
  assert.throws(() => normalizeUcpaWeek({}), /format/)
  const body = week()
  body.planner.columns[6].dateFormated = '2026-09-14'
  assert.throws(() => normalizeUcpaWeek(body), /contiguous/)
  for (const patch of [{ stock: '2' }, { groupCode: 'BADMINTON' }, { start_time: Date.parse('2026-09-14') }]) {
    const body = week()
    body.planner.columns[6].items = [ucpaOffer(patch)]
    assert.throws(() => normalizeUcpaWeek(body), /format|date/)
  }
})

test('UCPA scan records the observed navigation boundary and rejects pagination gaps', () => {
  const first = normalizeUcpaWeek(week())
  const second = normalizeUcpaWeek(week('2026-09-14'))
  const window = { from: '2026-09-13', to: '2026-09-20' }
  const result = assembleUcpaSnapshot({ url: 'https://www.ucpa.com/' }, window, [first, second], '2026-09-13T00:00:00Z')
  assert.equal(result.navigationThroughDate, '2026-09-20')
  assert.equal(result.window.to, '2026-10-04')
  assert.equal(result.availabilityScope, 'public_next_week_navigation')
  assert.throws(() => assembleUcpaSnapshot({}, window, [first, first]), /pagination/)
  assert.throws(() => assembleUcpaSnapshot({}, window, []), /missing/)
})

const cells = [{ day: '27', month: 'sep', disabled: false }, { day: '28', month: 'sep', disabled: true }]
test('4PADEL UI visibility is authoritative even when the inventory API returns later courts', () => {
  assert.deepEqual(normalizeFourPadelDates(cells, { from: '2026-09-27', to: '2026-09-28' }), [
    { date: '2026-09-27', selectable: true }, { date: '2026-09-28', selectable: false },
  ])
  assert.throws(() => normalizeFourPadelDates(cells, { from: '2026-09-28', to: '2026-09-29' }), /changed/)
  assert.throws(() => normalizeFourPadelDates([], { from: '2026-09-27', to: '2026-09-28' }), /Incomplete/)
  assert.deepEqual(normalizeFourPadelDates([{ day: '31', month: 'déc', disabled: false }, { day: '1', month: 'jan', disabled: true }], { from: '2026-12-31', to: '2027-01-01' }).map(c => c.date), ['2026-12-31', '2027-01-01'])
})
const fourRow = (patch = {}) => ({ startingDate: '2026-09-27T08:00:00Z', startingDateZuluTime: '2026-09-27T06:00:00Z', duration: 90,
  fields: [{ id: 897, center: { id: 105 }, canBookOnline: true, webPrice: 90, fieldType: { name: 'Intérieur' } }], ...patch })
test('4PADEL uses the actual UTC instant, whole court price and bookable fields only', () => {
  const result = normalizeFourPadelDay([fourRow()], '2026-09-27', 105)
  assert.equal(result[0].startDateTime, '2026-09-27T08:00')
  assert.equal(result[0].offers[0].priceCents, 9000)
  assert.deepEqual(normalizeFourPadelDay([fourRow({ fields: [] })], '2026-09-27', 105), [])
  const row = fourRow()
  row.fields[0].canBookOnline = false
  assert.deepEqual(normalizeFourPadelDay([row], '2026-09-27', 105), [])
  assert.throws(() => normalizeFourPadelDay([fourRow()], '2026-09-28', 105), /different/)
  assert.throws(() => normalizeFourPadelDay([fourRow()], '2026-09-27', 117), /court/)
  assert.throws(() => normalizeFourPadelDay({ error: 'no session' }, '2026-09-27', 105), /format/)
})

test('official calendar HTTP reads preserve retry backoff and never expose tokens or allow payment operations', async () => {
  assert.throws(() => postFourPadelCalendar('payment', {}), /Unsupported/)
  let sent
  await assert.rejects(postFourPadelCalendar('slots', {}, { authorization: 'private-token', fetchImpl: async (url, init) => {
    sent = { url, init }
    return new Response('private response', { status: 429, headers: { 'Retry-After': '600' } })
  } }), error => error.httpStatus === 429 && error.retryAfterMs === 600000 && !error.message.includes('private'))
  assert.equal(sent.init.method, 'POST')
  assert.match(sent.url, /bookingrules\/allFields/)
  await assert.rejects(calendarJSON('https://example.test', { fetchImpl: async () => new Response('{}', { headers: { Age: '1' } }) }), /Cached/)
})

test('provider backoff is isolated and old Anybuddy storage identities remain unchanged', () => {
  const targets = monitoringTargets(repositoryDirectory)
  assert.equal(targets.filter(t => t.provider === 'anybuddy').length, 7)
  assert.equal(targets.filter(t => t.provider !== 'anybuddy').length, 9)
  assert.equal(new Set(targets.map(t => t.id)).size, 16)
  assert.ok(targets.filter(t => t.provider === 'anybuddy').every(t => t.id === t.canonicalClubId))
  const pauses = providerPauses(targets, id => id.includes('--4padel') ? { httpStatus: 401, nextRetryAt: '2026-09-13T01:00:00Z' } : null, Date.parse('2026-09-13T00:00:00Z'))
  assert.deepEqual([...pauses.keys()], ['4padel'])
})

test('changed account starts a baseline and scan boundaries are lower bounds, not fixed horizons', () => {
  const target = { id: 'test', canonicalClubId: 'club', provider: '4padel', name: 'Test', observation: { horizonDays: 0 }, monitoring: {} }
  const snapshot = { startedAt: '2026-09-13T00:00:00Z', finishedAt: '2026-09-13T00:01:00Z', accountScope: 'new-account', window: { from: '2026-09-13', to: '2026-09-14' }, slots: [{ startDateTime: '2026-09-14T08:00', durationMinutes: 60, offers: [] }] }
  const previous = { snapshot: { ...snapshot, accountScope: 'old-account', slots: [] } }
  const record = successfulObservation(target, previous, snapshot)
  assert.deepEqual(record.events, [])
  assert.equal(record.calendar.batches.length, 0)
  assert.equal(horizonSummary(snapshot).availableLeadIsLowerBound, true)
  assert.equal(horizonSummary(snapshot).availableLeadDays, 1)
})


test('4PADEL collector never queries or counts raw inventory for a disabled UI date', async () => {
  const calendar = { url: () => 'https://api2-front.lefive.fr/bookingrules/allFields', ok: () => true, request: () => ({ headers: () => ({ authorization: 'test-token' }) }) }
  const visibility = { url: () => 'https://api2-front.lefive.fr/bookingrules/me/visibility', ok: () => true, json: async () => ({ blockBookingAfterDaysDefault: 14, blockBookingAfterDaysGlobal: 14 }) }
  let closed = false
  const page = {
    context: () => ({ newCDPSession: async () => ({ send: async (method, params) => { assert.equal(method, 'Emulation.setTimezoneOverride'); assert.equal(params.timezoneId, 'Europe/Paris') } }) }),
    setDefaultTimeout() {}, waitForResponse: async predicate => predicate(calendar) ? calendar : visibility,
    goto: async () => {}, close: async () => { closed = true },
    locator: () => ({ first: () => ({ waitFor: async () => {} }), evaluateAll: async () => cells }),
  }
  const queried = []
  const snapshot = await fetchFourPadelAvailability({ centerId: 105, url: 'https://www.4padel.fr/reservations/slots?center=105' }, { from: '2026-09-27', to: '2026-09-28' }, {
    session: { accountScope: 'test', context: { newPage: async () => page } },
    fetchImpl: async (url, options) => {
      if (url.includes('/filtered')) return new Response(JSON.stringify({ durations: [90] }))
      queried.push(JSON.parse(options.body))
      return new Response(JSON.stringify([fourRow()]))
    },
  })
  assert.equal(closed, true)
  assert.equal(queried.length, 1)
  assert.equal(queried[0].startingDateZuluTime, '2026-09-26T22:00:00.000Z')
  assert.equal(queried[0].endingDateZuluTime, '2026-09-27T21:59:59.999Z')
  assert.deepEqual(snapshot.blockedDates, ['2026-09-28'])
  assert.equal(snapshot.slots.length, 1)
})

test('targeted UCPA coverage retains the native boundary even before the requested date', () => {
  const result = assembleUcpaSnapshot({}, { from: '2026-09-21', to: '2026-09-27' }, [normalizeUcpaWeek(week('2026-09-14'))], '2026-09-13T00:00:00Z', { targeted: true })
  assert.deepEqual(result.window, { from: '2026-09-21', to: '2026-09-27' })
  assert.equal(result.navigationThroughDate, '2026-09-20')
  assert.deepEqual(result.slots, [])
})

test('targeted 4PADEL maps UI dates from today and makes no inventory request for blocked candidates', async () => {
  const calendar = { url: () => 'https://api2-front.lefive.fr/bookingrules/allFields', ok: () => true, request: () => ({ headers: () => ({ authorization: 'test-token' }) }) }
  const visibility = { url: () => 'https://api2-front.lefive.fr/bookingrules/me/visibility', ok: () => true, json: async () => ({ blockBookingAfterDaysDefault: 14, blockBookingAfterDaysGlobal: 14 }) }
  const page = {
    context: () => ({ newCDPSession: async () => ({ send: async () => {} }) }),
    setDefaultTimeout() {}, waitForResponse: async predicate => predicate(calendar) ? calendar : visibility,
    goto: async () => {}, close: async () => {},
    locator: () => ({ first: () => ({ waitFor: async () => {} }), evaluateAll: async () => cells }),
  }
  const snapshot = await fetchFourPadelAvailability({ centerId: 105, url: 'https://www.4padel.fr/reservations/slots?center=105' }, { from: '2026-09-28', to: '2026-09-28' }, {
    calendarFrom: '2026-09-27', session: { accountScope: 'test', context: { newPage: async () => page } },
    fetchImpl: async () => { assert.fail('No extra API reads for disabled dates') },
  })
  assert.deepEqual(snapshot.blockedDates, ['2026-09-28'])
  assert.deepEqual(snapshot.slots, [])
})

test('UCPA bounded scanning does not invent a horizon or absence beyond observed coverage', () => {
  const body=week('2026-09-14')
  const window={from:'2026-09-14',to:'2026-09-16'}
  const result=assembleUcpaSnapshot({}, window, [normalizeUcpaWeek(body)], '2026-09-13T00:00:00Z', {reachedBoundary:false})
  assert.equal(result.navigationThroughDate,null)
  assert.equal(result.navigationLimitReached,false)
  assert.equal(result.navigationObservedThroughDate,'2026-09-20')
  assert.deepEqual(result.window,window)
})

test('Meudon next-week landing omits unvisited days while Paris keeps its strict date guard', () => {
  const weeks=[normalizeUcpaWeek(week('2026-09-14'))]
  const window={from:'2026-09-13',to:'2026-09-20'}
  const result=assembleUcpaSnapshot({monitoring:{navigationMode:'window'}},window,weeks,'2026-09-13T18:00:00Z',{reachedBoundary:false})
  assert.deepEqual(result.window,{from:'2026-09-14',to:'2026-09-20'})
  assert.equal(result.navigationThroughDate,null)
  assert.throws(()=>assembleUcpaSnapshot({},window,weeks,'2026-09-13T18:00:00Z'), /date changed/)
})

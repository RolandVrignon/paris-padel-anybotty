// Anybuddy's authenticated website uses Next server actions. Resolve the read-only
// action from the current public bundle instead of pinning a deployment hash.
import { ANYBUDDY_ORIGIN } from './anybuddy-session.js'
export const ACCOUNT_RESERVATIONS_URL = `${ANYBUDDY_ORIGIN}/fr/compte?section=reservations`

export const decodeActionResponse = input => {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input)
  const records = new Map()
  let offset = 0
  while (offset < buffer.length) {
    if (buffer[offset] === 10) { offset++; continue }
    const colon = buffer.indexOf(58, offset)
    if (colon < 0) throw new Error('Incomplete action response')
    const id = buffer.subarray(offset, colon).toString('ascii')
    if (!/^[a-f\d]+$/.test(id) || records.has(id)) throw new Error('Unexpected action response record')
    offset = colon + 1
    if (buffer[offset] === 84) {
      const comma = buffer.indexOf(44, offset)
      const size = buffer.subarray(offset + 1, comma).toString('ascii')
      if (comma < 0 || !/^[a-f\d]+$/.test(size)) throw new Error('Invalid text record')
      const end = comma + 1 + Number.parseInt(size, 16)
      if (end > buffer.length) throw new Error('Incomplete text record')
      records.set(id, buffer.subarray(comma + 1, end).toString('utf8'))
      offset = end
    } else {
      const newline = buffer.indexOf(10, offset)
      const end = newline < 0 ? buffer.length : newline
      try { records.set(id, JSON.parse(buffer.subarray(offset, end).toString('utf8'))) } catch { throw new Error('Unsupported action response; no reservation state inferred') }
      offset = end + 1
    }
  }
  const reference = records.get('0')?.a
  if (typeof reference !== 'string' || !/^\$@[a-f\d]+$/.test(reference)) throw new Error('Missing action result')
  const resolve = (value, ancestors = new Set()) => {
    if (typeof value === 'string' && /^\$[a-f\d]+$/.test(value)) {
      const id = value.slice(1)
      if (!records.has(id) || ancestors.has(id)) throw new Error('Unresolved action reference')
      return resolve(records.get(id), new Set([...ancestors, id]))
    }
    if (value === '$undefined') return undefined
    if (typeof value === 'string' && value.startsWith('$$')) return value.slice(1)
    if (Array.isArray(value)) return value.map(item => resolve(item, ancestors))
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolve(item, ancestors)]))
    return value
  }
  const result = records.get(reference.slice(2))
  if (!result) throw new Error('Missing action result record')
  return resolve(result)
}

export const discoverMatchesAction = async page => {
  await page.goto(ACCOUNT_RESERVATIONS_URL, { waitUntil: 'domcontentloaded' })
  await page.getByRole('heading', { name: 'Mes réservations', exact: true }).waitFor()
  const sources = await page.locator('script[src]').evaluateAll(nodes => nodes.map(node => node.src))
  const urls = [...new Set(sources)].filter(url => {
    const parsed = new URL(url)
    return parsed.origin === 'https://static.anybuddyapp.com' && parsed.pathname.startsWith('/_next/static/chunks/')
  })
  for (let offset = 0; offset < urls.length; offset += 4) {
    const texts = await Promise.all(urls.slice(offset, offset + 4).map(async url => {
      const response = await page.context().request.get(url, { timeout: 15000, maxRedirects: 0 })
      if (!response.ok()) throw new Error('Unable to read current Anybuddy action definitions')
      return response.text()
    }))
    for (const text of texts) {
      const match = text.match(/createServerReference\)\("([a-f\d]{40,64})"[^;]{0,160}"getUserMatchesAction"/)
      if (match) return match[1]
    }
  }
  throw new Error('Current reservation read action was not found; website may have changed')
}

export const readMatchesPage = async (context, action, after = 0) => {
  if (!/^[a-f\d]{40,64}$/.test(action)) throw new Error('Invalid read action')
  const response = await context.request.post(ACCOUNT_RESERVATIONS_URL, {
    headers: { 'Next-Action': action, 'Content-Type': 'text/plain;charset=UTF-8', Origin: ANYBUDDY_ORIGIN, Accept: 'text/x-component' },
    data: JSON.stringify([{ limit: 50, ...(after ? { after } : {}) }]), timeout: 20000, maxRedirects: 0,
  })
  if (!response.ok()) throw new Error(`Reservation listing failed (HTTP ${response.status()}); no retry submitted`)
  const result = decodeActionResponse(await response.body())
  if (result.success !== true || !Array.isArray(result.matches?.data) || typeof result.matches?.paging?.hasNextPage !== 'boolean') throw new Error('Reservation listing unavailable or unexpected; check session')
  return result.matches
}

export const calendarHttpError = (status, retry) => Object.assign(new Error(`Calendar HTTP ${status}`), {
  httpStatus: status,
  retryAfterMs: retry && /^\d+$/.test(retry) ? Number(retry) * 1000 : Math.max(0, Date.parse(retry) - Date.now()) || 0,
})

// Calendar reads only. Errors never include a URL query, body or credential.
const requestJSON = async (url, init, { fetchImpl = fetch, signal } = {}) => {
  const response = await fetchImpl(url, {
    ...init, redirect: 'error',
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000),
  })
  if (!response.ok) throw calendarHttpError(response.status, response.headers.get('retry-after'))
  if (Number(response.headers.get('age') || 0) > 0) throw new Error('Cached calendar cannot establish a fresh observation')
  return response.json()
}
export const calendarJSON = (url, options = {}) => requestJSON(url, {
  method: 'GET', headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' },
}, options)

const readOnlyRoutes = {
  slots: 'https://api2-front.lefive.fr/bookingrules/allFields?appId=2&isChannelWeb=true',
  durations: 'https://api-front.lefive.fr/splf/v1/bookingrules/filtered?appId=2&isChannelWeb=true',
}
export const postFourPadelCalendar = (operation, body, { authorization, ...options } = {}) => {
  if (!Object.hasOwn(readOnlyRoutes, operation)) throw new Error('Unsupported calendar read operation')
  return requestJSON(readOnlyRoutes[operation], {
    method: 'POST', body: JSON.stringify(body),
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'Cache-Control': 'no-cache', Authorization: authorization },
  }, options)
}

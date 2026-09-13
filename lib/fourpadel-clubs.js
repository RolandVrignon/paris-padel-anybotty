import { readFileSync } from 'node:fs'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc.js'
import timezone from 'dayjs/plugin/timezone.js'
dayjs.extend(utc)
dayjs.extend(timezone)

export const fourPadelCatalogPath = new URL('../data/fourpadel-clubs.json', import.meta.url)
export const validateFourPadelCatalog = catalog => {
  if (!catalog || catalog.source !== 'https://www.4padel.fr/' || !Number.isFinite(Date.parse(catalog.checkedAt)) || !Array.isArray(catalog.centers) || !catalog.centers.length) throw new Error('Invalid official 4PADEL catalogue')
  const ids = new Set(), centers = new Set(), names = new Set()
  for (const club of catalog.centers) {
    if (!/^4padel-[a-z0-9-]+$/.test(club.id) || !Number.isInteger(club.centerId) || club.centerId <= 0 || !club.name?.startsWith('4PADEL ') || !club.region || !['Europe/Paris', 'Indian/Reunion'].includes(club.timeZone) || ids.has(club.id) || centers.has(club.centerId) || names.has(club.name)) throw new Error('Ambiguous or invalid 4PADEL center')
    const url = new URL(club.url)
    if (url.origin !== catalog.source.slice(0, -1) || !url.pathname.startsWith(`/nos-centres/${club.centerId}/`)) throw new Error('4PADEL center URL differs from its ID')
    ids.add(club.id); centers.add(club.centerId); names.add(club.name)
  }
  return catalog
}
export const fourPadelCatalog = validateFourPadelCatalog(JSON.parse(readFileSync(fourPadelCatalogPath, 'utf8')))
export const FOURPADEL_CLUBS = Object.fromEntries(fourPadelCatalog.centers.map(club => [club.id, club]))
export const fourPadelTimeZone = centerId => fourPadelCatalog.centers.find(club => club.centerId === centerId)?.timeZone || 'Europe/Paris'
export const fourPadelLocalTime = (date, centerId) => dayjs(date).tz(fourPadelTimeZone(centerId)).format('YYYY-MM-DDTHH:mm:ss')

// The portal renders Zulu timestamps in the browser's time zone, including checkout.
const pageSessions = new WeakMap()
export const applyFourPadelTimeZone = async (page, centerId) => {
  if (!pageSessions.has(page)) pageSessions.set(page, page.context().newCDPSession(page))
  const client = await pageSessions.get(page)
  await client.send('Emulation.setTimezoneOverride', { timezoneId: fourPadelTimeZone(centerId) })
  // Chromium closes this CDP session with the page.
}

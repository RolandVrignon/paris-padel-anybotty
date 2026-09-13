import { readFileSync } from 'node:fs'

export const playtomicCatalogPath = new URL('../data/playtomic-clubs.json', import.meta.url)

export const validatePlaytomicCatalog = clubs => {
  if (!Array.isArray(clubs) || !clubs.length) throw new Error('Invalid Playtomic catalogue')
  const ids = new Set()
  const tenants = new Set()
  for (const club of clubs) {
    if (!/^casa-padel-[a-z0-9-]+$/.test(club.id) || !club.name?.startsWith('CASA PADEL ') || !/^[a-f0-9-]{36}$/.test(club.tenantId) || club.timeZone !== 'Europe/Paris' || club.environment !== 'indoor' || !Number.isInteger(club.resourceCount) || club.resourceCount <= 0 || ids.has(club.id) || tenants.has(club.tenantId)) throw new Error('Ambiguous or invalid Playtomic club')
    const url = new URL(club.url)
    if (url.origin !== 'https://playtomic.com' || url.pathname !== `/clubs/${club.id}`) throw new Error('Playtomic club URL differs from its ID')
    ids.add(club.id)
    tenants.add(club.tenantId)
  }
  return clubs
}

export const playtomicCatalog = validatePlaytomicCatalog(JSON.parse(readFileSync(playtomicCatalogPath, 'utf8')))
export const PLAYTOMIC_CLUBS = Object.fromEntries(playtomicCatalog.map(club => [club.id, club]))
export const playtomicClub = id => {
  const club = PLAYTOMIC_CLUBS[id]
  if (!club) throw new Error(`Unknown Playtomic club: ${id}`)
  return club
}

const centers = [
  {
    id: 'ucpa-paris',
    name: 'UCPA Sport Station Hostel Paris',
    accountSlug: 'paris-19',
    padelUrl: 'https://www.ucpa.com/sport-station/paris-19/mon-terrain-padel',
    workspace: 'alpha_hp',
    codeSiteComptage: '300001419',
    environment: 'indoor',
    calendarNavigationWeeks: 12,
  },
  {
    id: 'ucpa-meudon',
    name: 'UCPA Sport Station Meudon',
    accountSlug: 'meudon',
    padelUrl: 'https://www.ucpa.com/sport-station/meudon/padel',
    workspace: 'alpha_meu',
    codeSiteComptage: '400000636',
    environment: 'indoor',
    calendarNavigationWeeks: 24,
  },
]

export const UCPA_CENTERS = Object.freeze(centers.map(center => Object.freeze(center)))
export const DEFAULT_UCPA_CENTER = UCPA_CENTERS[0]
export const resolveUcpaCenter = (id = DEFAULT_UCPA_CENTER.id) => {
  const center = UCPA_CENTERS.find(item => item.id === id)
  if (!center) throw new Error(`Unknown UCPA club: ${id}. Use ${UCPA_CENTERS.map(item => item.id).join(' or ')}`)
  return center
}
export const ucpaAccountUrl = center => `https://www.ucpa.com/sport-station/espacepersonnel/${center.accountSlug}`
export const ucpaAccountApi = center => `${ucpaAccountUrl(center).replace('/espacepersonnel/', '/espacepersonnel/api/')}`
export const ucpaIdentityUrl = center => `${ucpaAccountApi(center)}/user`
export const ucpaReservationsUrl = center => `${ucpaAccountUrl(center)}/scheduled-reservations`

import { validateFourPadelCatalog } from './fourpadel-clubs.js'

const slug = name => name.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
export const discoverFourPadelClubs = async (page, previous) => {
  const source = 'https://www.4padel.fr/'
  await page.goto(source, { waitUntil: 'domcontentloaded' })
  const open = () => page.locator('.lf-local-bar-center-info').getByAltText('4Padel club', { exact: true }).click()
  const modal = page.locator('#centers-dropdown-modal')
  await open()
  await modal.waitFor()
  const listed = await modal.locator('.lf-centers-dropdown-item').evaluateAll(groups => groups.flatMap(group => [...group.querySelectorAll('.lf-center-name > span')].map(el => ({ name: el.textContent.trim(), region: group.querySelector('.lf-region-title')?.textContent.trim() }))))
  const centers = []
  for (const center of listed.filter(center => center.name.startsWith('4PADEL '))) {
    if (!await modal.isVisible()) await open()
    await modal.getByText(center.name, { exact: true }).click()
    await modal.waitFor({ state: 'hidden' })
    await page.waitForFunction(name => globalThis.document.querySelector('.lf-local-bar-info-btn')?.textContent.trim().toLowerCase() === name.toLowerCase(), center.name)
    const href = await page.locator('.lf-local-bar-center-info-btns a:has(.lf-local-bar-info-btn)').getAttribute('href')
    const match = href?.match(/^\/nos-centres\/(\d+)\//)
    if (!match) throw new Error('4PADEL centre link is missing its native ID')
    const centerId = Number(match[1])
    const existing = previous.centers.find(club => club.centerId === centerId)
    centers.push({ ...center, centerId, url: new URL(href, source).href, id: existing?.id || slug(center.name), timeZone: center.region === 'La Réunion' ? 'Indian/Reunion' : 'Europe/Paris' })
  }
  return validateFourPadelCatalog({ source, checkedAt: new Date().toISOString(), centers })
}

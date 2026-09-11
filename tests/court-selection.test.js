import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { chromium } from 'playwright'
import { selectCourtIfOffered } from '../lib/court-selection.js'

const option = (name, minutes, attributes = '', environment = 'Intérieur') => `<button data-testid="slot-court-option" ${attributes}><div><p>${name}</p><p><span>Double</span> · <span>${environment}</span></p></div><span>${minutes}min</span><span>60 €</span></button>`
const modal = (cards, { controls = '', selected = null } = {}) => `<div role="dialog"><h2>09:00</h2>${controls}<div id="courts">${cards}</div><button data-testid="slot-selection-confirm" ${selected ? '' : 'disabled'}>${selected ? 'Valider 60 €' : 'Sélectionnez un terrain'}</button></div><script>
  globalThis.chosen = ${JSON.stringify(selected)};
  globalThis.confirmations = 0;
  document.addEventListener('click', event => {
    const option = event.target.closest('[data-testid="slot-court-option"]');
    if (option) { globalThis.chosen = option.querySelector('p').textContent; document.querySelector('[data-testid="slot-selection-confirm"]').disabled = false; }
    if (event.target.closest('[data-testid="slot-selection-confirm"]')) {
      globalThis.confirmations++;
      document.querySelector('[role="dialog"]').remove();
      const sheet = document.createElement('section'); sheet.dataset.testid = 'booking-sheet'; sheet.textContent = globalThis.chosen; document.body.append(sheet);
    }
  });
</script>`

const withPage = async run => {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    page.setDefaultTimeout(1000)
    await run(page)
  } finally { await browser.close() }
}

test('every club supports both direct checkout and first-court selection without a court argument', () => withPage(async page => {
  const clubs = JSON.parse(readFileSync(new URL('../data/clubs.json', import.meta.url), 'utf8'))
  for (const club of clubs) {
    await page.setContent(`<section data-testid="booking-sheet">${club.name}<p>09:00 (60 min)</p></section>`)
    assert.deepEqual(await selectCourtIfOffered(page, { durationMinutes: 60 }), { usedModal: false, court: null, durationMinutes: 60 })
    await page.setContent(modal(option('Premier terrain', 60) + option('Deuxième terrain', 60)))
    const selected = await selectCourtIfOffered(page, { durationMinutes: 60 })
    assert.equal(selected.court, 'Premier terrain', club.id)
    assert.equal(selected.usedModal, true)
    assert.equal(await page.evaluate(() => globalThis.confirmations), 1)
  }
}))

test('duration selection precedes choosing the first visible enabled compatible court', () => withPage(async page => {
  const newCards = option('Masqué', 90, 'hidden') + option('Indisponible', 90, 'disabled') + option('Mauvaise durée', 60) + option('Premier 90', 90) + option('Suivant 90', 90)
  await page.setContent(modal(option('Ancienne offre 60', 60), {
    controls: `<button onclick='document.querySelector("#courts").innerHTML=${JSON.stringify(newCards)}'>90min 90 €</button>`,
  }))
  assert.equal((await selectCourtIfOffered(page, { durationMinutes: 90 })).court, 'Premier 90')
  assert.equal(await page.evaluate(() => globalThis.confirmations), 1)
}))

test('a single preselected court modal is validated instead of waiting for the selection prompt', () => withPage(async page => {
  await page.setContent(modal(option('Terrain unique', 60), { selected: 'Terrain unique' }))
  assert.deepEqual(await selectCourtIfOffered(page, { durationMinutes: 60 }), { usedModal: true, court: 'Terrain unique', durationMinutes: 60 })
  assert.equal(await page.evaluate(() => globalThis.confirmations), 1)
}))

test('explicit court remains an optional override; unavailable court or duration is never substituted', () => withPage(async page => {
  await page.setContent(modal(option('Premier terrain', 60) + option('Terrain demandé', 60)))
  assert.equal((await selectCourtIfOffered(page, { durationMinutes: 60, court: 'Terrain demandé' })).court, 'Terrain demandé')
  await page.setContent(modal(option('Premier terrain', 60)))
  await assert.rejects(selectCourtIfOffered(page, { durationMinutes: 60, court: 'Absent' }))
  assert.equal(await page.evaluate(() => globalThis.confirmations), 0)
  await page.setContent(modal(option('Premier terrain', 60), { controls: '<button disabled>90min Indispo</button>' }))
  await assert.rejects(selectCourtIfOffered(page, { durationMinutes: 90 }), /duration is unavailable/)
  assert.equal(await page.evaluate(() => globalThis.confirmations), 0)
}))


test('chooses first matching environment after duration filtering; any preserves display order', () => withPage(async page => {
  const cards = option('Outdoor first', 60, '', 'Extérieur') + option('Indoor first', 60) + option('Indoor next', 60)
  for (const [courtEnvironment, expected] of [[['any'], 'Outdoor first'], [['outdoor'], 'Outdoor first'], [['indoor'], 'Indoor first']]) {
    await page.setContent(modal(cards))
    assert.equal((await selectCourtIfOffered(page, { durationMinutes: 60, courtEnvironment })).court, expected)
  }
}))

test('missing environment and incompatible explicit court never fall back to another type', () => withPage(async page => {
  for (const environment of ['Extérieur', 'Non renseigné']) {
    await page.setContent(modal(option('First court', 60, '', environment)))
    await assert.rejects(selectCourtIfOffered(page, { durationMinutes: 60, courtEnvironment: ['indoor'] }), /No available court matches/)
    assert.equal(await page.evaluate(() => globalThis.confirmations), 0)
  }
  await page.setContent(modal(option('Requested outdoor', 60, '', 'Extérieur') + option('Other indoor', 60)))
  await assert.rejects(selectCourtIfOffered(page, { durationMinutes: 60, courtEnvironment: ['indoor'], court: 'Requested outdoor' }))
  assert.equal(await page.evaluate(() => globalThis.confirmations), 0)
}))

test('preferred settings rank environment before display order and fall back only among compatible available offers', () => withPage(async page => {
  for (const [courtEnvironment, primary, secondary, expectedPrimary, expectedSecondary] of [
    [['indoor', 'outdoor'], 'Intérieur', 'Extérieur', 'indoor', 'outdoor'],
    [['outdoor', 'indoor'], 'Extérieur', 'Intérieur', 'outdoor', 'indoor'],
  ]) {
    await page.setContent(modal(option('Secondary first on screen', 60, '', secondary) + option('Preferred first', 60, '', primary) + option('Preferred next', 60, '', primary)))
    assert.deepEqual(await selectCourtIfOffered(page, { durationMinutes: 60, courtEnvironment }), { usedModal: true, court: 'Preferred first', durationMinutes: 60, environment: expectedPrimary })
    for (const unavailablePrimary of [option('Disabled primary', 60, 'disabled', primary), option('Hidden primary', 60, 'hidden', primary), option('Wrong duration primary', 90, '', primary)]) {
      await page.setContent(modal(unavailablePrimary + option('Fallback', 60, '', secondary)))
      assert.deepEqual(await selectCourtIfOffered(page, { durationMinutes: 60, courtEnvironment }), { usedModal: true, court: 'Fallback', durationMinutes: 60, environment: expectedSecondary })
      assert.equal(await page.evaluate(() => globalThis.confirmations), 1)
    }
  }
}))

test('preferred settings respect an explicit court and do not treat unknown type as a fallback', () => withPage(async page => {
  await page.setContent(modal(option('Indoor first', 60) + option('Named outdoor', 60, '', 'Extérieur')))
  assert.deepEqual(await selectCourtIfOffered(page, { durationMinutes: 60, courtEnvironment: ['indoor', 'outdoor'], court: 'Named outdoor' }), { usedModal: true, court: 'Named outdoor', durationMinutes: 60, environment: 'outdoor' })
  for (const courtEnvironment of [['indoor', 'outdoor'], ['outdoor', 'indoor']]) {
    await page.setContent(modal(option('Unknown type', 60, '', 'Non renseigné')))
    await assert.rejects(selectCourtIfOffered(page, { durationMinutes: 60, courtEnvironment }), /No available court matches/)
    assert.equal(await page.evaluate(() => globalThis.confirmations), 0)
  }
}))

const durationModal = (offers, disabled = []) => modal(Object.values(offers).at(-1), {
  controls: Object.entries(offers).map(([minutes, cards]) => `<button ${disabled.includes(Number(minutes)) ? 'disabled' : ''} onclick='document.querySelector("#courts").innerHTML=${JSON.stringify(cards)}'>${minutes}min 60 €</button>`).join(''),
})

test('duration order takes priority over modal defaults; disabled choices fall back through the allowed list', () => withPage(async page => {
  const offers = { 60: option('Court 60', 60), 90: option('Court 90', 90), 120: option('Court 120', 120) }
  for (const [durationsMinutes, disabled, expected] of [
    [[60, 90, 120], [], 60], [[120, 60, 90], [], 120], [[90, 60], [], 90],
    [[60, 90, 120], [60], 90], [[60, 90, 120], [60, 90], 120],
  ]) {
    await page.setContent(durationModal(offers, disabled))
    const selected = await selectCourtIfOffered(page, { durationsMinutes })
    assert.equal(selected.durationMinutes, expected)
    assert.equal(selected.court, `Court ${expected}`)
    assert.equal(await page.evaluate(() => globalThis.confirmations), 1)
  }
}))

test('120 minutes is never selected when excluded, including direct checkout', () => withPage(async page => {
  await page.setContent(durationModal({ 120: option('Only 120', 120) }))
  await assert.rejects(selectCourtIfOffered(page, { durationsMinutes: [60, 90] }), /No available court matches/)
  assert.equal(await page.evaluate(() => globalThis.confirmations), 0)
  await page.setContent('<section data-testid="booking-sheet"><p>09:00 (120 min)</p></section>')
  await assert.rejects(selectCourtIfOffered(page, { durationsMinutes: [60, 90] }), /duration is excluded/)
  assert.equal((await selectCourtIfOffered(page, { durationsMinutes: [60, 90, 120] })).durationMinutes, 120)
}))

test('duration preference precedes environment preference but never bypasses a strict environment or named court', () => withPage(async page => {
  const offers = { 60: option('Outdoor 60', 60, '', 'Extérieur'), 90: option('Indoor 90', 90) }
  await page.setContent(durationModal(offers))
  assert.equal((await selectCourtIfOffered(page, { durationsMinutes: [60, 90], courtEnvironment: ['indoor', 'outdoor'] })).durationMinutes, 60)
  await page.setContent(durationModal(offers))
  assert.equal((await selectCourtIfOffered(page, { durationsMinutes: [60, 90], courtEnvironment: ['indoor'] })).durationMinutes, 90)
  await page.setContent(durationModal(offers))
  assert.equal((await selectCourtIfOffered(page, { durationsMinutes: [60, 90], court: 'Indoor 90' })).durationMinutes, 90)
}))

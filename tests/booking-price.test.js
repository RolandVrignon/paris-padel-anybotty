import assert from 'node:assert/strict'
import test from 'node:test'
import { checkoutPrice, validatePriceLimit, normalizePriceConfig } from '../lib/booking-price.js'
import { loadRequestConfig, resolveMaxPricePerHourEUR } from '../lib/config.js'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('hourly cap applies to the whole court and accepts exact boundaries for all durations', () => {
  for (const [duration, total, hourly] of [[60, 80, 80], [90, 120, 80], [120, 160, 80], [120, 120, 60]]) {
    const price = checkoutPrice(`Total à payer ${total} €`, duration, 80)
    assert.equal(price.totalEUR, total)
    assert.equal(price.pricePerHourEUR, hourly)
    assert.throws(() => checkoutPrice(`Total à payer ${duration * 80 / 60 + 0.01} €`, duration, 80), { code: 'PRICE_LIMIT' })
  }
  assert.equal(checkoutPrice('Total à payer 120,01 €', 90, null).totalCents, 12001)
  assert.equal(checkoutPrice('Total à payer 1\u202f200,50 €', 120).totalCents, 120050)
  // 80.0066 rounds to 80.01 for display but is still above an 80.00 cap.
  assert.throws(() => checkoutPrice('Total à payer 120,01 €', 90, 80), { code: 'PRICE_LIMIT' })
})

test('invalid budgets and ambiguous totals fail closed; legacy total limits require explicit migration', () => {
  for (const value of [-1, 0, '80', NaN, Infinity, 80.001]) assert.throws(() => validatePriceLimit(value), /maxPricePerHourEUR/)
  for (const total of ['Total à payer —', 'Total à payer 0 €', 'Total à payer 80,123 €', 'Total à payer 80 € Total à payer 90 €']) assert.throws(() => checkoutPrice(total, 60, 80))
  assert.throws(() => normalizePriceConfig({ maxTotalPriceEUR: 80 }), /Replace maxTotalPriceEUR/)
  assert.throws(() => normalizePriceConfig({ maxTotalPriceEUR: 80, maxPricePerHourEUR: 80 }), /Replace maxTotalPriceEUR/)
  assert.deepEqual(normalizePriceConfig({ maxTotalPriceEUR: null, maxPricePerHourEUR: 80 }), { maxPricePerHourEUR: 80 })
})

test('hourly limit is loaded from the chosen request file and supports preview overrides', t => {
  const root = mkdtempSync(join(tmpdir(), 'anybotty-price-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  assert.equal(resolveMaxPricePerHourEUR(undefined, { root, env: {} }), null)
  writeFileSync(join(root, 'config.request.json'), JSON.stringify({ maxPricePerHourEUR: 80 }))
  assert.equal(loadRequestConfig({ root, env: {} }).maxPricePerHourEUR, 80)
  assert.equal(resolveMaxPricePerHourEUR(undefined, { root, env: {} }), 80)
  assert.equal(resolveMaxPricePerHourEUR(60, { root, env: {} }), 60)
  writeFileSync(join(root, 'config.request.json'), JSON.stringify({ maxTotalPriceEUR: 80 }))
  assert.throws(() => loadRequestConfig({ root, env: {} }), /Replace maxTotalPriceEUR/)
})

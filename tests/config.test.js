import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { loadFixedConfig, loadRequestConfig, readConfig, splitLegacy, validateAccount, resolveCourtEnvironment } from '../lib/config.js'

const fixture = t => {
  const root = mkdtempSync(join(tmpdir(), 'anybotty-config-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const write = (name, value) => writeFileSync(join(root, name), JSON.stringify(value))
  return { root, write }
}
const account = { email: 'fixture@example.test', password: 'fixture-secret' }

test('fixed settings load independently of a request; request settings cannot override account', t => {
  const { root, write } = fixture(t)
  write('config.fixed.json', { account })
  assert.deepEqual(loadFixedConfig({ root, env: {} }).account, account)
  write('config.request.json', { date: '21/09/2026', account: { password: 'override' } })
  assert.throws(() => loadRequestConfig({ root, env: {} }), /Unsupported/)
  assert.deepEqual(loadFixedConfig({ root, env: {} }).account, account)
})

test('split request takes precedence and planning never reads credentials', t => {
  const { root, write } = fixture(t)
  write('config.json', { date: '21/09/2026', account })
  write('config.request.json', { date: '22/09/2026' })
  writeFileSync(join(root, 'config.fixed.json'), 'not JSON')
  assert.equal(loadRequestConfig({ root, env: {} }).date, '22/09/2026')
})

test('legacy compatibility separates fixed and variable data without leaking them', t => {
  const { root, write } = fixture(t)
  write('config.json', { account, date: '21/09/2026', durationsMinutes: [60, 90] })
  assert.deepEqual(loadRequestConfig({ root, env: {} }), { date: '21/09/2026', durationsMinutes: [60, 90] })
  assert.deepEqual(loadFixedConfig({ root, env: {} }).account, account)
  assert.deepEqual(splitLegacy({ account, date: '21/09/2026' }), { fixed: { account }, request: { date: '21/09/2026' } })
})

test('explicit missing paths do not silently fall back', t => {
  const { root, write } = fixture(t)
  write('config.json', { account })
  assert.throws(() => loadFixedConfig({ root, env: { ANYBOTTY_FIXED_CONFIG_PATH: join(root, 'missing.json') } }), /Cannot read/)
  assert.throws(() => loadRequestConfig({ root, env: { ANYBOTTY_REQUEST_CONFIG_PATH: join(root, 'missing.json') } }), /Cannot read/)
})

test('malformed JSON errors redact content; account validation emits no credential values', t => {
  const { root } = fixture(t)
  const path = join(root, 'bad.json')
  writeFileSync(path, '{"password":"private-password" invalid}')
  assert.throws(() => readConfig(path), error => !error.message.includes('private-password') && error.message.includes('Invalid JSON'))
  assert.throws(() => validateAccount({ account: { email: 'bad', password: 'secret' } }), /account.email/)
  assert.throws(() => validateAccount({ account: { email: account.email, password: '' } }), /account.password/)
  assert.doesNotThrow(() => validateAccount({ account: { email: account.email } }, { requirePassword: false }))
})


test('court environment comes from request configuration with a validated CLI override and compatible default', t => {
  const { root, write } = fixture(t)
  assert.deepEqual(resolveCourtEnvironment(undefined, { root, env: {} }), ['any'])
  write('config.request.json', { date: '21/09/2026' })
  assert.deepEqual(resolveCourtEnvironment(undefined, { root, env: {} }), ['any'])
  for (const courtEnvironment of [['any'], ['indoor'], ['outdoor'], ['indoor', 'outdoor'], ['outdoor', 'indoor']]) {
    write('config.request.json', { courtEnvironment })
    assert.deepEqual(loadRequestConfig({ root, env: {} }).courtEnvironment, courtEnvironment)
    assert.deepEqual(resolveCourtEnvironment(undefined, { root, env: {} }), courtEnvironment)
  }
  assert.deepEqual(resolveCourtEnvironment('indoor', { root, env: {} }), ['indoor'])
  for (const courtEnvironment of ['inside', null, true]) {
    write('config.request.json', { courtEnvironment })
    assert.throws(() => loadRequestConfig({ root, env: {} }), /courtEnvironment/)
    assert.throws(() => resolveCourtEnvironment(courtEnvironment, { root, env: {} }), /courtEnvironment/)
  }
  assert.throws(() => resolveCourtEnvironment(undefined, { root, env: { ANYBOTTY_REQUEST_CONFIG_PATH: join(root, 'missing.json') } }), /Cannot read/)
})

test('optional payment settings preserve string values and cannot enter a variable request', t => {
  const { root, write } = fixture(t)
  const payment = { cardholderName: '', cardNumber: '', expiryMonth: '01', expiryYear: '', cvc: '001', billingCountry: 'FR', billingPostalCode: '01000' }
  write('config.fixed.json', { account, payment })
  assert.deepEqual(loadFixedConfig({ root, env: {} }).payment, payment)
  write('config.request.json', { date: '21/09/2026', payment })
  assert.throws(() => loadRequestConfig({ root, env: {} }), /Unsupported/)
  const split = splitLegacy({ account, payment, date: '21/09/2026' })
  assert.deepEqual(split.fixed.payment, payment)
  assert.ok(!Object.hasOwn(split.request, 'payment'))
  for (const invalid of [null, [], { cardNumber: 123456789 }, { cardNumber: { private: 'never print' } }, { unexpected: 'never print' }]) {
    write('config.fixed.json', { account, payment: invalid })
    assert.throws(() => loadFixedConfig({ root, env: {} }), error => !error.message.includes('123456789') && !error.message.includes('never print'))
  }
})

test('optional 4PADEL credentials stay in fixed settings and preserve Anybuddy settings', t => {
  const { root, write } = fixture(t)
  const providers = { '4padel': { account: { email: 'four@example.test', password: 'private' } } }
  write('config.fixed.json', { account, providers })
  const config = loadFixedConfig({ root, env: {} })
  assert.deepEqual(config.account, account)
  assert.deepEqual(config.providers, providers)
  write('config.request.json', { providers })
  assert.throws(() => loadRequestConfig({ root, env: {} }), /Unsupported/)
  write('config.fixed.json', { providers: { unexpected: {} } })
  assert.throws(() => loadFixedConfig({ root, env: {} }), /Unsupported/)
})

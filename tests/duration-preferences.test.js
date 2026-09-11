import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseDurationsArgument, validateDurations } from '../lib/duration-preferences.js'
import { loadRequestConfig, resolveDurationsMinutes } from '../lib/config.js'

test('duration lists retain the exact priority order and reject unsupported or duplicate entries', () => {
  for (const list of [[60, 90, 120], [60, 90], [120, 60, 90], [90, 60], [120]]) {
    assert.deepEqual(validateDurations(list), list)
    assert.deepEqual(parseDurationsArgument(list.join(',')), list)
  }
  for (const value of [[], null, undefined, [60, 60], [30], [60, 180], ['60'], '60,90']) assert.throws(() => validateDurations(value), /durationsMinutes/)
  for (const value of ['', '60,', '60,,90', '60,90,60', '60 90', '60,90,180']) assert.throws(() => parseDurationsArgument(value))
})

test('preview reads duration priorities from config, permits explicit overrides and never adds 120 implicitly', t => {
  const root = mkdtempSync(join(tmpdir(), 'anybotty-durations-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  assert.deepEqual(resolveDurationsMinutes(undefined, { root, env: {} }), [60, 90])
  for (const durationsMinutes of [[120, 60, 90], [60, 90]]) {
    writeFileSync(join(root, 'config.request.json'), JSON.stringify({ durationsMinutes }))
    assert.deepEqual(loadRequestConfig({ root, env: {} }).durationsMinutes, durationsMinutes)
    assert.deepEqual(resolveDurationsMinutes(undefined, { root, env: {} }), durationsMinutes)
  }
  assert.deepEqual(resolveDurationsMinutes([90, 120], { root, env: {} }), [90, 120])
  writeFileSync(join(root, 'config.request.json'), JSON.stringify({ durationsMinutes: [60, 45] }))
  assert.throws(() => loadRequestConfig({ root, env: {} }), /durationsMinutes/)
  assert.throws(() => resolveDurationsMinutes(undefined, { root, env: { ANYBOTTY_REQUEST_CONFIG_PATH: join(root, 'missing.json') } }), /Cannot read/)
})

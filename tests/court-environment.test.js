import assert from 'node:assert/strict'
import test from 'node:test'
import { validateCourtEnvironment, getCourtEnvironmentOrder, parseCourtEnvironmentArgument } from '../lib/court-environment.js'

test('court environments preserve preference order and strict exclusions without mutating input', () => {
  for (const preferences of [['indoor', 'outdoor'], ['outdoor', 'indoor'], ['indoor'], ['outdoor'], ['any']]) {
    const input = Object.freeze(preferences)
    const result = validateCourtEnvironment(input)
    assert.deepEqual(result, input)
    assert.notEqual(result, input)
    assert.deepEqual(getCourtEnvironmentOrder(input), input[0] === 'any' ? null : input)
    assert.deepEqual(parseCourtEnvironmentArgument(input.join(',')), input)
  }
  assert.deepEqual(validateCourtEnvironment(), ['any'])
  assert.equal(getCourtEnvironmentOrder(), null)
})

test('legacy scalar settings normalize to ordered arrays', () => {
  for (const [legacy, expected] of [
    ['any', ['any']], ['indoor', ['indoor']], ['outdoor', ['outdoor']],
    ['indoor_preferred', ['indoor', 'outdoor']], ['outdoor_preferred', ['outdoor', 'indoor']],
  ]) {
    assert.deepEqual(validateCourtEnvironment(legacy), expected)
    assert.deepEqual(parseCourtEnvironmentArgument(legacy), expected)
  }
})

test('invalid or contradictory environment choices are rejected instead of broadening selection', () => {
  for (const value of [[], ['any', 'indoor'], ['outdoor', 'any'], ['indoor', 'indoor'], ['any', 'any'], ['inside'], ['indoor_preferred'], ['indoor', null], null, false, {}, 'toString', 'indoor,outdoor']) {
    assert.throws(() => validateCourtEnvironment(value), /courtEnvironment/)
  }
  for (const value of ['', 'indoor,', ',outdoor', 'any,indoor', 'outdoor,outdoor', 'indoor outdoor', 'inside']) {
    assert.throws(() => parseCourtEnvironmentArgument(value), /courtEnvironment/)
  }
  assert.deepEqual(parseCourtEnvironmentArgument(' outdoor, indoor '), ['outdoor', 'indoor'])
})

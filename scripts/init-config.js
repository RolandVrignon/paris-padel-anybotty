#!/usr/bin/env node
import { existsSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { readConfig, repositoryDirectory as root, splitLegacy } from '../lib/config.js'

try {
  const legacyPath = resolve(root, 'config.json')
  const legacy = existsSync(legacyPath) ? splitLegacy(readConfig(legacyPath)) : null
  const fixed = { ...readConfig(resolve(root, 'config.fixed.json.sample')), ...legacy?.fixed }
  const request = legacy?.request ?? readConfig(resolve(root, 'config.request.json.sample'))
  for (const [name, value] of [['config.fixed.json', fixed], ['config.request.json', request]]) {
    const path = resolve(root, name)
    if (existsSync(path)) { console.log(`${name}: preserved`); continue }
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
    console.log(`${name}: created (private local file)`)
  }
  if (legacy) console.log('Legacy config.json preserved; split files take precedence.')
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}

#!/usr/bin/env node
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const base = join(process.env.HERMES_HOME || join(homedir(), '.hermes'), 'skills')
const installed = []
for (const name of ['padel-booking', 'padel-clubs', 'padel-monitoring']) {
  const template = readFileSync(join(root, 'skills', name, 'SKILL.md'), 'utf8')
  if (!template.includes('{{PROJECT_DIR}}')) throw new Error(`Missing project placeholder in ${name}`)
  // These templates quote their project paths in shell examples.
  const shellRoot = root.replaceAll('\'', '\'\\\'\'')
  const rendered = template.replaceAll('{{PROJECT_DIR}}', shellRoot)
  const destination = join(base, name)
  mkdirSync(destination, { recursive: true, mode: 0o700 })
  const target = join(destination, 'SKILL.md')
  if (existsSync(target) && readFileSync(target, 'utf8') !== rendered) copyFileSync(target, join(destination, `SKILL.md.backup-${Date.now()}`))
  writeFileSync(target, rendered, { mode: 0o600 })
  chmodSync(target, 0o600)
  installed.push({ name, path: target })
}
console.log(JSON.stringify({ installed }, null, 2))

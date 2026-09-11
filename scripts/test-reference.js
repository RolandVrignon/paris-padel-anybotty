import { cpSync, mkdtempSync, readdirSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = fileURLToPath(new URL('..', import.meta.url))
const workspace = mkdtempSync(join(tmpdir(), 'anybotty-reference-'))
try {
  cpSync(join(root, 'reference/paris-tennis'), workspace, { recursive: true, filter: source => !source.split(/[\\/]/).includes('node_modules') })
  symlinkSync(join(root, 'node_modules'), join(workspace, 'node_modules'), 'dir')
  const tests = readdirSync(join(workspace, 'tests')).filter(name => name.endsWith('.test.js')).map(name => join('tests', name))
  const result = spawnSync(process.execPath, ['--test', ...tests], { cwd: workspace, stdio: 'inherit' })
  if (result.error) throw result.error
  process.exitCode = result.status ?? 1
} finally {
  rmSync(workspace, { recursive: true, force: true })
}

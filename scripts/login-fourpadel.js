#!/usr/bin/env node
import { createFourPadelSession } from '../lib/fourpadel-monitoring.js'
const args = process.argv.slice(2)
if (args.length > 1 || (args.length && args[0] !== '--headed')) throw new Error('Usage: node scripts/login-fourpadel.js [--headed]')
try {
  const session = await createFourPadelSession({ headed: args.includes('--headed') })
  await session.close()
  console.log('4PADEL session ready for official calendar monitoring')
} catch (error) { console.error(error.message); process.exitCode = 1 }

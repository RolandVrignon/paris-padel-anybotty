#!/usr/bin/env node
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { spawn } from 'node:child_process'
import { createJobStore } from '../lib/scheduled-booking.js'
import { calculateSchedule } from '../lib/booking-schedule.js'
import { scheduledBookingArgs } from '../lib/scheduled-wallet.js'
import { repositoryDirectory } from '../lib/config.js'

const directory = join(repositoryDirectory, '.auth/scheduled-bookings')
const store = createJobStore({ directory, scriptsDirectory: join(process.env.HERMES_HOME || join(homedir(), '.hermes'), 'scripts'), projectDirectory: repositoryDirectory })
const execute = (id, request, mode, provider = 'anybuddy', walletOnly = false) => new Promise((resolve, reject) => {
  const input = join(directory, `${id}.request.tmp`)
  writeFileSync(input, JSON.stringify(request), { mode: 0o600 })
  const args = walletOnly ? ['scripts/fourpadel.js', 'wallet'] : scheduledBookingArgs(request, mode, provider, input)
  args[0] = join(repositoryDirectory, args[0])
  const child = spawn(process.execPath, args, { cwd: repositoryDirectory, env: { ...process.env, ANYBOTTY_REQUEST_CONFIG_PATH: input }, stdio: ['ignore', 'pipe', 'pipe'], detached: true })
  const stop = () => { try { process.kill(-child.pid, 'SIGKILL') } catch { /* Already exited. */ } }
  const timer = setTimeout(stop, 90000)
  const interrupted = () => { stop(); process.exit(1) }
  process.once('SIGTERM', interrupted)
  process.once('SIGINT', interrupted)
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', data => { stdout += data })
  child.stderr.on('data', data => { stderr += data })
  child.on('error', reject)
  child.on('close', () => {
    clearTimeout(timer)
    process.removeListener('SIGTERM', interrupted)
    process.removeListener('SIGINT', interrupted)
    unlinkSync(input)
    writeFileSync(join(directory, `${id}.log`), stderr, { mode: 0o600 })
    try { resolve(JSON.parse(stdout)) } catch { reject(new Error('Search returned no structured result')) }
  })
})
try {
  const [command, ...args] = process.argv.slice(2)
  const options = {}
  for (let i = 0; i < args.length; i += 2) {
    if (!['--input', '--id', '--cron-job-id'].includes(args[i]) || !args[i + 1] || options[args[i]]) throw new Error('Invalid job arguments')
    options[args[i]] = args[i + 1]
  }
  const id = options['--id']
  let result
  if (command === 'prepare') {
    const input = JSON.parse(readFileSync(options['--input'], 'utf8'))
    const catalog = JSON.parse(readFileSync(new URL('../data/clubs.json', import.meta.url), 'utf8'))
    const plan = calculateSchedule(input, catalog)
    if (plan.status !== 'ready') result = plan
    else {
      let walletCheck
      if (plan.walletRequirement) {
        try { walletCheck = await execute(`wallet-prepare-${process.pid}`, {}, 'preview', '4padel', true) } catch { /* Preparation reports unknown balance without creating a job. */ }
      }
      result = store.prepare(input, catalog, { walletCheck })
    }
  }
  else if (command === 'attach-wallet') result = store.attachWallet(id, options['--cron-job-id'])
  else if (command === 'check-wallet') {
    result = await store.checkWallet(id, () => execute(`${id}-wallet`, {}, 'preview', '4padel', true))
    if (result.status !== 'skipped') {
      const check = result.walletCheck
      console.log(`Crédits 4PADEL — ${result.request.clubs[0]} le ${result.request.date} à ${result.request.startTime}. Tentative prévue : ${result.openingAt}. ${check.status === 'wallet_check_failed' ? 'Solde impossible à vérifier ; contrôler la connexion et relire le portefeuille.' : `Solde : ${check.balanceEUR} €. Provision cible : ${check.requiredEUR} €. ${check.missingEUR ? `Il manque ${check.missingEUR} € : recharge le portefeuille avant la tentative.` : 'Provision suffisante à cet instant.'}`} Aucun crédit réservé ; nouveau contrôle lors de la réservation. Suivi : ${id}`)
    }
  }
  else if (command === 'attach') result = store.attach(id, options['--cron-job-id'])
  else if (command === 'list') result = store.list()
  else if (command === 'show') result = store.read(id)
  else if (command === 'cancel') result = store.cancel(id)
  else if (command === 'run') {
    result = await store.run(id, (request, mode, provider) => execute(id, request, mode, provider))
    if (result.status !== 'skipped') console.log(`Padel — ${result.request?.clubs.join(', ')} le ${result.request?.date} à ${result.request?.startTime} : ${result.status}. ${result.reservationConfirmed ? `Réservation confirmée chez ${result.provider ?? 'anybuddy'}.` : result.mode === 'pay' ? 'Réservation non confirmée ; consulter le résultat avant toute relance.' : 'Simulation sans paiement.'} Suivi : ${id}`)
  } else throw new Error('Usage: booking-jobs.js prepare|attach|attach-wallet|check-wallet|list|show|cancel|run [--input PATH] [--id ID] [--cron-job-id ID]')
  if (!['run', 'check-wallet'].includes(command)) console.log(JSON.stringify(result, null, 2))
} catch (error) {
  console.error(error instanceof SyntaxError ? 'Invalid scheduling JSON' : error.message)
  process.exitCode = 1
}

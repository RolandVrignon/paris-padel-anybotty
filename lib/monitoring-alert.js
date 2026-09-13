import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'

const send = (command, args, message) => new Promise(resolve => {
  const child = spawn(command, args, { stdio: ['pipe', 'ignore', 'ignore'], timeout: 20000 })
  child.on('error', () => resolve(false))
  child.stdin.on('error', () => {})
  child.on('close', code => resolve(code === 0))
  child.stdin.end(message)
})
export const notifyMonitoringAlert = async (record, { target = process.env.ANYBOTTY_ALERT_TARGET, command = process.env.ANYBOTTY_HERMES_BIN || join(homedir(), '.local/bin/hermes'), deliver = send } = {}) => {
  if (!record.monitoringAlert) return 'not_needed'
  if (!target) return 'not_configured'
  const message = `Anybotty : surveillance ${record.provider} suspendue jusqu’au ${record.nextRetryAt}. ${record.monitoringAlert.type === 'access_restricted' ? 'Le site a restreint l’accès.' : 'La session ne peut plus être vérifiée.'} Aucun essai de réservation ni paiement. Vérifier le suivi et, si nécessaire, reconnecter le compte avant la reprise.`
  try { return await deliver(command, ['send', '--to', target, '--quiet'], message) ? 'delivered' : 'failed' } catch { return 'failed' }
}

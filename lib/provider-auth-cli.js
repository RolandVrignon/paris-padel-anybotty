import { ProviderAuthError } from './provider-session.js'

export const parseProviderAuthArgs = args => {
  const accepted = ['--headed', '--headless', '--check', '--manual', '--fresh']
  const invalid = args.some(arg => !accepted.includes(arg)) || new Set(args).size !== args.length
  const conflicting = (args.includes('--headed') && args.includes('--headless')) || (args.includes('--check') && (args.includes('--manual') || args.includes('--fresh')))
  if (invalid || conflicting) throw new Error('Usage: login provider [--headed|--headless] [--check|--manual|--fresh]')
  if (args.includes('--manual') && !args.includes('--headed')) throw new Error('--manual requires --headed')
  return { headed: args.includes('--headed'), checkOnly: args.includes('--check'), manual: args.includes('--manual'), fresh: args.includes('--fresh') }
}
export const runProviderAuth = async (provider, createSession, args = process.argv.slice(2)) => {
  let session
  try {
    const options = parseProviderAuthArgs(args)
    if (options.manual) console.error(`Complete ${provider} login in Chromium; waiting up to three minutes.`)
    session = await createSession(options)
    console.log(JSON.stringify({ provider, status: 'authenticated', identityVerified: true, sessionSaved: session.sessionSaved, checkedAt: new Date().toISOString() }))
  } catch (error) {
    console.log(JSON.stringify({ provider, status: error instanceof ProviderAuthError ? error.code : 'authentication_error', message: error instanceof ProviderAuthError || error.message.startsWith('Usage:') || error.message === '--manual requires --headed' ? error.message : 'Provider authentication failed; check configuration and inspect with --headed' }))
    process.exitCode = 1
  } finally { await session?.close() }
}

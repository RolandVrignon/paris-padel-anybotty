#!/usr/bin/env node
import { loadFixedConfig } from '../lib/config.js'
import { validateCardConfig } from '../lib/stripe-card.js'
try {
  validateCardConfig(loadFixedConfig().payment)
  console.log(JSON.stringify({ status: 'configured', note: 'Local card fields are valid; no bank request was made.' }))
} catch {
  console.log(JSON.stringify({ status: 'not_configured', note: 'Complete payment fields in the private fixed config on this host. Never send card details in chat.' }))
  process.exitCode = 1
}

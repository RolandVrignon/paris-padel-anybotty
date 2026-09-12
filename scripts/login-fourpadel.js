#!/usr/bin/env node
import { createFourPadelSession } from '../lib/fourpadel-session.js'
import { runProviderAuth } from '../lib/provider-auth-cli.js'
await runProviderAuth('4padel', createFourPadelSession)

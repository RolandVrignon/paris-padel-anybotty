#!/usr/bin/env node
import { createUcpaSession } from '../lib/ucpa-session.js'
import { runProviderAuth } from '../lib/provider-auth-cli.js'
await runProviderAuth('ucpa', createUcpaSession)

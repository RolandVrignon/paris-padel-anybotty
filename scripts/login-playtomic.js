#!/usr/bin/env node
import { runProviderAuth } from '../lib/provider-auth-cli.js'
import { createPlaytomicSession } from '../lib/playtomic-session.js'

await runProviderAuth('playtomic', createPlaytomicSession)

#!/usr/bin/env node

import { run } from '../lib/index.js'

process.on('unhandledRejection', (reason) => {
  const message = reason instanceof Error ? reason.message : String(reason)
  process.stderr.write(`✘ ${message}\n`)
  if (process.env.MOKEI_DEBUG === '1' && reason instanceof Error && reason.stack != null) {
    process.stderr.write(`${reason.stack}\n`)
  }
  process.exitCode = 1
})

await run(process.argv)

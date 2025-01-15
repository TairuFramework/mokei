import { parseArgs } from 'node:util'

import { startServer } from './server.js'

const args = parseArgs({ options: { path: { type: 'string', short: 'p' } } })

try {
  await startServer({ socketPath: args.values.path })
  console.log('OK')
} catch (error) {
  console.log((error as { code: string }).code)
  process.exit(1)
}

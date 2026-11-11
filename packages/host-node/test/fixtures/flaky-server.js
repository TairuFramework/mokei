import { appendFileSync } from 'node:fs'
import { createTool } from '@mokei/context-server'
import { serveProcess } from '@mokei/context-server-node'

// Stdio MCP server that can be made to die, for the reconnect tests.
// - `--log <file>`: appends one JSON line `{ pid, args }` per start, so a test counts spawns.
// - `--die-after-ms <ms>`: exits with code 1 that long after starting.
// - `crash` tool: exits with code 1 without answering.
// - `garble` tool: writes a line of invalid JSON to stdout without answering.
// - `pid` tool: answers with the process id, so a test tells generations apart.
const args = process.argv.slice(2)

function option(name) {
  const index = args.indexOf(name)
  return index === -1 ? undefined : args[index + 1]
}

const log = option('--log')
if (log != null) {
  appendFileSync(log, `${JSON.stringify({ pid: process.pid, args })}\n`)
}

const dieAfterMs = option('--die-after-ms')
if (dieAfterMs != null) {
  setTimeout(() => process.exit(1), Number(dieAfterMs))
}

const config = {
  name: 'flaky',
  version: '0.0.0',
  protocolVersions: ['2026-07-28', '2025-11-25'],
  tools: {
    crash: createTool({
      description: 'Exit the server process',
      inputSchema: { type: 'object', additionalProperties: false },
      handler: () => {
        process.exit(1)
      },
    }),
    garble: createTool({
      description: 'Break the stdout framing',
      inputSchema: { type: 'object', additionalProperties: false },
      handler: () => {
        process.stdout.write('invalid JSON\n')
        return new Promise(() => {})
      },
    }),
    pid: createTool({
      description: 'Return the server process id',
      inputSchema: { type: 'object', additionalProperties: false },
      handler: () => ({ content: [{ type: 'text', text: String(process.pid) }] }),
    }),
  },
}

serveProcess(config)

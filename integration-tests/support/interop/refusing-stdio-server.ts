/**
 * Stdio entry point that answers every request with `-32601`, including `server/discover` and
 * `initialize`. Drives the client setup path where an `'auto'` probe falls back and the
 * handshake that follows also fails, which must dispose the transport and reap this process.
 *
 * Hand-rolled rather than built on `serveProcess`: no `ServerConfig` produces a server that
 * refuses `initialize` *and* `server/discover`.
 */
import { createInterface } from 'node:readline'

const lines = createInterface({ input: process.stdin })

lines.on('line', (line) => {
  if (line.trim() === '') {
    return
  }
  const message = JSON.parse(line) as { id?: string | number; method?: string }
  if (message.id == null) {
    return
  }
  const response = {
    jsonrpc: '2.0',
    id: message.id,
    error: { code: -32601, message: `Unsupported method: ${message.method}` },
  }
  process.stdout.write(`${JSON.stringify(response)}\n`)
})

// Exit on stdin EOF, which is what disposing the client transport produces.
lines.on('close', () => {
  process.exit(0)
})

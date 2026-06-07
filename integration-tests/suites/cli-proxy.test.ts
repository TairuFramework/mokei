import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, test } from 'vitest'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const CLI_CWD = resolve(ROOT, 'packages/cli')
const CLI_BINARY = resolve(CLI_CWD, 'bin/dev.js')
const FETCH_SERVER = resolve(ROOT, 'mcp-servers/fetch/lib/serve.js')

function proxyRoundTrip(
  request: Record<string, unknown>,
): Promise<{ stdout: Buffer; hasAnsi: boolean }> {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [CLI_BINARY, 'proxy', 'node', FETCH_SERVER], {
      cwd: CLI_CWD,
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    const chunks: Array<Buffer> = []
    child.stdout.on('data', (d: Buffer) => chunks.push(d))

    // The proxy transport (@enkaku/node-streams-transport) frames messages as
    // newline-delimited JSON (JSON Lines), not Content-Length framing.
    child.stdin.write(`${JSON.stringify(request)}\n`)

    setTimeout(() => {
      child.kill()
      const stdout = Buffer.concat(chunks)
      const hasAnsi = stdout.includes(0x1b)
      resolve({ stdout, hasAnsi })
    }, 5_000)

    child.on('error', reject)
  })
}

describe('CLI proxy — stdio round-trip', () => {
  test('MCP initialize returns a JSON-RPC response with zero ANSI bytes', async () => {
    const request = {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test', version: '0.0.1' },
      },
    }

    const { stdout, hasAnsi } = await proxyRoundTrip(request)
    expect(hasAnsi).toBe(false)

    const text = stdout.toString('utf8')
    const line = text.split('\n').find((part) => part.trim().length > 0)
    expect(line).toBeDefined()
    const response = JSON.parse(line as string) as Record<string, unknown>
    expect(response.jsonrpc).toBe('2.0')
    expect(response.id).toBe(1)
    expect(response.result).toBeDefined()
  }, 15_000)
})

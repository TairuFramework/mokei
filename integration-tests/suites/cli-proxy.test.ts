import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, test } from 'vitest'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const CLI_CWD = resolve(ROOT, 'packages/cli')
const CLI_BINARY = resolve(CLI_CWD, 'bin/dev.js')
const FETCH_SERVER = resolve(ROOT, 'mcp-servers/fetch/lib/serve.js')

// `mokei proxy` goes through the host daemon, which binds the per-user default socket. Point the
// daemon's data, state and log dirs at a private temp dir so the test never reuses a daemon left
// running by another checkout (a stale one silently drops the spawn channel), and never leaves
// its own daemon behind on the user's socket.
const DAEMON_DIR = mkdtempSync(join(tmpdir(), 'mokei-proxy-'))
const DAEMON_ENV = {
  ...process.env,
  MOKEI_DATA_DIR: DAEMON_DIR,
  MOKEI_STATE_DIR: DAEMON_DIR,
  MOKEI_LOG_DIR: DAEMON_DIR,
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

afterAll(async () => {
  try {
    const state = JSON.parse(readFileSync(join(DAEMON_DIR, 'mokei.pid'), 'utf8')) as { pid: number }
    process.kill(state.pid, 'SIGTERM')
    // Wait for the daemon's own cleanup, which would otherwise race the directory removal
    for (let i = 0; i < 50 && isAlive(state.pid); i++) {
      await new Promise((r) => setTimeout(r, 50))
    }
  } catch {
    // No daemon started, or it already exited
  }
  rmSync(DAEMON_DIR, { recursive: true, force: true })
})

function proxyRoundTrip(
  request: Record<string, unknown>,
  args: Array<string> = [CLI_BINARY, 'proxy', process.execPath, FETCH_SERVER],
): Promise<{ stdout: Buffer; hasAnsi: boolean }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: CLI_CWD,
      env: DAEMON_ENV,
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    const chunks: Array<Buffer> = []
    const errors: Array<Buffer> = []
    let received = false
    let failure: Error | undefined
    const timer = setTimeout(() => {
      failure = new Error(`Proxy response timed out: ${Buffer.concat(errors).toString('utf8')}`)
      child.kill()
    }, 15_000)
    child.stdout.on('data', (chunk: Buffer) => {
      chunks.push(chunk)
      const completeLines = Buffer.concat(chunks).toString('utf8').split('\n').slice(0, -1)
      if (!received && completeLines.some((line) => line.trim().length > 0)) {
        received = true
        clearTimeout(timer)
        child.kill()
      }
    })
    child.stderr.on('data', (chunk: Buffer) => errors.push(chunk))
    child.stdin.on('error', (error: Error) => {
      failure = error
      child.kill()
    })
    child.on('error', (error: Error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code, signal) => {
      clearTimeout(timer)
      if (failure != null || !received) {
        reject(
          failure ??
            new Error(
              `Proxy exited before a response (${code ?? signal}): ${Buffer.concat(errors).toString('utf8')}`,
            ),
        )
        return
      }
      const stdout = Buffer.concat(chunks)
      resolve({ stdout, hasAnsi: stdout.includes(0x1b) })
    })

    // The proxy transport (@enkaku/node-streams) frames messages as
    // newline-delimited JSON (JSON Lines), not Content-Length framing.
    child.stdin.write(`${JSON.stringify(request)}\n`)
  })
}

describe('CLI proxy — stdio round-trip', () => {
  test('waits for a complete response after delayed subprocess startup', async () => {
    const { stdout, hasAnsi } = await proxyRoundTrip({ jsonrpc: '2.0', id: 1 }, [
      '-e',
      `process.stdin.once('data', () => {
        setTimeout(() => {
          process.stdout.write('{"jsonrpc":"2.0",');
          setTimeout(() => process.stdout.write('"id":1,"result":{}}\\n'), 50);
        }, 5500);
      });`,
    ])
    expect(hasAnsi).toBe(false)
    expect(JSON.parse(stdout.toString('utf8').trim())).toEqual({
      jsonrpc: '2.0',
      id: 1,
      result: {},
    })
  }, 20_000)

  test('reports subprocess failure with stderr instead of accepting empty output', async () => {
    await expect(
      proxyRoundTrip({ jsonrpc: '2.0', id: 1 }, [
        '-e',
        "process.stderr.write('proxy startup failed'); process.exit(1)",
      ]),
    ).rejects.toThrow('proxy startup failed')
  }, 20_000)

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
  }, 30_000)
})

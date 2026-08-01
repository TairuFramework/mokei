import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

import {
  MOKEI_STDIO_SERVER_2025_11_25_PATH,
  MOKEI_STDIO_SERVER_2026_07_28_PATH,
} from '../support/interop/servers.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const CLI_CWD = resolve(ROOT, 'packages/cli')
const CLI_BINARY = resolve(CLI_CWD, 'bin/dev.js')
const FETCH_SERVER = resolve(ROOT, 'mcp-servers/fetch/lib/serve.js')

function runInspect(args: Array<string>): Promise<{ stdout: string; code: number | null }> {
  return new Promise((resolve) => {
    const child = spawn('node', [CLI_BINARY, 'inspect', ...args], { cwd: CLI_CWD })
    let stdout = ''
    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString()
    })
    child.on('close', (code) => resolve({ stdout, code }))
  })
}

describe('CLI inspect', () => {
  test('inspect shows server capabilities', async () => {
    const { stdout, code } = await runInspect(['node', FETCH_SERVER])
    expect(code).toBe(0)
    // `@mokei/mcp-fetch` serves both revisions, so the default `auto` probe settles on
    // `2026-07-28` and `server/discover` answers instead of the handshake.
    expect(stdout).toContain('discovered')
    expect(stdout).toContain('capabilities')
  }, 30_000)

  test('inspects a 2026-07-28 server', async () => {
    const { stdout, code } = await runInspect([
      '--protocol',
      '2026-07-28',
      'node',
      MOKEI_STDIO_SERVER_2026_07_28_PATH,
    ])
    expect(code).toBe(0)
    expect(stdout).toContain('discovered')
    expect(stdout).toContain('supportedVersions')
    expect(stdout).toContain('2026-07-28')
  }, 30_000)

  test('auto-detects a 2025-11-25-only server', async () => {
    const { stdout, code } = await runInspect(['node', MOKEI_STDIO_SERVER_2025_11_25_PATH])
    expect(code).toBe(0)
    // The fallback path: `server/discover` is refused, and `initialize` answers instead.
    expect(stdout).toContain('initialized')
    expect(stdout).toContain('2025-11-25')
  }, 30_000)

  test('a pinned 2026-07-28 inspect fails against a 2025-11-25-only server', async () => {
    const { code } = await runInspect([
      '--protocol',
      '2026-07-28',
      'node',
      MOKEI_STDIO_SERVER_2025_11_25_PATH,
    ])
    expect(code).not.toBe(0)
  }, 30_000)

  test('a pinned 2025-11-25 inspect uses the handshake against a both-revision server', async () => {
    const { stdout, code } = await runInspect(['--protocol', '2025-11-25', 'node', FETCH_SERVER])
    expect(code).toBe(0)
    expect(stdout).toContain('initialized')
    expect(stdout).toContain('2025-11-25')
  }, 30_000)

  test('inspect exits non-zero for an invalid command', async () => {
    const { code } = await runInspect(['nonexistent-binary-that-does-not-exist'])
    expect(code).not.toBe(0)
  }, 15_000)
})

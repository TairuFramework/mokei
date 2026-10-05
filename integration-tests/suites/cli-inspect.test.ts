import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

import { CLI_CWD, runCLI } from '../support/flow-cli/run-cli.js'
import {
  MOKEI_STDIO_SERVER_2025_11_25_PATH,
  MOKEI_STDIO_SERVER_2026_07_28_PATH,
} from '../support/interop/servers.ts'

const FETCH_SERVER = resolve(CLI_CWD, '../../mcp-servers/fetch/lib/serve.js')

describe('CLI inspect', () => {
  test('inspect shows server capabilities', async () => {
    const { stdout, code } = await runCLI(['inspect', 'node', FETCH_SERVER])
    expect(code).toBe(0)
    // `@mokei/mcp-fetch` serves both revisions, so the default `auto` probe settles on
    // `2026-07-28` and `server/discover` answers instead of the handshake.
    expect(stdout).toContain('discovered')
    expect(stdout).toContain('capabilities')
  }, 30_000)

  test('inspects a 2026-07-28 server', async () => {
    const { stdout, code } = await runCLI([
      'inspect',
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
    const { stdout, code } = await runCLI(['inspect', 'node', MOKEI_STDIO_SERVER_2025_11_25_PATH])
    expect(code).toBe(0)
    // The fallback path: `server/discover` is refused, and `initialize` answers instead.
    expect(stdout).toContain('initialized')
    expect(stdout).toContain('2025-11-25')
  }, 30_000)

  test('a pinned 2026-07-28 inspect fails against a 2025-11-25-only server', async () => {
    const { stdout, code } = await runCLI([
      'inspect',
      '--protocol',
      '2026-07-28',
      'node',
      MOKEI_STDIO_SERVER_2025_11_25_PATH,
    ])
    expect(code).not.toBe(0)
    // Asserting the reason, not just the exit code: a pinned revision must report the
    // server's own refusal rather than fall back to a handshake it was told not to speak.
    // Every wrong behaviour here -- falling back, or swallowing the error and reporting
    // success -- still exits non-zero or prints a different message, so the exit code alone
    // would prove nothing.
    expect(stdout).toMatch(/unsupported protocol version/i)
    expect(stdout).not.toContain('discovered')
    expect(stdout).not.toContain('initialized')
  }, 30_000)

  test('inspect rejects an unsupported --protocol value before spawning', async () => {
    const { stdout, code } = await runCLI([
      'inspect',
      '--protocol',
      '2024-11-05',
      'node',
      MOKEI_STDIO_SERVER_2026_07_28_PATH,
    ])
    expect(code).not.toBe(0)
    expect(stdout).toContain('2024-11-05')
  }, 30_000)

  test('a pinned 2025-11-25 inspect uses the handshake against a both-revision server', async () => {
    const { stdout, code } = await runCLI([
      'inspect',
      '--protocol',
      '2025-11-25',
      'node',
      FETCH_SERVER,
    ])
    expect(code).toBe(0)
    expect(stdout).toContain('initialized')
    expect(stdout).toContain('2025-11-25')
  }, 30_000)

  test('inspect exits non-zero for an invalid command', async () => {
    const { code } = await runCLI(['inspect', 'nonexistent-binary-that-does-not-exist'])
    expect(code).not.toBe(0)
  }, 15_000)
})

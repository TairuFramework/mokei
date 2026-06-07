import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, test } from 'vitest'

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
    expect(stdout).toContain('initialized')
    expect(stdout).toContain('capabilities')
  }, 30_000)

  test('inspect exits non-zero for an invalid command', async () => {
    const { code } = await runInspect(['nonexistent-binary-that-does-not-exist'])
    expect(code).not.toBe(0)
  }, 15_000)
})

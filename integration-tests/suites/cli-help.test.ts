import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, test } from 'vitest'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const CLI_CWD = resolve(ROOT, 'packages/cli')
const CLI_BINARY = resolve(CLI_CWD, 'bin/dev.js')

function runCLI(
  args: Array<string>,
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve) => {
    const child = spawn('node', [CLI_BINARY, ...args], { cwd: CLI_CWD })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString()
    })
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString()
    })
    child.on('close', (code) => resolve({ stdout, stderr, code }))
  })
}

describe('CLI help and version', () => {
  test('--help lists all 4 commands', async () => {
    const { stdout } = await runCLI(['--help'])
    expect(stdout).toContain('chat')
    expect(stdout).toContain('inspect')
    expect(stdout).toContain('monitor')
    expect(stdout).toContain('proxy')
  })

  test('--version outputs a semver string', async () => {
    const { stdout } = await runCLI(['--version'])
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+/)
  })

  test('chat --help shows provider and model options', async () => {
    const { stdout } = await runCLI(['chat', '--help'])
    expect(stdout).toContain('--provider')
    expect(stdout).toContain('--model')
    expect(stdout).toContain('--api-key')
    expect(stdout).toContain('--api-url')
    expect(stdout).toContain('--timeout')
  })
})

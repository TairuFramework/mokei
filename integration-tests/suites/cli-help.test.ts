import { describe, expect, test } from 'vitest'

import { runCLI } from '../support/flow-cli/run-cli.js'

describe('CLI help and version', () => {
  test('--help lists every command', async () => {
    const { stdout } = await runCLI(['--help'])
    for (const command of [
      'chat',
      'inspect',
      'monitor',
      'proxy',
      'daemon',
      'flows',
      'runs',
      'inbox',
    ]) {
      expect(stdout).toMatch(new RegExp(`^\\s+${command}\\b`, 'm'))
    }
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

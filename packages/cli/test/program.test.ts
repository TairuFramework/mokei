import type { Command } from 'commander'
import { describe, expect, test, vi } from 'vitest'

import { run } from '../src/index.js'
import { buildProgram } from '../src/program.js'

/**
 * Configure a program (and its subcommands) to throw on error/exit and capture
 * output instead of writing to the real streams, so usage errors can be
 * asserted without exiting the test process.
 */
function captureProgram(program: Command): { out: Array<string>; err: Array<string> } {
  const out: Array<string> = []
  const err: Array<string> = []
  const configure = (command: Command): void => {
    command.exitOverride()
    command.configureOutput({
      writeOut: (str) => out.push(str),
      writeErr: (str) => err.push(str),
    })
    for (const child of command.commands) {
      configure(child)
    }
  }
  configure(program)
  return { out, err }
}

describe('buildProgram', () => {
  const program = buildProgram()
  const commandNames = program.commands.map((c) => c.name())

  test('exposes exactly 4 commands', () => {
    expect(commandNames).toEqual(['chat', 'inspect', 'monitor', 'proxy'])
  })

  test('chat has --provider with short -p', () => {
    const chat = program.commands.find((c) => c.name() === 'chat')
    const opt = chat?.options.find((o) => o.long === '--provider')
    expect(opt).toBeDefined()
    expect(opt?.short).toBe('-p')
  })

  test('chat has --api-key with short -k', () => {
    const chat = program.commands.find((c) => c.name() === 'chat')
    const opt = chat?.options.find((o) => o.long === '--api-key')
    expect(opt).toBeDefined()
    expect(opt?.short).toBe('-k')
  })

  test('chat has --api-url with short -u', () => {
    const chat = program.commands.find((c) => c.name() === 'chat')
    const opt = chat?.options.find((o) => o.long === '--api-url')
    expect(opt).toBeDefined()
    expect(opt?.short).toBe('-u')
  })

  test('chat has --model with short -m', () => {
    const chat = program.commands.find((c) => c.name() === 'chat')
    const opt = chat?.options.find((o) => o.long === '--model')
    expect(opt).toBeDefined()
    expect(opt?.short).toBe('-m')
  })

  test('chat has --timeout with short -t', () => {
    const chat = program.commands.find((c) => c.name() === 'chat')
    const opt = chat?.options.find((o) => o.long === '--timeout')
    expect(opt).toBeDefined()
    expect(opt?.short).toBe('-t')
  })

  test('inspect accepts a required command argument and variadic args', () => {
    const inspect = program.commands.find((c) => c.name() === 'inspect')
    const args = inspect?.registeredArguments ?? []
    expect(args.length).toBe(2)
    expect(args[0]?.required).toBe(true)
    expect(args[1]?.variadic).toBe(true)
  })

  test('proxy accepts a required command argument and variadic args', () => {
    const proxy = program.commands.find((c) => c.name() === 'proxy')
    const args = proxy?.registeredArguments ?? []
    expect(args.length).toBe(2)
    expect(args[0]?.required).toBe(true)
    expect(args[1]?.variadic).toBe(true)
  })

  test('monitor has --socket-path with short -s and --port with short -p', () => {
    const monitor = program.commands.find((c) => c.name() === 'monitor')
    const pathOpt = monitor?.options.find((o) => o.long === '--socket-path')
    expect(pathOpt).toBeDefined()
    expect(pathOpt?.short).toBe('-s')
    const portOpt = monitor?.options.find((o) => o.long === '--port')
    expect(portOpt).toBeDefined()
    expect(portOpt?.short).toBe('-p')
  })

  test('proxy has --socket-path with short -s', () => {
    const proxy = program.commands.find((c) => c.name() === 'proxy')
    const pathOpt = proxy?.options.find((o) => o.long === '--socket-path')
    expect(pathOpt).toBeDefined()
    expect(pathOpt?.short).toBe('-s')
  })

  test('program has --version flag', () => {
    const versionOpt = program.options.find((o) => o.long === '--version' || o.short === '-v')
    expect(versionOpt).toBeDefined()
  })
})

describe('CLI usage behavior', () => {
  test('no-arg invocation prints help to stdout and exits 0', async () => {
    const writes: Array<string> = []
    const spy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation((chunk: string | Uint8Array) => {
        writes.push(String(chunk))
        return true
      })
    try {
      await expect(run(['node', 'mokei'])).resolves.toBeUndefined()
    } finally {
      spy.mockRestore()
    }
    const output = writes.join('')
    expect(output).toContain('Usage: mokei')
    expect(output).toContain('chat')
  })

  test('missing required argument prints the subcommand help after the error', () => {
    const program = buildProgram()
    const { err } = captureProgram(program)
    expect(() => program.parse(['node', 'mokei', 'inspect'])).toThrow()
    const output = err.join('')
    expect(output).toContain("missing required argument 'command'")
    expect(output).toContain('Usage: mokei inspect')
  })

  test('unknown option prints the subcommand help after the error', () => {
    const program = buildProgram()
    const { err } = captureProgram(program)
    expect(() => program.parse(['node', 'mokei', 'chat', '--bogus'])).toThrow()
    const output = err.join('')
    expect(output).toContain("unknown option '--bogus'")
    expect(output).toContain('Usage: mokei chat')
  })

  test('unknown command reports "unknown command" (not "too many arguments")', () => {
    const program = buildProgram()
    const { err } = captureProgram(program)
    expect(() => program.parse(['node', 'mokei', 'bogus'])).toThrow()
    const output = err.join('')
    expect(output).toContain("unknown command 'bogus'")
    expect(output).not.toContain('too many arguments')
  })
})

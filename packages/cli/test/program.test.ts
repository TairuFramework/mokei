import { describe, expect, test } from 'vitest'

import { buildProgram } from '../src/program.js'

describe('buildProgram', () => {
  const program = buildProgram()
  const commandNames = program.commands.map((c) => c.name())

  test('exposes exactly 4 commands', () => {
    expect(commandNames).toEqual(['chat', 'inspect', 'monitor', 'proxy'])
  })

  test('chat has --provider with short -p', () => {
    const chat = program.commands.find((c) => c.name() === 'chat')!
    const opt = chat.options.find((o) => o.long === '--provider')
    expect(opt).toBeDefined()
    expect(opt!.short).toBe('-p')
  })

  test('chat has --api-key with short -k', () => {
    const chat = program.commands.find((c) => c.name() === 'chat')!
    const opt = chat.options.find((o) => o.long === '--api-key')
    expect(opt).toBeDefined()
    expect(opt!.short).toBe('-k')
  })

  test('chat has --api-url with short -u', () => {
    const chat = program.commands.find((c) => c.name() === 'chat')!
    const opt = chat.options.find((o) => o.long === '--api-url')
    expect(opt).toBeDefined()
    expect(opt!.short).toBe('-u')
  })

  test('chat has --model with short -m', () => {
    const chat = program.commands.find((c) => c.name() === 'chat')!
    const opt = chat.options.find((o) => o.long === '--model')
    expect(opt).toBeDefined()
    expect(opt!.short).toBe('-m')
  })

  test('chat has --timeout with short -t', () => {
    const chat = program.commands.find((c) => c.name() === 'chat')!
    const opt = chat.options.find((o) => o.long === '--timeout')
    expect(opt).toBeDefined()
    expect(opt!.short).toBe('-t')
  })

  test('inspect accepts a required command argument and variadic args', () => {
    const inspect = program.commands.find((c) => c.name() === 'inspect')!
    const args = inspect.registeredArguments
    expect(args.length).toBe(2)
    expect(args[0]!.required).toBe(true)
    expect(args[1]!.variadic).toBe(true)
  })

  test('proxy accepts a required command argument and variadic args', () => {
    const proxy = program.commands.find((c) => c.name() === 'proxy')!
    const args = proxy.registeredArguments
    expect(args.length).toBe(2)
    expect(args[0]!.required).toBe(true)
    expect(args[1]!.variadic).toBe(true)
  })

  test('monitor has --path with short -s and --port with short -p', () => {
    const monitor = program.commands.find((c) => c.name() === 'monitor')!
    const pathOpt = monitor.options.find((o) => o.long === '--path')
    expect(pathOpt).toBeDefined()
    expect(pathOpt!.short).toBe('-s')
    const portOpt = monitor.options.find((o) => o.long === '--port')
    expect(portOpt).toBeDefined()
    expect(portOpt!.short).toBe('-p')
  })

  test('proxy has --path with short -s', () => {
    const proxy = program.commands.find((c) => c.name() === 'proxy')!
    const pathOpt = proxy.options.find((o) => o.long === '--path')
    expect(pathOpt).toBeDefined()
    expect(pathOpt!.short).toBe('-s')
  })

  test('program has --version flag', () => {
    const versionOpt = program.options.find((o) => o.long === '--version' || o.short === '-v')
    expect(versionOpt).toBeDefined()
  })
})

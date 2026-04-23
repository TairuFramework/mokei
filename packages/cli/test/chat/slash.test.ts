import { describe, expect, test } from 'vitest'

import { matchSlashCommands, parseSlash, SLASH_COMMANDS } from '../../src/chat/slash.js'

describe('parseSlash', () => {
  test('treats plain text as a message', () => {
    expect(parseSlash('hello there')).toEqual({ kind: 'message', text: 'hello there' })
  })

  test('ignores leading and trailing whitespace for messages', () => {
    expect(parseSlash('  hi  ')).toEqual({ kind: 'message', text: 'hi' })
  })

  test('parses /help with no args', () => {
    expect(parseSlash('/help')).toEqual({ kind: 'command', name: 'help', args: [] })
  })

  test('parses /context', () => {
    expect(parseSlash('/context')).toEqual({ kind: 'command', name: 'context', args: [] })
  })

  test('parses /context list as alias of /context', () => {
    expect(parseSlash('/context list')).toEqual({
      kind: 'command',
      name: 'context',
      args: ['list'],
    })
  })

  test('parses /context add with key, command, and args', () => {
    expect(parseSlash('/context add sqlite mcp-sqlite --db /tmp/x.db')).toEqual({
      kind: 'command',
      name: 'context',
      args: ['add', 'sqlite', 'mcp-sqlite', '--db', '/tmp/x.db'],
    })
  })

  test('parses /model with id', () => {
    expect(parseSlash('/model gpt-4o')).toEqual({
      kind: 'command',
      name: 'model',
      args: ['gpt-4o'],
    })
  })

  test('parses /quit and /exit', () => {
    expect(parseSlash('/quit')).toEqual({ kind: 'command', name: 'quit', args: [] })
    expect(parseSlash('/exit')).toEqual({ kind: 'command', name: 'exit', args: [] })
  })

  test('collapses runs of whitespace inside command args', () => {
    expect(parseSlash('/context   add    k    c')).toEqual({
      kind: 'command',
      name: 'context',
      args: ['add', 'k', 'c'],
    })
  })

  test('empty input is treated as an empty message (caller may no-op)', () => {
    expect(parseSlash('')).toEqual({ kind: 'message', text: '' })
  })
})

describe('matchSlashCommands', () => {
  test('returns empty list for non-slash input', () => {
    expect(matchSlashCommands('hi')).toEqual([])
    expect(matchSlashCommands('')).toEqual([])
  })

  test('returns all commands for bare slash', () => {
    expect(matchSlashCommands('/')).toEqual(SLASH_COMMANDS)
  })

  test('filters by prefix', () => {
    const names = matchSlashCommands('/c').map((c) => c.name)
    expect(names).toEqual(['context'])
  })

  test('matches exact command prefix only on first token', () => {
    const names = matchSlashCommands('/context add').map((c) => c.name)
    expect(names).toEqual(['context'])
  })

  test('returns empty list when prefix matches nothing', () => {
    expect(matchSlashCommands('/zzz')).toEqual([])
  })
})

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FlowControlError, type InboxItem } from '@mokei/flow-client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { createMemoryControl, type MemoryControl } from '../../flow-client/test/memory-control.js'
import { createInboxCommand } from '../src/commands/inbox.js'
import type * as FlowControl from '../src/flow-control.js'
import { connectFlowControl } from '../src/flow-control.js'
import type * as Output from '../src/output.js'
import { renderTable } from '../src/output.js'
import type * as Prompts from '../src/prompts/index.js'
import {
  canPromptInTerminal,
  promptApproval,
  promptForm,
  UnsupportedSchemaError,
} from '../src/prompts/index.js'

vi.mock('../src/flow-control.js', async (importOriginal) => {
  const actual = await importOriginal<typeof FlowControl>()
  return { ...actual, connectFlowControl: vi.fn() }
})
vi.mock('../src/output.js', async (importOriginal) => {
  const actual = await importOriginal<typeof Output>()
  return { ...actual, renderTable: vi.fn() }
})
vi.mock('../src/prompts/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof Prompts>()
  return {
    ...actual,
    canPromptInTerminal: vi.fn(() => false),
    promptForm: vi.fn(),
    promptApproval: vi.fn(),
  }
})

const SOCKET = '/run/mokei-a.sock'

let stdout: Array<string>
let stderr: Array<string>
const directories: Array<string> = []

function inputItem(id: string, runID = 'r1'): InboxItem {
  return {
    id,
    runID,
    kind: 'input',
    inputKey: 'name',
    message: 'Your name?',
    requestedSchema: { type: 'object', properties: { name: { type: 'string' } } },
    createdAt: 3,
  }
}

function approvalItem(id: string, runID = 'r1'): InboxItem {
  return { id, runID, kind: 'approval', plan: { tools: ['fs:write'] }, createdAt: 4 }
}

function connect(memory: MemoryControl = createMemoryControl()) {
  const dispose = vi.fn(async () => {})
  vi.mocked(connectFlowControl).mockResolvedValue({
    control: memory.control,
    client: {},
    dispose,
  } as never)
  return { memory, dispose }
}

async function run(...args: Array<string>) {
  await createInboxCommand().parseAsync(args, { from: 'user' })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(canPromptInTerminal).mockReturnValue(false)
  process.exitCode = undefined
  stdout = []
  stderr = []
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdout.push(String(chunk))
    return true
  })
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    stderr.push(String(chunk))
    return true
  })
})

afterEach(async () => {
  vi.restoreAllMocks()
  process.exitCode = undefined
  await Promise.all(directories.splice(0).map((d) => rm(d, { recursive: true, force: true })))
})

test('list passes the run filter and renders a table', async () => {
  const { memory } = connect()
  memory.addItem(inputItem('i1'))
  const spy = vi.spyOn(memory.control.inbox, 'list')
  await run('list', '--run', 'r1', '-s', SOCKET)
  expect(spy).toHaveBeenCalledWith({ runID: 'r1' })
  expect(connectFlowControl).toHaveBeenCalledWith({ socketPath: SOCKET, autoStart: true })
  expect(renderTable).toHaveBeenCalledTimes(1)
  expect(vi.mocked(renderTable).mock.calls[0]?.[1]).toHaveLength(1)
})

test('list without --run passes an empty filter; --json prints items', async () => {
  const { memory } = connect()
  memory.addItem(inputItem('i1'))
  const spy = vi.spyOn(memory.control.inbox, 'list')
  await run('list', '--json', '-s', SOCKET)
  expect(spy).toHaveBeenCalledWith({})
  expect(JSON.parse(stdout.join(''))[0].id).toBe('i1')
})

test('show prints an input message and schema', async () => {
  const { memory } = connect()
  memory.addItem(inputItem('i1'))
  await run('show', 'i1', '-s', SOCKET)
  const text = stdout.join('')
  expect(text).toContain('Your name?')
  expect(text).toContain('"properties"')
})

test('show prints the approval planned tools', async () => {
  const { memory } = connect()
  memory.addItem(approvalItem('a1'))
  await run('show', 'a1', '-s', SOCKET)
  expect(stdout.join('')).toContain('fs:write')
})

test('show of a missing item exits 1', async () => {
  connect()
  await run('show', 'nope', '-s', SOCKET)
  expect(process.exitCode).toBe(1)
  expect(stderr.join('')).toContain('✘ Inbox item not found: nope')
})

test('answer --value answers an input with the parsed object', async () => {
  const { memory, dispose } = connect()
  memory.addItem(inputItem('i1'))
  const spy = vi.spyOn(memory.control.inbox, 'answer')
  await run('answer', 'i1', '--value', '{"name":"a"}', '-s', SOCKET)
  expect(spy).toHaveBeenCalledWith('i1', { name: 'a' })
  expect(process.exitCode).toBeUndefined()
  expect(dispose).toHaveBeenCalled()
})

test('answer --value @file reads the JSON from a file', async () => {
  const { memory } = connect()
  memory.addItem(inputItem('i1'))
  const directory = await mkdtemp(join(tmpdir(), 'mokei-inbox-cmd-'))
  directories.push(directory)
  const file = join(directory, 'v.json')
  await writeFile(file, '{"name":"f"}')
  const spy = vi.spyOn(memory.control.inbox, 'answer')
  await run('answer', 'i1', '--value', `@${file}`, '-s', SOCKET)
  expect(spy).toHaveBeenCalledWith('i1', { name: 'f' })
})

test('answer --value that is not an object exits 1', async () => {
  const { memory } = connect()
  memory.addItem(inputItem('i1'))
  const spy = vi.spyOn(memory.control.inbox, 'answer')
  await run('answer', 'i1', '--value', '[1]', '-s', SOCKET)
  expect(process.exitCode).toBe(1)
  expect(spy).not.toHaveBeenCalled()
})

test('answer with a malformed --value fails without connecting', async () => {
  connect()
  await run('answer', 'i1', '--value', '{not json', '-s', SOCKET)
  expect(process.exitCode).toBe(1)
  expect(stderr.join('')).toContain('--value')
  expect(connectFlowControl).not.toHaveBeenCalled()
})

test('answer with a missing --value file fails without connecting', async () => {
  connect()
  await run('answer', 'i1', '--value', '@/nonexistent/answer.json', '-s', SOCKET)
  expect(process.exitCode).toBe(1)
  expect(connectFlowControl).not.toHaveBeenCalled()
})

test('answer --value invalid reports the issues and exits 1', async () => {
  const { memory } = connect()
  memory.addItem(inputItem('i1'))
  vi.spyOn(memory.control.inbox, 'answer').mockRejectedValue(
    new FlowControlError({
      code: 'INBOX_ANSWER_INVALID',
      message: 'Invalid answer',
      data: { issues: ['name: required'] },
    }),
  )
  await run('answer', 'i1', '--value', '{}', '-s', SOCKET)
  expect(process.exitCode).toBe(1)
  expect(stderr.join('')).toContain('✘ name: required')
})

test('answer an approval with --yes answers without prompting', async () => {
  const { memory } = connect()
  memory.addItem(approvalItem('a1'))
  const spy = vi.spyOn(memory.control.inbox, 'answer')
  await run('answer', 'a1', '--yes', '-s', SOCKET)
  expect(spy).toHaveBeenCalledWith('a1')
  expect(promptApproval).not.toHaveBeenCalled()
})

test('answer an approval with --value exits 1', async () => {
  const { memory } = connect()
  memory.addItem(approvalItem('a1'))
  const spy = vi.spyOn(memory.control.inbox, 'answer')
  await run('answer', 'a1', '--value', '{}', '--yes', '-s', SOCKET)
  expect(process.exitCode).toBe(1)
  expect(spy).not.toHaveBeenCalled()
  expect(stderr.join('')).toContain('--value')
})

test('answer an approval without --yes and no TTY exits 1 suggesting --yes', async () => {
  const { memory } = connect()
  memory.addItem(approvalItem('a1'))
  await run('answer', 'a1', '-s', SOCKET)
  expect(process.exitCode).toBe(1)
  expect(stderr.join('')).toContain('--yes')
})

test('answer an approval approves when the prompt returns true', async () => {
  vi.mocked(canPromptInTerminal).mockReturnValue(true)
  vi.mocked(promptApproval).mockResolvedValue(true)
  const { memory } = connect()
  memory.addItem(approvalItem('a1'))
  const spy = vi.spyOn(memory.control.inbox, 'answer')
  await run('answer', 'a1', '-s', SOCKET)
  expect(spy).toHaveBeenCalledWith('a1')
  expect(vi.mocked(promptApproval).mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal)
})

test('answer an approval leaves it pending when the prompt returns false', async () => {
  vi.mocked(canPromptInTerminal).mockReturnValue(true)
  vi.mocked(promptApproval).mockResolvedValue(false)
  const { memory } = connect()
  memory.addItem(approvalItem('a1'))
  const answer = vi.spyOn(memory.control.inbox, 'answer')
  const decline = vi.spyOn(memory.control.inbox, 'decline')
  await run('answer', 'a1', '-s', SOCKET)
  expect(answer).not.toHaveBeenCalled()
  expect(decline).not.toHaveBeenCalled()
  expect(process.exitCode).toBe(1)
  expect(stderr.join('')).toContain('mokei inbox decline a1')
})

test('answer an input without --value and no TTY exits 1 suggesting --value', async () => {
  const { memory } = connect()
  memory.addItem(inputItem('i1'))
  await run('answer', 'i1', '-s', SOCKET)
  expect(process.exitCode).toBe(1)
  expect(stderr.join('')).toContain('--value')
  expect(promptForm).not.toHaveBeenCalled()
})

test('interactive answer sends the prompted values', async () => {
  vi.mocked(canPromptInTerminal).mockReturnValue(true)
  vi.mocked(promptForm).mockResolvedValue({ name: 'p' })
  const { memory } = connect()
  memory.addItem(inputItem('i1'))
  const spy = vi.spyOn(memory.control.inbox, 'answer')
  await run('answer', 'i1', '-s', SOCKET)
  expect(spy).toHaveBeenCalledWith('i1', { name: 'p' })
})

test('INBOX_ANSWER_INVALID shows the issues and prompts again', async () => {
  vi.mocked(canPromptInTerminal).mockReturnValue(true)
  vi.mocked(promptForm).mockResolvedValueOnce({ name: '' }).mockResolvedValueOnce({ name: 'ok' })
  const { memory } = connect()
  memory.addItem(inputItem('i1'))
  const spy = vi.spyOn(memory.control.inbox, 'answer')
  spy.mockRejectedValueOnce(
    new FlowControlError({
      code: 'INBOX_ANSWER_INVALID',
      message: 'Invalid answer',
      data: { issues: ['name: too short'] },
    }),
  )
  await run('answer', 'i1', '-s', SOCKET)
  expect(promptForm).toHaveBeenCalledTimes(2)
  expect(spy).toHaveBeenLastCalledWith('i1', { name: 'ok' })
  expect(stderr.join('')).toContain('✘ name: too short')
  expect(process.exitCode).toBeUndefined()
})

test('Esc in the form leaves the item pending', async () => {
  vi.mocked(canPromptInTerminal).mockReturnValue(true)
  vi.mocked(promptForm).mockResolvedValue(undefined)
  const { memory } = connect()
  memory.addItem(inputItem('i1'))
  const spy = vi.spyOn(memory.control.inbox, 'answer')
  await run('answer', 'i1', '-s', SOCKET)
  expect(spy).not.toHaveBeenCalled()
  expect(stderr.join('')).toContain('pending')
  expect(process.exitCode).toBe(1)
})

test('an unsupported schema exits 1 suggesting --value', async () => {
  vi.mocked(canPromptInTerminal).mockReturnValue(true)
  vi.mocked(promptForm).mockRejectedValue(new UnsupportedSchemaError({ reason: 'Nested objects' }))
  const { memory } = connect()
  memory.addItem(inputItem('i1'))
  await run('answer', 'i1', '-s', SOCKET)
  expect(process.exitCode).toBe(1)
  expect(stderr.join('')).toContain('--value')
})

test('decline passes the reason', async () => {
  const { memory } = connect()
  memory.addItem(approvalItem('a1'))
  const spy = vi.spyOn(memory.control.inbox, 'decline')
  await run('decline', 'a1', '--reason', 'r', '-s', SOCKET)
  expect(spy).toHaveBeenCalledWith('a1', 'r')
})

test('decline without a reason passes undefined', async () => {
  const { memory } = connect()
  memory.addItem(inputItem('i1'))
  const spy = vi.spyOn(memory.control.inbox, 'decline')
  await run('decline', 'i1', '-s', SOCKET)
  expect(spy).toHaveBeenCalledWith('i1', undefined)
})

test('cancel cancels the item', async () => {
  const { memory } = connect()
  memory.addItem(inputItem('i1'))
  const spy = vi.spyOn(memory.control.inbox, 'cancel')
  await run('cancel', 'i1', '-s', SOCKET)
  expect(spy).toHaveBeenCalledWith('i1')
})

test('prompt prints the action', async () => {
  const prompt = vi.fn(async () => 'accept' as const)
  const { memory } = connect(createMemoryControl({ prompt }))
  memory.addItem(approvalItem('a1'))
  await run('prompt', 'a1', '-s', SOCKET)
  expect(prompt).toHaveBeenCalledWith('a1', expect.any(AbortSignal))
  expect(stdout.join('')).toContain('accept')
})

test('prompt --json prints one document', async () => {
  const { memory } = connect(createMemoryControl({ prompt: async () => 'decline' }))
  memory.addItem(approvalItem('a1'))
  await run('prompt', 'a1', '--json', '-s', SOCKET)
  expect(JSON.parse(stdout.join(''))).toEqual({ id: 'a1', action: 'decline' })
})

test('PROMPT_UNSUPPORTED exits 1 with the message', async () => {
  const { memory } = connect(
    createMemoryControl({
      prompt: async () => {
        throw new FlowControlError({
          code: 'PROMPT_UNSUPPORTED',
          message: 'The desktop cannot render this prompt',
        })
      },
    }),
  )
  memory.addItem(approvalItem('a1'))
  await run('prompt', 'a1', '-s', SOCKET)
  expect(process.exitCode).toBe(1)
  expect(stderr.join('')).toContain('✘ The desktop cannot render this prompt')
})

test('prompt on a daemon without prompt support exits 1', async () => {
  const { memory } = connect()
  memory.addItem(approvalItem('a1'))
  await run('prompt', 'a1', '-s', SOCKET)
  expect(process.exitCode).toBe(1)
})

import { readFile } from 'node:fs/promises'
import { serveProcess } from '@mokei/context-server-node'
import type { FlowSummary } from '@mokei/flow-client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { createMemoryControl } from '../../flow-client/test/memory-control.js'
import { createFlowsCommand } from '../src/commands/flows.js'
import { connectFlowControl } from '../src/flow-control.js'

vi.mock('@mokei/context-server-node', () => ({ serveProcess: vi.fn() }))
vi.mock('../src/flow-control.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/flow-control.js')>()
  return { ...actual, connectFlowControl: vi.fn() }
})

const SOCKET = '/run/mokei-a.sock'

let stdout: Array<string>
let stderr: Array<string>

const summary = (id: string, name: string, version: number): FlowSummary => ({
  id,
  name,
  version,
  input: { type: 'object' },
  outputs: [],
  outcomes: [],
})

function connect(options: Parameters<typeof createMemoryControl>[0] = {}) {
  const dispose = vi.fn(async () => {})
  vi.mocked(connectFlowControl).mockResolvedValue({
    control: createMemoryControl(options).control,
    client: {},
    dispose,
  } as never)
  return dispose
}

async function run(...args: Array<string>) {
  await createFlowsCommand().parseAsync(args, { from: 'user' })
}

beforeEach(() => {
  vi.clearAllMocks()
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

afterEach(() => {
  process.exitCode = undefined
  vi.restoreAllMocks()
})

test('list prints one line per flow and auto-starts the daemon', async () => {
  const dispose = connect({ flows: [summary('triage', 'Triage issues', 2), summary('b', 'B', 1)] })
  await run('list', '-s', SOCKET)
  expect(stdout.join('')).toBe('triage v2 Triage issues\nb v1 B\n')
  expect(connectFlowControl).toHaveBeenCalledWith({ socketPath: SOCKET, autoStart: true })
  expect(dispose).toHaveBeenCalled()
})

test('list --json prints the summaries', async () => {
  connect({ flows: [summary('a', 'A', 1)] })
  await run('list', '--json', '-s', SOCKET)
  expect(JSON.parse(stdout.join(''))).toEqual([summary('a', 'A', 1)])
})

test('list reports a connection failure with exit code 1', async () => {
  vi.mocked(connectFlowControl).mockRejectedValue(new Error('no daemon'))
  await run('list', '-s', SOCKET)
  expect(stderr.join('')).toBe('✘ no daemon\n')
  expect(process.exitCode).toBe(1)
})

async function writeDefinition(): Promise<string> {
  const { mkdtemp, writeFile } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const directory = await mkdtemp(join(tmpdir(), 'mokei-flows-cmd-'))
  const file = join(directory, 'flow.json')
  await writeFile(file, JSON.stringify({ id: 'x' }))
  return file
}

test('check with issues prints formatted and exits 1', async () => {
  const issues = { issues: [], warnings: [], formatted: '2 problems found' }
  const check = vi.fn(() => issues)
  const dispose = connect({ check })
  const file = await writeDefinition()
  await run('check', file, '-s', SOCKET)
  expect(check).toHaveBeenCalledWith({ id: 'x' })
  expect(stdout.join('')).toBe('2 problems found\n')
  expect(process.exitCode).toBe(1)
  expect(dispose).toHaveBeenCalled()
})

test('check of a valid flow prints formatted and exits 0', async () => {
  connect()
  await run('check', await writeDefinition(), '-s', SOCKET)
  expect(stdout.join('')).toBe('Flow is valid\n')
  expect(process.exitCode).toBeUndefined()
})

test('check --json prints the result and still exits 1 on issues', async () => {
  const result = { issues: [], warnings: [], formatted: 'bad' }
  connect({ check: () => result })
  await run('check', await writeDefinition(), '--json', '-s', SOCKET)
  expect(JSON.parse(stdout.join(''))).toEqual(result)
  expect(process.exitCode).toBe(1)
})

test('check fails on an unreadable or invalid file', async () => {
  connect()
  await run('check', '/nonexistent/flow.json', '-s', SOCKET)
  expect(stderr.join('')).toContain('✘ ')
  expect(process.exitCode).toBe(1)
  expect(connectFlowControl).not.toHaveBeenCalled()
})

test('mcp serves the flow server and disposes the connection when the transport closes', async () => {
  const dispose = connect()
  let close: () => void = () => {}
  const disposed = new Promise<void>((resolve) => {
    close = resolve
  })
  vi.mocked(serveProcess).mockReturnValue({ disposed, dispose: vi.fn() } as never)
  const pending = run('mcp', '-s', SOCKET)
  await vi.waitFor(() => expect(serveProcess).toHaveBeenCalled())
  expect(dispose).not.toHaveBeenCalled()
  const config = vi.mocked(serveProcess).mock.calls[0]?.[0]
  expect(config?.protocolVersions).toEqual(['2026-07-28', '2025-11-25'])
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  expect(config?.version).toBe(pkg.version)
  close()
  await pending
  expect(dispose).toHaveBeenCalled()
  expect(stdout.join('')).toBe('')
  expect(connectFlowControl).toHaveBeenCalledWith({ socketPath: SOCKET, autoStart: true })
})

test('mcp reports a connection failure on stderr only', async () => {
  vi.mocked(connectFlowControl).mockRejectedValue(new Error('no daemon'))
  await run('mcp', '-s', SOCKET)
  expect(stdout.join('')).toBe('')
  expect(stderr.join('')).toBe('✘ no daemon\n')
  expect(process.exitCode).toBe(1)
})

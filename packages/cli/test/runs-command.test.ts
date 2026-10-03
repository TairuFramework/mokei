import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FlowControlError, type FlowRunSnapshot, type InboxItem } from '@mokei/flow-client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { createMemoryControl, type MemoryControl } from '../../flow-client/test/memory-control.js'
import { createRunsCommand } from '../src/commands/runs.js'
import { connectFlowControl } from '../src/flow-control.js'
import { formatTrace, renderTable } from '../src/output.js'
import { canPromptInTerminal, promptApproval, promptForm } from '../src/prompts/index.js'
import { followRun } from '../src/run-follow.js'

vi.mock('../src/flow-control.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/flow-control.js')>()
  return { ...actual, connectFlowControl: vi.fn() }
})
vi.mock('../src/output.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/output.js')>()
  return { ...actual, renderTable: vi.fn() }
})
vi.mock('../src/prompts/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/prompts/index.js')>()
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

function snapshot(runID: string, state: FlowRunSnapshot['state'], extra = {}): FlowRunSnapshot {
  return { runID, label: 'demo', state, createdAt: 1, updatedAt: 2, plan: { tools: [] }, ...extra }
}

function inputItem(id: string, runID: string): InboxItem {
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

function approvalItem(id: string, runID: string): InboxItem {
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
  await createRunsCommand().parseAsync(args, { from: 'user' })
}

async function writeJSON(value: unknown): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'mokei-runs-cmd-'))
  directories.push(directory)
  const file = join(directory, 'def.json')
  await writeFile(file, JSON.stringify(value))
  return file
}

/** Lets pending promise callbacks and subscription events run. */
async function flush(times = 20) {
  for (let i = 0; i < times; i++) await new Promise((resolve) => setImmediate(resolve))
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
  process.exitCode = undefined
  vi.restoreAllMocks()
  await Promise.all(directories.splice(0).map((d) => rm(d, { recursive: true, force: true })))
})

test('start sends the flow and parsed input, then prints the run id and state', async () => {
  const { memory, dispose } = connect()
  const start = vi.spyOn(memory.control.runs, 'start')
  await run('start', 'demo', '--input', '{"a":1}', '-s', SOCKET)
  expect(start).toHaveBeenCalledWith({ flow: 'demo', input: { a: 1 } })
  expect(stdout.join('')).toBe('run-1  working\n')
  expect(connectFlowControl).toHaveBeenCalledWith({ socketPath: SOCKET, autoStart: true })
  expect(dispose).toHaveBeenCalled()
  expect(process.exitCode).toBeUndefined()
})

test('start --label passes the label and --json prints the snapshot', async () => {
  const { memory } = connect()
  const start = vi.spyOn(memory.control.runs, 'start')
  await run('start', 'demo', '--label', 'nightly', '--json', '-s', SOCKET)
  expect(start).toHaveBeenCalledWith({ flow: 'demo', label: 'nightly' })
  expect(JSON.parse(stdout.join(''))).toMatchObject({ runID: 'run-1', label: 'nightly' })
})

test('start --file sends the definition', async () => {
  const { memory } = connect()
  const start = vi.spyOn(memory.control.runs, 'start')
  const file = await writeJSON({ id: 'inline' })
  await run('start', '--file', file, '-s', SOCKET)
  expect(start).toHaveBeenCalledWith({ definition: { id: 'inline' } })
  expect(stdout.join('')).toBe('run-1  working\n')
})

test('start with both a flow and --file exits 1 without connecting', async () => {
  connect()
  await run('start', 'demo', '--file', await writeJSON({ id: 'x' }), '-s', SOCKET)
  expect(stderr.join('')).toMatch(/^✘ .*--file/)
  expect(process.exitCode).toBe(1)
  expect(connectFlowControl).not.toHaveBeenCalled()
})

test('start with neither a flow nor --file exits 1', async () => {
  connect()
  await run('start', '-s', SOCKET)
  expect(stderr.join('')).toMatch(/^✘ /)
  expect(process.exitCode).toBe(1)
  expect(connectFlowControl).not.toHaveBeenCalled()
})

test('start rejects an --input that is not a JSON object', async () => {
  connect()
  await run('start', 'demo', '--input', '[1]', '-s', SOCKET)
  expect(stderr.join('')).toBe('✘ --input must be a JSON object\n')
  expect(process.exitCode).toBe(1)
})

test('followRun interactive answers an input and an approval, then resolves completed', async () => {
  const memory = createMemoryControl()
  memory.setRun(snapshot('r1', 'input_required'))
  memory.addItem(inputItem('i1', 'r1'))
  const answer = memory.control.inbox.answer
  vi.spyOn(memory.control.inbox, 'answer').mockImplementation(async (id, content) => {
    await answer(id, content)
    if (id === 'i1') {
      memory.setRun(snapshot('r1', 'awaiting_approval'))
      memory.addItem(approvalItem('a1', 'r1'))
    } else {
      memory.setRun(snapshot('r1', 'completed', { result: { content: [], output: 'done' } }))
    }
  })
  vi.mocked(promptForm).mockResolvedValue({ name: 'Ada' })
  vi.mocked(promptApproval).mockResolvedValue(true)

  const status = await followRun(memory.control, 'r1', {
    interactive: true,
    json: false,
    signal: new AbortController().signal,
  })

  expect(status.state).toBe('completed')
  expect(promptForm).toHaveBeenCalledTimes(1)
  expect(vi.mocked(promptForm).mock.calls[0]?.[0]).toMatchObject({ id: 'i1', kind: 'input' })
  expect(promptApproval).toHaveBeenCalledTimes(1)
  expect(vi.mocked(promptApproval).mock.calls[0]?.[0]).toMatchObject({ id: 'a1' })
  expect(memory.control.inbox.answer).toHaveBeenCalledWith('i1', { name: 'Ada' })
  expect(memory.control.inbox.answer).toHaveBeenCalledWith('a1')
  expect(stdout.join('')).toContain('r1  completed')
  expect(stdout.join('')).toContain('"done"')
})

test('followRun leaves an approval pending when the user does not approve', async () => {
  const memory = createMemoryControl()
  memory.setRun(snapshot('r1', 'awaiting_approval'))
  memory.addItem(approvalItem('a1', 'r1'))
  const decline = vi.spyOn(memory.control.inbox, 'decline')
  const answer = vi.spyOn(memory.control.inbox, 'answer')
  vi.mocked(promptApproval).mockResolvedValue(false)

  const pending = followRun(memory.control, 'r1', {
    interactive: true,
    json: false,
    signal: new AbortController().signal,
  })
  await vi.waitFor(() => expect(promptApproval).toHaveBeenCalledTimes(1))
  await flush()
  expect(promptApproval).toHaveBeenCalledTimes(1)
  expect(decline).not.toHaveBeenCalled()
  expect(answer).not.toHaveBeenCalled()
  expect(await memory.control.inbox.list({ runID: 'r1' })).toHaveLength(1)
  expect(stderr.join('')).toContain('mokei inbox decline a1')

  memory.setRun(snapshot('r1', 'cancelled'))
  await expect(pending).resolves.toMatchObject({ state: 'cancelled' })
  expect(decline).not.toHaveBeenCalled()
})

test('followRun abort closes an open prompt, rejects and leaves the item pending', async () => {
  const memory = createMemoryControl()
  memory.setRun(snapshot('r1', 'input_required'))
  memory.addItem(inputItem('i1', 'r1'))
  const answer = vi.spyOn(memory.control.inbox, 'answer')
  const decline = vi.spyOn(memory.control.inbox, 'decline')
  const cancel = vi.spyOn(memory.control.inbox, 'cancel')
  const closed = vi.fn()
  // A prompt blocked on user input that honours the signal, as the real prompts do.
  vi.mocked(promptForm).mockImplementation(
    (_item, options) =>
      new Promise((_resolve, reject) => {
        const signal = options?.signal
        signal?.addEventListener(
          'abort',
          () => {
            closed()
            reject(signal.reason)
          },
          { once: true },
        )
      }),
  )
  const controller = new AbortController()
  const pending = followRun(memory.control, 'r1', {
    interactive: true,
    json: false,
    signal: controller.signal,
  })
  await vi.waitFor(() => expect(promptForm).toHaveBeenCalledTimes(1))
  expect(vi.mocked(promptForm).mock.calls[0]?.[1]?.signal).toBe(controller.signal)

  controller.abort(new Error('interrupted'))
  await expect(pending).rejects.toThrow('interrupted')
  expect(closed).toHaveBeenCalledTimes(1)
  expect(answer).not.toHaveBeenCalled()
  expect(decline).not.toHaveBeenCalled()
  expect(cancel).not.toHaveBeenCalled()
  expect(await memory.control.inbox.list({ runID: 'r1' })).toHaveLength(1)
  expect(memory.openSubscriptions()).toBe(0)
})

test('followRun abort during an approval prompt never settles the item', async () => {
  const memory = createMemoryControl()
  memory.setRun(snapshot('r1', 'awaiting_approval'))
  memory.addItem(approvalItem('a1', 'r1'))
  const decline = vi.spyOn(memory.control.inbox, 'decline')
  const answer = vi.spyOn(memory.control.inbox, 'answer')
  vi.mocked(promptApproval).mockImplementation(
    (_item, options) =>
      new Promise((_resolve, reject) => {
        const signal = options?.signal
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
      }),
  )
  const controller = new AbortController()
  const pending = followRun(memory.control, 'r1', {
    interactive: true,
    json: false,
    signal: controller.signal,
  })
  await vi.waitFor(() => expect(promptApproval).toHaveBeenCalledTimes(1))
  controller.abort(new Error('interrupted'))
  await expect(pending).rejects.toThrow('interrupted')
  expect(answer).not.toHaveBeenCalled()
  expect(decline).not.toHaveBeenCalled()
  expect(await memory.control.inbox.list({ runID: 'r1' })).toHaveLength(1)
})

test('followRun interactive re-prompts when the answer is invalid', async () => {
  const memory = createMemoryControl()
  memory.setRun(snapshot('r1', 'input_required'))
  memory.addItem(inputItem('i1', 'r1'))
  const answer = memory.control.inbox.answer
  let calls = 0
  vi.spyOn(memory.control.inbox, 'answer').mockImplementation(async (id, content) => {
    calls++
    if (calls === 1) {
      throw new FlowControlError({
        code: 'INBOX_ANSWER_INVALID',
        message: 'bad',
        data: { issues: ['name is too short'] },
      })
    }
    await answer(id, content)
    memory.setRun(snapshot('r1', 'completed', { result: { content: [] } }))
  })
  vi.mocked(promptForm).mockResolvedValueOnce({ name: 'A' }).mockResolvedValueOnce({ name: 'Ada' })
  const status = await followRun(memory.control, 'r1', {
    interactive: true,
    json: false,
    signal: new AbortController().signal,
  })
  expect(status.state).toBe('completed')
  expect(promptForm).toHaveBeenCalledTimes(2)
  expect(stderr.join('')).toContain('name is too short')
})

test('followRun Esc leaves the item pending and keeps watching', async () => {
  const memory = createMemoryControl()
  memory.setRun(snapshot('r1', 'input_required'))
  memory.addItem(inputItem('i1', 'r1'))
  vi.mocked(promptForm).mockResolvedValue(undefined)
  const answer = vi.spyOn(memory.control.inbox, 'answer')

  const pending = followRun(memory.control, 'r1', {
    interactive: true,
    json: false,
    signal: new AbortController().signal,
  })
  await vi.waitFor(() => expect(promptForm).toHaveBeenCalledTimes(1))
  await flush()
  // Still watching: not re-prompted for the skipped item, and the item stays pending.
  expect(promptForm).toHaveBeenCalledTimes(1)
  expect(answer).not.toHaveBeenCalled()
  expect(await memory.control.inbox.list({ runID: 'r1' })).toHaveLength(1)
  expect(stderr.join('')).toContain('mokei inbox answer i1')

  memory.settle('i1')
  memory.setRun(snapshot('r1', 'completed', { result: { content: [] } }))
  await expect(pending).resolves.toMatchObject({ state: 'completed' })
  expect(promptForm).toHaveBeenCalledTimes(1)
})

test('followRun non-interactive prints each change once and does not loop on a pending item', async () => {
  const memory = createMemoryControl()
  memory.setRun(snapshot('r1', 'input_required'))
  memory.addItem(inputItem('i1', 'r1'))
  const get = vi.spyOn(memory.control.runs, 'get')

  const pending = followRun(memory.control, 'r1', {
    interactive: false,
    json: true,
    signal: new AbortController().signal,
  })
  await vi.waitFor(() => expect(stdout).toHaveLength(1))
  const reads = get.mock.calls.length
  await flush()
  expect(get.mock.calls.length).toBe(reads)
  expect(stdout).toHaveLength(1)

  memory.settle('i1')
  memory.setRun(snapshot('r1', 'completed', { result: { content: [] } }))
  const status = await pending
  expect(status.state).toBe('completed')
  expect(promptForm).not.toHaveBeenCalled()

  const lines = stdout.join('').trim().split('\n')
  const statuses = lines.map((line) => JSON.parse(line))
  expect(statuses[0]).toMatchObject({ runID: 'r1', state: 'input_required' })
  expect(statuses[0].pending).toHaveLength(1)
  expect(statuses.at(-1)).toMatchObject({ state: 'completed' })
  // Each printed status differs from the one before it.
  for (let i = 1; i < lines.length; i++) expect(lines[i]).not.toBe(lines[i - 1])
})

test('followRun non-interactive text output lists pending items', async () => {
  const memory = createMemoryControl()
  memory.setRun(snapshot('r1', 'input_required'))
  memory.addItem(inputItem('i1', 'r1'))
  const pending = followRun(memory.control, 'r1', {
    interactive: false,
    json: false,
    signal: new AbortController().signal,
  })
  await vi.waitFor(() => expect(stdout.join('')).toContain('pending i1 (input): Your name?'))
  memory.setRun(snapshot('r1', 'failed', { error: { type: 'Error', message: 'boom' } }))
  await expect(pending).resolves.toMatchObject({ state: 'failed' })
  expect(stdout.join('')).toContain('error: boom')
})

test('followRun rejects with the abort reason when the signal aborts', async () => {
  const memory = createMemoryControl()
  memory.setRun(snapshot('r1', 'working'))
  const controller = new AbortController()
  const pending = followRun(memory.control, 'r1', {
    interactive: false,
    json: false,
    signal: controller.signal,
  })
  await vi.waitFor(() => expect(stdout).toHaveLength(1))
  controller.abort(new Error('stop'))
  await expect(pending).rejects.toThrow('stop')
})

test('start --wait exits 0 on completed', async () => {
  const { memory, dispose } = connect()
  vi.mocked(canPromptInTerminal).mockReturnValue(true)
  const pending = run('start', 'demo', '--wait', '-s', SOCKET)
  await vi.waitFor(async () => expect(await memory.control.runs.list()).toHaveLength(1))
  await flush()
  memory.setRun(snapshot('run-1', 'completed', { result: { content: [] } }))
  await pending
  expect(process.exitCode).toBeUndefined()
  expect(stdout.join('')).toContain('run-1  completed')
  expect(dispose).toHaveBeenCalled()
})

test('start --wait exits 1 on failed', async () => {
  const { memory } = connect()
  const pending = run('start', 'demo', '--wait', '-s', SOCKET)
  await vi.waitFor(async () => expect(await memory.control.runs.list()).toHaveLength(1))
  await flush()
  memory.setRun(snapshot('run-1', 'failed', { error: { type: 'Error', message: 'boom' } }))
  await pending
  expect(process.exitCode).toBe(1)
})

test('start --wait --json prints NDJSON and never prompts', async () => {
  const { memory } = connect()
  vi.mocked(canPromptInTerminal).mockReturnValue(true)
  const pending = run('start', 'demo', '--wait', '--json', '-s', SOCKET)
  await vi.waitFor(() => expect(stdout).toHaveLength(1))
  memory.addItem(inputItem('i1', 'run-1'))
  await vi.waitFor(() => expect(stdout).toHaveLength(2))
  memory.settle('i1')
  memory.setRun(snapshot('run-1', 'completed', { result: { content: [] } }))
  await pending
  expect(promptForm).not.toHaveBeenCalled()
  const statuses = stdout
    .join('')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
  expect(statuses[0]).toMatchObject({ runID: 'run-1', state: 'working', pending: [] })
  expect(statuses.at(-1)).toMatchObject({ state: 'completed' })
  expect(process.exitCode).toBeUndefined()
})

test('get prints the status with pending items', async () => {
  const memory = createMemoryControl()
  memory.setRun(snapshot('r1', 'input_required'))
  memory.addItem(inputItem('i1', 'r1'))
  connect(memory)
  await run('get', 'r1', '-s', SOCKET)
  expect(stdout.join('')).toBe('r1  input_required\n  pending i1 (input): Your name?\n')
})

test('get --json prints the run status', async () => {
  const memory = createMemoryControl()
  memory.setRun(snapshot('r1', 'completed', { result: { content: [], output: 42 } }))
  connect(memory)
  await run('get', 'r1', '--json', '-s', SOCKET)
  expect(JSON.parse(stdout.join(''))).toEqual({
    runID: 'r1',
    state: 'completed',
    pending: [],
    result: { content: [], output: 42 },
  })
})

test('get reports an unknown run with exit code 1', async () => {
  connect()
  await run('get', 'nope', '-s', SOCKET)
  expect(stderr.join('')).toBe('✘ Run not found: nope\n')
  expect(process.exitCode).toBe(1)
})

test('list --state working --limit 5 passes the filter and prints a table', async () => {
  const memory = createMemoryControl()
  memory.setRun(snapshot('r1', 'working', { flowID: 'demo' }))
  const { dispose } = connect(memory)
  const list = vi.spyOn(memory.control.runs, 'list')
  await run('list', '--state', 'working', '--limit', '5', '-s', SOCKET)
  expect(list).toHaveBeenCalledWith({ states: ['working'], limit: 5 })
  expect(renderTable).toHaveBeenCalledWith(
    [
      { key: 'runID', label: 'ID' },
      { key: 'flow', label: 'FLOW' },
      { key: 'label', label: 'LABEL' },
      { key: 'state', label: 'STATE' },
      { key: 'updated', label: 'UPDATED' },
    ],
    [
      {
        runID: 'r1',
        flow: 'demo',
        label: 'demo',
        state: 'working',
        updated: new Date(2).toISOString(),
      },
    ],
  )
  expect(dispose).toHaveBeenCalled()
})

test('list without options sends an empty filter; --json prints the snapshots', async () => {
  const memory = createMemoryControl()
  memory.setRun(snapshot('r1', 'working'))
  connect(memory)
  const list = vi.spyOn(memory.control.runs, 'list')
  await run('list', '--json', '-s', SOCKET)
  expect(list).toHaveBeenCalledWith({})
  expect(JSON.parse(stdout.join(''))).toEqual([snapshot('r1', 'working')])
})

test('list rejects an invalid --limit', async () => {
  connect()
  await run('list', '--limit', 'many', '-s', SOCKET)
  expect(stderr.join('')).toMatch(/^✘ .*--limit/)
  expect(process.exitCode).toBe(1)
})

test('cancel cancels the run and prints its state', async () => {
  const memory = createMemoryControl()
  memory.setRun(snapshot('r1', 'working'))
  connect(memory)
  await run('cancel', 'r1', '-s', SOCKET)
  expect(stdout.join('')).toBe('r1  cancelled\n')
  expect((await memory.control.runs.get('r1')).state).toBe('cancelled')
})

test('trace prints the formatTrace output', async () => {
  const memory = createMemoryControl()
  const trace = {
    spans: [
      { spanID: 's1', name: 'flow', startTime: 0, endTime: 10 },
      { spanID: 's2', parentSpanID: 's1', name: 'step', startTime: 1, endTime: 4 },
    ],
    logs: [{ level: 'info', message: 'hello' }],
  } as never
  memory.control.runs.trace = vi.fn(async () => trace)
  connect(memory)
  await run('trace', 'r1', '-s', SOCKET)
  expect(memory.control.runs.trace).toHaveBeenCalledWith('r1')
  expect(stdout.join('')).toBe(`${formatTrace(trace)}\n`)
})

test('trace fails when the daemon does not expose traces', async () => {
  connect()
  await run('trace', 'r1', '-s', SOCKET)
  expect(stderr.join('')).toMatch(/^✘ /)
  expect(process.exitCode).toBe(1)
})

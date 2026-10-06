import { existsSync, readFileSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { setTimeout as sleep } from 'node:timers/promises'
import type { RunRecord } from '@mokei/flow-host'
import type { FlowDefinition } from '@sozai/flow-graph'
import { createTestProfile } from '@tejika/test'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { connectMCP, type MCPConnection, type ToolResult } from '../support/flow-cli/mcp-client.js'
import { type CLIEnv, runCLI, spawnCLI } from '../support/flow-cli/run-cli.js'
import { type FlowDaemonFixture, startFlowDaemonFixture } from '../support/flow-daemon/driver.js'
import { flows } from '../support/flow-daemon/flows.js'

const WAIT_MS = 15_000

type RunStatus = {
  runID: string
  state: string
  pending: Array<{ id: string; kind: string; message?: string; canPrompt: boolean }>
  result?: Record<string, unknown>
  error?: Record<string, unknown>
}

/** A flow that keeps its run `working` for `ms` once its sibling tool call is approved. */
function slowFlow(ms: number): FlowDefinition {
  return {
    id: 'slow',
    name: 'Slow',
    version: 1,
    start: 'nap',
    nodes: {
      nap: { kind: 'tool', tool: 'sibling:sleep', args: { ms: { value: ms } }, next: 'done' },
      done: { kind: 'end', outcome: 'done' },
    },
  } as FlowDefinition
}

async function until<T>(label: string, check: () => Promise<T | undefined>): Promise<T> {
  const deadline = Date.now() + WAIT_MS
  let last: unknown
  while (Date.now() < deadline) {
    try {
      const value = await check()
      if (value !== undefined) return value
    } catch (error) {
      last = error
    }
    await sleep(50)
  }
  throw new Error(`Timed out waiting for ${label}: ${String(last)}`)
}

function ndjson(stdout: string): Array<RunStatus> {
  return stdout
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as RunStatus)
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** CLI bound to one socket and environment. */
function createCLI(env: CLIEnv, socketPath: string) {
  const args = (command: Array<string>) => [...command, '-s', socketPath]
  return {
    run: (command: Array<string>, input?: string) => runCLI(args(command), { env, input }),
    spawn: (command: Array<string>) => spawnCLI(args(command), { env }),
    /** Runs a `--json` command, expects exit 0 and parses stdout. */
    async json<T = Record<string, unknown>>(command: Array<string>): Promise<T> {
      const result = await runCLI(args([...command, '--json']), { env })
      if (result.code !== 0) {
        throw new Error(
          `mokei ${command.join(' ')} exited ${result.code}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
        )
      }
      return JSON.parse(result.stdout) as T
    },
  }
}
type Cli = ReturnType<typeof createCLI>

function pendingItem(cli: Cli, runID: string) {
  return until('pending item', async () => {
    const status = await cli.json<RunStatus>(['runs', 'get', runID])
    return status.pending[0]
  })
}

function runState(cli: Cli, runID: string, state: string) {
  return until(`run ${state}`, async () => {
    const status = await cli.json<RunStatus>(['runs', 'get', runID])
    return status.state === state ? status : undefined
  })
}

describe('flow CLI against the fixture daemon', () => {
  let fixture: FlowDaemonFixture
  let cli: Cli
  let scratch: string

  beforeAll(async () => {
    fixture = await startFlowDaemonFixture()
    cli = createCLI(fixture.env, fixture.socketPath)
    scratch = await mkdtemp('/tmp/mokei-flow-cli-files-')
  })
  afterAll(async () => {
    await rm(scratch, { recursive: true, force: true })
    await fixture?.dispose()
  })

  test('flows list prints the configured flows', async () => {
    const listed = await cli.json<Array<{ id: string; name: string; version: number }>>([
      'flows',
      'list',
    ])
    expect(listed.map((flow) => flow.id).sort()).toEqual(flows.map((flow) => flow.id).sort())
    const text = await cli.run(['flows', 'list'])
    expect(text.code).toBe(0)
    expect(text.stdout).toContain('input v1 Input')
  })

  test('runs start runs an inline definition', async () => {
    const path = join(scratch, 'inline.json')
    await writeFile(
      path,
      JSON.stringify({
        id: 'inline',
        name: 'Inline',
        version: 1,
        start: 'done',
        nodes: { done: { kind: 'end', outcome: 'inline', output: { from: { value: 'file' } } } },
      }),
    )
    const snapshot = await cli.json<{ runID: string; state: string }>([
      'runs',
      'start',
      '--file',
      path,
      '--label',
      'inline run',
    ])
    expect(snapshot.runID).toEqual(expect.any(String))
    const done = await runState(cli, snapshot.runID, 'completed')
    expect(done.result).toMatchObject({ outcome: 'inline', output: { from: 'file' } })
  })

  test('runs start --wait --json streams NDJSON until completed', async () => {
    const result = await cli.run(['runs', 'start', 'end', '--wait', '--json'])
    expect(result.code).toBe(0)
    const lines = ndjson(result.stdout)
    expect(lines.length).toBeGreaterThan(0)
    expect(lines.at(-1)).toMatchObject({ state: 'completed', pending: [] })
  })

  test('inbox answer --value settles an input item', async () => {
    const run = await cli.json<{ runID: string }>(['runs', 'start', 'input'])
    const item = await pendingItem(cli, run.runID)
    expect(item).toMatchObject({ kind: 'input', message: 'Choose a name' })
    const listed = await cli.json<Array<{ id: string }>>(['inbox', 'list', '--run', run.runID])
    expect(listed.map((entry) => entry.id)).toEqual([item.id])
    const invalid = await cli.run(['inbox', 'answer', item.id, '--value', '{"value":3}'])
    expect(invalid.code).toBe(1)
    expect(invalid.stderr).toContain('✘')
    expect(await cli.json(['inbox', 'answer', item.id, '--value', '{"value":"Ada"}'])).toEqual({
      id: item.id,
      outcome: 'answered',
    })
    const done = await runState(cli, run.runID, 'completed')
    expect(done.result).toMatchObject({ output: { answer: { value: 'Ada' } } })
  })

  test('inbox answer --yes approves an approval item', async () => {
    const run = await cli.json<{ runID: string }>(['runs', 'start', 'approval'])
    const item = await pendingItem(cli, run.runID)
    expect(item.kind).toBe('approval')
    const misuse = await cli.run(['inbox', 'answer', item.id, '--value', '{}'])
    expect(misuse.code).toBe(1)
    expect(misuse.stderr).toContain('--value is for input items')
    const noTTY = await cli.run(['inbox', 'answer', item.id])
    expect(noTTY.code).toBe(1)
    expect(noTTY.stderr).toContain('pass --yes')
    expect(await cli.json(['inbox', 'answer', item.id, '--yes'])).toEqual({
      id: item.id,
      outcome: 'answered',
    })
    await runState(cli, run.runID, 'completed')
  })

  test('inbox decline on an approval denies the run', async () => {
    const run = await cli.json<{ runID: string }>(['runs', 'start', 'approval'])
    const item = await pendingItem(cli, run.runID)
    expect(await cli.json(['inbox', 'decline', item.id, '--reason', 'no'])).toEqual({
      id: item.id,
      outcome: 'declined',
    })
    await runState(cli, run.runID, 'denied')
    expect(await cli.json<Array<unknown>>(['inbox', 'list', '--run', run.runID])).toEqual([])
  })

  test('runs cancel cancels a waiting run', async () => {
    const run = await cli.json<{ runID: string }>(['runs', 'start', 'input'])
    await pendingItem(cli, run.runID)
    const cancelled = await cli.json<{ runID: string; state: string }>([
      'runs',
      'cancel',
      run.runID,
    ])
    expect(cancelled).toMatchObject({ runID: run.runID, state: 'cancelled' })
    await runState(cli, run.runID, 'cancelled')
    const listed = await cli.json<Array<{ runID: string }>>([
      'runs',
      'list',
      '--state',
      'cancelled',
    ])
    expect(listed.map((entry) => entry.runID)).toContain(run.runID)
  })

  test('runs trace shows the run spans', async () => {
    const run = await cli.json<{ runID: string }>(['runs', 'start', 'end'])
    await runState(cli, run.runID, 'completed')
    const trace = await until('run trace spans', async () => {
      const trace = await cli.json<{ spans: Array<{ name: string }>; logs: Array<unknown> }>([
        'runs',
        'trace',
        run.runID,
      ])
      return trace.spans.some((span) => span.name === 'flow.run') ? trace : undefined
    })
    expect(trace.logs).toEqual(expect.any(Array))
    const text = await cli.run(['runs', 'trace', run.runID])
    expect(text.code).toBe(0)
    expect(text.stdout).toMatch(/^flow\.run {2}\d+ms$/m)
  })

  test('daemon status reports the fixture daemon running', async () => {
    const pid = Number(JSON.parse(readFileSync(fixture.pidPath, 'utf8')).pid)
    expect(await cli.json(['daemon', 'status'])).toMatchObject({
      state: 'running',
      pid,
      socketPath: fixture.socketPath,
      flowService: { state: 'ready' },
    })
    const text = await cli.run(['daemon', 'status'])
    expect(text.code).toBe(0)
    expect(text.stdout).toContain(`running (pid ${pid})`)
  })
})

describe('flows mcp over stdio', () => {
  let fixture: FlowDaemonFixture
  let mcp: MCPConnection

  const prompts = () => fixture.desktopRecords().filter((record) => record.type === 'prompt')
  const data = (result: ToolResult) =>
    result.structuredContent as RunStatus & Record<string, unknown>
  const ok = (result: ToolResult) => {
    expect(result.isError, JSON.stringify(result.content)).toBeFalsy()
    return data(result)
  }
  async function start(flow: string): Promise<RunStatus & { timedOut?: boolean }> {
    const run = ok(await mcp.call('start_flow', { flow }))
    return ok(await mcp.call('wait_flow', { runID: run.runID, timeoutMs: WAIT_MS }))
  }
  /** Calls `prompt_input` and resolves once its dialog is open, with that dialog's index. */
  async function openPrompt(id: string, signal?: AbortSignal) {
    const index = prompts().length
    const result = mcp.call('prompt_input', { id }, signal)
    result.catch(() => {})
    await fixture.wait('dialog open', () => prompts().length > index)
    return { index, result }
  }

  beforeAll(async () => {
    fixture = await startFlowDaemonFixture()
    mcp = await connectMCP(fixture.env, fixture.socketPath)
  })
  afterAll(async () => {
    await mcp?.dispose()
    await fixture?.dispose()
  })

  test('lists the flow tools', async () => {
    const { tools } = await mcp.client.listTools()
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'answer_input',
      'cancel_flow',
      'check_flow',
      'decline_input',
      'flow_status',
      'list_flows',
      'list_runs',
      'prompt_input',
      'start_flow',
      'wait_flow',
    ])
  })

  test('start_flow and wait_flow reach an actionable input, answer_input completes it', async () => {
    const started = ok(await mcp.call('start_flow', { flow: 'input' }))
    expect(started.runID).toEqual(expect.any(String))
    const waiting = ok(await mcp.call('wait_flow', { runID: started.runID }))
    expect(waiting).toMatchObject({
      runID: started.runID,
      state: 'input_required',
      timedOut: false,
      pending: [{ kind: 'input', message: 'Choose a name', canPrompt: true }],
    })
    const id = waiting.pending[0]?.id as string
    ok(await mcp.call('answer_input', { id, value: { value: 'Ada' } }))
    const done = ok(await mcp.call('wait_flow', { runID: started.runID }))
    expect(done).toMatchObject({
      state: 'completed',
      timedOut: false,
      result: { output: { answer: { value: 'Ada' } } },
    })
    // A late answer after settlement is rejected.
    const late = await mcp.call('answer_input', { id, value: { value: 'late' } })
    expect(late.isError).toBe(true)
    expect(late.content[0]?.text).toMatch(/^INBOX_ITEM_NOT_FOUND: /)
    expect(late.structuredContent).toMatchObject({ code: 'INBOX_ITEM_NOT_FOUND' })
  })

  test('wait_flow times out on a working run', async () => {
    const started = ok(await mcp.call('start_flow', { definition: slowFlow(5_000) }))
    const approval = ok(await mcp.call('wait_flow', { runID: started.runID }))
    expect(approval.pending[0]?.kind).toBe('approval')
    const client = await fixture.connect()
    await client.request('inbox.answer', {
      timeout: 10_000,
      param: { id: approval.pending[0]?.id as string },
    })
    const before = Date.now()
    const waited = ok(await mcp.call('wait_flow', { runID: started.runID, timeoutMs: 200 }))
    expect(waited).toMatchObject({ state: 'working', pending: [], timedOut: true })
    expect(Date.now() - before).toBeGreaterThanOrEqual(150)
    ok(await mcp.call('cancel_flow', { runID: started.runID }))
  })

  test('answer_input and decline_input refuse approvals', async () => {
    const run = await start('approval')
    const id = run.pending[0]?.id as string
    for (const [tool, args] of [
      ['answer_input', { id, value: {} }],
      ['decline_input', { id }],
    ] as const) {
      const refused = await mcp.call(tool, args)
      expect(refused.isError).toBe(true)
      expect(refused.content[0]?.text).toMatch(/^INBOX_ANSWER_INVALID: .*prompt_input/)
    }
    // Neither refusal settled the approval: it is still pending.
    expect(ok(await mcp.call('flow_status', { runID: run.runID }))).toMatchObject({
      state: 'awaiting_approval',
      pending: [{ id, kind: 'approval' }],
    })
    ok(await mcp.call('cancel_flow', { runID: run.runID }))
  })

  test('prompt_input accepts an approval through the desktop dialog', async () => {
    const run = await start('approval')
    const id = run.pending[0]?.id as string
    const { index, result } = await openPrompt(id)
    expect(prompts()[index]?.requestedSchema).toMatchObject({ type: 'object' })
    await fixture.answerPrompt(index, { action: 'accept', content: { approve: true } })
    expect(ok(await result)).toEqual({ id, action: 'accept' })
    expect(ok(await mcp.call('wait_flow', { runID: run.runID }))).toMatchObject({
      state: 'completed',
    })
  })

  test('prompt_input accepts an input through the desktop dialog', async () => {
    const run = await start('input')
    const id = run.pending[0]?.id as string
    const { index, result } = await openPrompt(id)
    await fixture.answerPrompt(index, { action: 'accept', content: { value: 'Grace' } })
    expect(ok(await result)).toEqual({ id, action: 'accept' })
    expect(ok(await mcp.call('wait_flow', { runID: run.runID }))).toMatchObject({
      state: 'completed',
      result: { output: { answer: { value: 'Grace' } } },
    })
  })

  test('a cancelled dialog settles the item', async () => {
    const run = await start('input')
    const id = run.pending[0]?.id as string
    const { index, result } = await openPrompt(id)
    await fixture.answerPrompt(index, { action: 'cancel' })
    expect(ok(await result)).toEqual({ id, action: 'cancel' })
    const status = ok(await mcp.call('flow_status', { runID: run.runID }))
    expect(status.pending).toEqual([])
    const late = await mcp.call('answer_input', { id, value: { value: 'late' } })
    expect(late.content[0]?.text).toMatch(/^INBOX_ITEM_NOT_FOUND: /)
  })

  test('cancelling the prompt_input call leaves the item pending', async () => {
    const run = await start('input')
    const id = run.pending[0]?.id as string
    const caller = new AbortController()
    const { index, result } = await openPrompt(id, caller.signal)
    caller.abort(new Error('caller cancelled'))
    await expect(result).rejects.toBeDefined()
    await fixture.wait('dialog aborted', () =>
      fixture
        .desktopRecords()
        .some((record) => record.type === 'aborted' && record.index === index),
    )
    const status = ok(await mcp.call('flow_status', { runID: run.runID }))
    expect(status).toMatchObject({ state: 'input_required', pending: [{ id }] })
    // The aborted dialog's late answer is ignored; the item is still answerable.
    await fixture.answerPrompt(index, { action: 'accept', content: { value: 'late' } })
    ok(await mcp.call('answer_input', { id, value: { value: 'Ada' } }))
    expect(ok(await mcp.call('wait_flow', { runID: run.runID }))).toMatchObject({
      state: 'completed',
      result: { output: { answer: { value: 'Ada' } } },
    })
  })

  test('the server exits once the client closes its stdin', async () => {
    const own = await connectMCP(fixture.env, fixture.socketPath)
    try {
      ok(await own.call('list_flows'))
      await own.client.dispose()
      own.child.stdin.end()
      const exit = await fixture.within('flows mcp exit', own.exited, 10_000)
      expect(exit, own.stderr()).toEqual({ code: 0, signal: null })
    } finally {
      await own.dispose()
    }
  })
})

test('runs start --wait --json follows a run across a daemon restart', async () => {
  const fixture = await startFlowDaemonFixture()
  try {
    const cli = createCLI(fixture.env, fixture.socketPath)
    const follow = cli.spawn(['runs', 'start', 'input', '--wait', '--json'])
    follow.done.catch(() => {})
    const waiting = await until('input_required line', async () =>
      ndjson(follow.stdout()).find(
        (line) => line.state === 'input_required' && line.pending.length,
      ),
    )
    await fixture.stop()
    await fixture.restart()
    const id = waiting.pending[0]?.id as string
    expect(await cli.json(['inbox', 'answer', id, '--value', '{"value":"Ada"}'])).toEqual({
      id,
      outcome: 'answered',
    })
    const result = await follow.done
    expect(result.code, result.stderr).toBe(0)
    const lines = ndjson(result.stdout)
    expect(lines.at(-1)).toMatchObject({
      runID: waiting.runID,
      state: 'completed',
      result: { output: { answer: { value: 'Ada' } } },
    })
  } finally {
    await fixture.dispose()
  }
})

test('daemon start, stop and restart run the production entry in isolated directories', async () => {
  const profile = createTestProfile('mokei')
  const directory = profile.dir
  const socketPath = join(directory, 'daemon.sock')
  const pidPath = join(directory, 'mokei.pid')
  const env = {
    ...profile.env,
    // runCLI merges process.env, so pin the paths: an inherited override would move the daemon off the mokei.db read below.
    MOKEI_CONFIG_PATH: join(directory, 'mokei.json'),
    MOKEI_DATABASE_PATH: join(directory, 'mokei.db'),
    MOKEI_LOG_DIR: join(directory, 'logs'),
    MOKEI_PID_PATH: pidPath,
    MOKEI_SOCKET_PATH: socketPath,
  }
  const cli = createCLI(env, socketPath)
  const pids = new Set<number>()
  const readRuns = () => {
    const db = new DatabaseSync(join(directory, 'mokei.db'), { readOnly: true })
    try {
      return db
        .prepare('SELECT data FROM mokei_flow_runs ORDER BY seq')
        .all()
        .map((row) => JSON.parse(row.data as string) as RunRecord)
    } finally {
      db.close()
    }
  }
  try {
    await mkdir(join(directory, 'flows'))
    const input = flows.find((flow) => flow.id === 'input')
    await writeFile(join(directory, 'flows', 'input.json'), JSON.stringify(input))
    await writeFile(
      join(directory, 'flows.json'),
      JSON.stringify({ flowDirs: ['./flows'], desktop: { notifications: false } }),
    )

    const started = await cli.json<{ pid: number; socketPath: string; flowService: unknown }>([
      'daemon',
      'start',
    ])
    pids.add(started.pid)
    expect(started).toMatchObject({ socketPath, flowService: { state: 'ready' } })
    expect(existsSync(pidPath)).toBe(true)

    const run = await cli.json<{ runID: string }>(['runs', 'start', 'input'])
    const item = await pendingItem(cli, run.runID)

    const stopped = await cli.run(['daemon', 'stop'])
    expect(stopped.code, stopped.stderr).toBe(0)
    expect(stopped.stdout).toBe(`daemon stopped (pid ${started.pid})\n`)
    expect(alive(started.pid)).toBe(false)
    expect(existsSync(socketPath)).toBe(false)
    expect(readRuns()).toMatchObject([{ runID: run.runID, state: 'input_required' }])
    expect(await cli.json(['daemon', 'status'])).toEqual({ state: 'not-running' })

    const fromStopped = await cli.run(['daemon', 'restart'])
    expect(fromStopped.code, fromStopped.stderr).toBe(0)
    expect(fromStopped.stdout.split('\n')).toEqual([
      'daemon not running',
      expect.stringMatching(/^daemon running \(pid \d+\)$/),
      `socket: ${socketPath}`,
      '',
    ])

    const restarted = await cli.json<{
      stop: { state: string; pid?: number; forced?: boolean }
      start: { pid: number; flowService: unknown }
    }>(['daemon', 'restart'])
    pids.add(restarted.start.pid)
    expect(restarted.stop).toMatchObject({ state: 'stopped', forced: false })
    if (restarted.stop.pid != null) pids.add(restarted.stop.pid)
    expect(restarted.start).toMatchObject({ flowService: { state: 'ready' } })
    expect(restarted.start.pid).not.toBe(restarted.stop.pid)

    expect(await cli.json<RunStatus>(['runs', 'get', run.runID])).toMatchObject({
      state: 'input_required',
      pending: [{ id: item.id, kind: 'input' }],
    })
    await cli.json(['inbox', 'answer', item.id, '--value', '{"value":"Ada"}'])
    await runState(cli, run.runID, 'completed')

    const final = await cli.json<{ state: string; pid?: number; forced?: boolean }>([
      'daemon',
      'stop',
    ])
    expect(final).toEqual({ state: 'stopped', pid: restarted.start.pid, forced: false })
  } finally {
    // Never leave a daemon behind, whatever failed above.
    try {
      const state = JSON.parse(readFileSync(pidPath, 'utf8')) as { pid: number }
      pids.add(state.pid)
    } catch {
      // No pid file: no daemon running.
    }
    for (const pid of pids) {
      if (alive(pid)) process.kill(pid, 'SIGKILL')
    }
    await profile[Symbol.asyncDispose]()
  }
})

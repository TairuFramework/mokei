import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type * as TejikaCLI from '@tejika/cli'
import type * as TejikaProcess from '@tejika/process'
import { getDaemonStatus, spawnDaemon, stopDaemon, waitForSocket } from '@tejika/process'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { createDaemonCommand, resolveDaemonIdentity } from '../src/commands/daemon.js'
import { ensureMokeiDaemon } from '../src/daemon.js'
import type * as FlowControl from '../src/flow-control.js'
import { connectFlowControl } from '../src/flow-control.js'

vi.mock('@tejika/process', async (importOriginal) => {
  const actual = await importOriginal<typeof TejikaProcess>()
  return {
    ...actual,
    getDaemonStatus: vi.fn(),
    spawnDaemon: vi.fn(async () => {}),
    stopDaemon: vi.fn(),
    waitForSocket: vi.fn(async () => {}),
  }
})
vi.mock('../src/daemon.js', () => ({ ensureMokeiDaemon: vi.fn() }))
vi.mock('@tejika/cli', async (importOriginal) => {
  const actual = await importOriginal<typeof TejikaCLI>()
  // Inline the real factory so its process imports use the test doubles.
  const path = new URL('../node_modules/@tejika/cli/lib/daemon.js?inline', import.meta.url).href
  const daemon = (await import(path)) as Pick<
    typeof TejikaCLI,
    'createDaemonCommand' | 'resolveDaemonIdentity'
  >
  return { ...actual, ...daemon }
})
vi.mock('../src/flow-control.js', async (importOriginal) => {
  const actual = await importOriginal<typeof FlowControl>()
  return { ...actual, connectFlowControl: vi.fn() }
})

const SOCKET = '/run/mokei-a.sock'
const OTHER = '/run/mokei-b.sock'

let directory: string
let stdout: Array<string>
let stderr: Array<string>

function connection(info: unknown) {
  const request = vi.fn(async () => info)
  vi.mocked(connectFlowControl).mockResolvedValue({
    control: {},
    client: { request },
    dispose: vi.fn(async () => {}),
  } as never)
  return request
}

async function run(...args: Array<string>) {
  await createDaemonCommand().parseAsync(args, { from: 'user' })
}

beforeEach(async () => {
  vi.clearAllMocks()
  vi.mocked(getDaemonStatus).mockResolvedValue({ state: 'running', pid: 7, socketPath: SOCKET })
  process.exitCode = undefined
  directory = await mkdtemp(join(tmpdir(), 'mokei-daemon-cmd-'))
  vi.stubEnv('MOKEI_LOG_DIR', directory)
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
  vi.unstubAllEnvs()
  await rm(directory, { recursive: true, force: true })
})

test('resolveDaemonIdentity compares the recorded socket with the selected one', async () => {
  vi.mocked(getDaemonStatus).mockResolvedValue({ state: 'running', pid: 7, socketPath: OTHER })
  expect(await resolveDaemonIdentity(SOCKET)).toEqual({
    state: 'not-running',
    otherSocketPath: OTHER,
  })
  expect(await resolveDaemonIdentity(OTHER)).toEqual({ state: 'running', pid: 7 })
  vi.mocked(getDaemonStatus).mockResolvedValue({ state: 'stale', pid: 9 })
  expect(await resolveDaemonIdentity(SOCKET)).toEqual({ state: 'stale', pid: 9 })
})

test('daemon lifecycle commands accept a custom pid path', () => {
  const daemon = createDaemonCommand()
  for (const name of ['start', 'stop', 'status', 'restart']) {
    const command = daemon.commands.find((command) => command.name() === name)
    expect(command?.options.some((option) => option.long === '--pid-path')).toBe(true)
  }
})

test.each(['start', 'stop', 'status', 'restart'])('%s uses the selected pid path', async (name) => {
  const pidPath = join(directory, 'custom.pid')
  vi.mocked(stopDaemon).mockResolvedValue({ stopped: true, pid: 7, forced: false })
  connection({ activeContexts: {}, startedTime: Date.now(), flowService: { state: 'ready' } })
  await run(name, '-s', SOCKET, '--pid-path', pidPath, '--json')
  expect(getDaemonStatus).toHaveBeenCalledWith({ app: 'mokei', pidPath })
  for (const [options] of vi.mocked(getDaemonStatus).mock.calls) {
    expect(options?.pidPath).toBe(pidPath)
  }
  if (name === 'stop' || name === 'restart') {
    expect(stopDaemon).toHaveBeenCalledWith(expect.objectContaining({ pidPath }))
  }
  expect(process.exitCode).toBeUndefined()
})

test('start spawns with the selected pid path and entry before connecting', async () => {
  const pidPath = join(directory, 'custom.pid')
  vi.mocked(getDaemonStatus)
    .mockResolvedValueOnce({ state: 'not-running' })
    .mockResolvedValueOnce({ state: 'running', pid: 7, socketPath: SOCKET })
  connection({ flowService: { state: 'ready' } })
  await run('start', '-s', SOCKET, '--pid-path', pidPath, '--json')
  expect(spawnDaemon).toHaveBeenCalledWith({
    app: 'mokei',
    entry: expect.stringMatching(/\/cli\/src\/daemon-entry\.js$/),
    socketPath: SOCKET,
    pidPath,
    timeoutMs: 30_000,
    signal: expect.any(AbortSignal),
  })
  expect(vi.mocked(spawnDaemon).mock.invocationCallOrder[0]).toBeLessThan(
    vi.mocked(connectFlowControl).mock.invocationCallOrder[0] ?? 0,
  )
  expect(connectFlowControl).toHaveBeenCalledWith({ socketPath: SOCKET, autoStart: false })
  expect(JSON.parse(stdout.join(''))).toEqual({
    pid: 7,
    socketPath: SOCKET,
    flowService: { state: 'ready' },
  })
})

test('start rejects another socket without spawning or connecting', async () => {
  vi.mocked(getDaemonStatus).mockResolvedValue({ state: 'running', pid: 7, socketPath: OTHER })
  await run('start', '-s', SOCKET)
  expect(process.exitCode).toBe(1)
  expect(stderr.join('')).toContain(OTHER)
  expect(spawnDaemon).not.toHaveBeenCalled()
  expect(connectFlowControl).not.toHaveBeenCalled()
})

test('start waits for an already booting daemon before connecting', async () => {
  vi.mocked(getDaemonStatus).mockResolvedValue({ state: 'booting', pid: 7, socketPath: SOCKET })
  connection({ flowService: { state: 'ready' } })
  await run('start', '-s', SOCKET, '--json')
  expect(waitForSocket).toHaveBeenCalledWith(SOCKET, {
    deadline: expect.objectContaining({ signal: expect.any(AbortSignal) }),
  })
  expect(vi.mocked(waitForSocket).mock.invocationCallOrder[0]).toBeLessThan(
    vi.mocked(connectFlowControl).mock.invocationCallOrder[0] ?? 0,
  )
  expect(spawnDaemon).not.toHaveBeenCalled()
  expect(process.exitCode).toBeUndefined()
})

test('start --json preserves the failed flow service and exits 1', async () => {
  vi.mocked(getDaemonStatus).mockResolvedValue({ state: 'running', pid: 7, socketPath: SOCKET })
  const flowService = {
    state: 'failed',
    error: { type: 'FlowConfigError', message: 'Bad config', issues: ['missing id'] },
  }
  connection({ flowService })
  await run('start', '-s', SOCKET, '--json')
  expect(JSON.parse(stdout.join(''))).toEqual({ pid: 7, socketPath: SOCKET, flowService })
  expect(stderr.join('')).toContain('Flow service failed: Bad config\n  missing id')
  expect(process.exitCode).toBe(1)
})

test('restart --json preserves stop and failed flow service in one document', async () => {
  vi.mocked(stopDaemon).mockResolvedValue({ stopped: true, pid: 7, forced: false })
  const flowService = { state: 'failed', error: { type: 'FlowConfigError', message: 'Bad config' } }
  connection({ flowService })
  await run('restart', '-s', SOCKET, '--json')
  expect(JSON.parse(stdout.join(''))).toEqual({
    stop: { state: 'stopped', pid: 7, forced: false },
    start: { pid: 7, socketPath: SOCKET, flowService },
  })
  expect(process.exitCode).toBe(1)
  expect(stdout.join('')).not.toContain('daemon running')
})

test('resolveDaemonIdentity compares resolved paths', async () => {
  vi.mocked(getDaemonStatus).mockResolvedValue({ state: 'running', pid: 7, socketPath: SOCKET })
  expect(await resolveDaemonIdentity('/run/x/../mokei-a.sock')).toEqual({
    state: 'running',
    pid: 7,
  })
  vi.mocked(getDaemonStatus).mockResolvedValue({
    state: 'running',
    pid: 7,
    socketPath: join(process.cwd(), 'mokei.sock'),
  })
  expect(await resolveDaemonIdentity('./mokei.sock')).toEqual({ state: 'running', pid: 7 })
})

test('status reports not-running and the other socket on mismatch', async () => {
  vi.mocked(getDaemonStatus).mockResolvedValue({ state: 'running', pid: 7, socketPath: OTHER })
  await run('status', '-s', SOCKET)
  expect(stdout.join('')).toContain('not-running')
  expect(stdout.join('')).toContain(OTHER)
  expect(ensureMokeiDaemon).not.toHaveBeenCalled()
  expect(connectFlowControl).not.toHaveBeenCalled()
})

test('status --json prints state and otherSocketPath', async () => {
  vi.mocked(getDaemonStatus).mockResolvedValue({ state: 'running', pid: 7, socketPath: OTHER })
  await run('status', '-s', SOCKET, '--json')
  expect(JSON.parse(stdout.join(''))).toEqual({ state: 'not-running', otherSocketPath: OTHER })
})

test('status of a running daemon adds uptime, contexts and flow service state', async () => {
  vi.mocked(getDaemonStatus).mockResolvedValue({ state: 'running', pid: 7, socketPath: SOCKET })
  connection({
    activeContexts: { a: {}, b: {} },
    startedTime: Date.now() - 5000,
    flowService: { state: 'ready' },
  })
  await run('status', '-s', SOCKET, '--json')
  const result = JSON.parse(stdout.join(''))
  expect(result).toMatchObject({
    state: 'running',
    pid: 7,
    socketPath: SOCKET,
    activeContexts: 2,
    flowService: { state: 'ready' },
  })
  expect(result.uptimeMs).toBeGreaterThanOrEqual(5000)
  expect(connectFlowControl).toHaveBeenCalledWith({ socketPath: SOCKET, autoStart: false })
  expect(ensureMokeiDaemon).not.toHaveBeenCalled()
})

test('status of a booting daemon does not connect', async () => {
  vi.mocked(getDaemonStatus).mockResolvedValue({ state: 'booting', pid: 7, socketPath: SOCKET })
  await run('status', '-s', SOCKET)
  expect(stdout.join('')).toContain('booting')
  expect(connectFlowControl).not.toHaveBeenCalled()
})

test('SIGINT interrupts a pending status request and disposes the connection', async () => {
  const info = { activeContexts: {}, startedTime: Date.now(), flowService: { state: 'ready' } }
  let finish: ((value: typeof info) => void) | undefined
  const dispose = vi.fn(async () => {})
  const request = vi.fn(() => {
    return new Promise<typeof info>((resolve) => {
      finish = resolve
    })
  })
  vi.mocked(connectFlowControl).mockResolvedValue({ client: { request }, dispose } as never)
  const running = run('status', '-s', SOCKET, '--json')
  try {
    await vi.waitFor(() => expect(request).toHaveBeenCalled())
    process.emit('SIGINT')
    await new Promise((resolve) => setImmediate(resolve))
    expect(dispose).toHaveBeenCalledTimes(1)
    expect(JSON.parse(stdout.join(''))).toMatchObject({
      state: 'running',
      error: expect.any(String),
    })
  } finally {
    finish?.(info)
    await running
  }
})

test('stop with a mismatched socket fails naming both paths', async () => {
  vi.mocked(getDaemonStatus).mockResolvedValue({ state: 'running', pid: 7, socketPath: OTHER })
  await run('stop', '-s', SOCKET)
  expect(process.exitCode).toBe(1)
  expect(stderr.join('')).toContain(SOCKET)
  expect(stderr.join('')).toContain(OTHER)
  expect(stopDaemon).not.toHaveBeenCalled()
})

test('stop waits for exit within the shutdown budget', async () => {
  vi.mocked(getDaemonStatus).mockResolvedValue({ state: 'running', pid: 7, socketPath: SOCKET })
  vi.mocked(stopDaemon).mockResolvedValue({ stopped: true, pid: 7, forced: false })
  await run('stop', '-s', SOCKET)
  expect(stopDaemon).toHaveBeenCalledWith(
    expect.objectContaining({
      app: 'mokei',
      waitForExit: true,
      killTimeoutMs: 75_000,
      expectedSocketPath: SOCKET,
    }),
  )
  expect(stdout.join('')).toBe('daemon stopped (pid 7)\n')
  expect(process.exitCode).toBeUndefined()
})

test('stop reports a forced stop', async () => {
  vi.mocked(getDaemonStatus).mockResolvedValue({ state: 'running', pid: 7, socketPath: SOCKET })
  vi.mocked(stopDaemon).mockResolvedValue({ stopped: true, pid: 7, forced: true })
  await run('stop', '-s', SOCKET)
  expect(stdout.join('')).toBe('daemon did not exit in time; force-killed (pid 7)\n')
  expect(process.exitCode).toBeUndefined()
})

test('stop --json prints the state and forced', async () => {
  vi.mocked(getDaemonStatus).mockResolvedValue({ state: 'running', pid: 7, socketPath: SOCKET })
  vi.mocked(stopDaemon).mockResolvedValue({ stopped: true, pid: 7, forced: true })
  await run('stop', '-s', SOCKET, '--json')
  expect(JSON.parse(stdout.join(''))).toEqual({ state: 'stopped', pid: 7, forced: true })
})

test('stop fails on a socket mismatch found under the mutex', async () => {
  vi.mocked(getDaemonStatus)
    .mockResolvedValueOnce({ state: 'running', pid: 7, socketPath: SOCKET })
    .mockResolvedValueOnce({ state: 'running', pid: 8, socketPath: OTHER })
  vi.mocked(stopDaemon).mockResolvedValue({ stopped: false, pid: 8, reason: 'socket-mismatch' })
  await run('stop', '-s', SOCKET)
  expect(process.exitCode).toBe(1)
  expect(stderr.join('')).toContain(SOCKET)
  expect(stderr.join('')).toContain(OTHER)
  expect(stdout.join('')).toBe('')
})

test('stop reports a failed stop with exit code 1', async () => {
  vi.mocked(getDaemonStatus).mockResolvedValue({ state: 'running', pid: 7, socketPath: SOCKET })
  vi.mocked(stopDaemon).mockResolvedValue({ stopped: false, pid: 7, reason: 'timeout' })
  await run('stop', '-s', SOCKET)
  expect(process.exitCode).toBe(1)
  expect(stderr.join('')).toContain('timeout')
})

test('start with a failed flow service exits 1 with the error and issues', async () => {
  vi.mocked(getDaemonStatus).mockResolvedValue({ state: 'running', pid: 7, socketPath: SOCKET })
  connection({
    activeContexts: {},
    startedTime: Date.now(),
    flowService: {
      state: 'failed',
      error: { type: 'FlowConfigError', message: 'Bad config', issues: ['flows[0]: missing id'] },
    },
  })
  await run('start', '-s', SOCKET)
  expect(process.exitCode).toBe(1)
  expect(stderr.join('')).toContain('Bad config')
  expect(stderr.join('')).toContain('flows[0]: missing id')
  expect(connectFlowControl).toHaveBeenCalledWith({ socketPath: SOCKET, autoStart: false })
})

test('start waits until the flow service leaves starting', async () => {
  vi.mocked(getDaemonStatus).mockResolvedValue({ state: 'running', pid: 7, socketPath: SOCKET })
  const request = connection({})
  request
    .mockResolvedValueOnce({ flowService: { state: 'starting' } } as never)
    .mockResolvedValueOnce({ flowService: { state: 'ready' } } as never)
  await run('start', '-s', SOCKET, '--json')
  expect(request).toHaveBeenCalledTimes(2)
  expect(JSON.parse(stdout.join(''))).toEqual({
    pid: 7,
    socketPath: SOCKET,
    flowService: { state: 'ready' },
  })
  expect(process.exitCode).toBeUndefined()
})

test('restart starts only after stop resolves stopped', async () => {
  vi.mocked(getDaemonStatus).mockResolvedValue({ state: 'running', pid: 7, socketPath: SOCKET })
  connection({ flowService: { state: 'ready' } })
  const order: Array<string> = []
  vi.mocked(stopDaemon).mockImplementation(async () => {
    order.push('stop')
    return { stopped: true, pid: 7 }
  })
  vi.mocked(connectFlowControl).mockImplementation((async () => {
    order.push('start')
    return {
      control: {},
      client: { request: async () => ({ flowService: { state: 'ready' } }) },
      dispose: async () => {},
    }
  }) as never)
  await run('restart', '-s', SOCKET)
  expect(order).toEqual(['stop', 'start'])
})

test('restart does not start when stop fails', async () => {
  vi.mocked(getDaemonStatus).mockResolvedValue({ state: 'running', pid: 7, socketPath: SOCKET })
  vi.mocked(stopDaemon).mockResolvedValue({ stopped: false, pid: 7, reason: 'timeout' })
  await run('restart', '-s', SOCKET)
  expect(process.exitCode).toBe(1)
  expect(connectFlowControl).not.toHaveBeenCalled()
})

test('logs -n prints the last lines of the log file', async () => {
  await writeFile(join(directory, 'daemon.log'), 'one\ntwo\nthree\nfour\nfive\n')
  await run('logs', '-n', '3')
  expect(stdout.join('')).toBe('three\nfour\nfive\n')
  expect(ensureMokeiDaemon).not.toHaveBeenCalled()
})

test('logs reports a missing log file', async () => {
  await run('logs')
  expect(process.exitCode).toBe(1)
  expect(stderr.join('')).toContain('daemon.log')
})

test('start fails after the deadline when an info request never settles', async () => {
  vi.useFakeTimers()
  try {
    vi.mocked(getDaemonStatus).mockResolvedValue({ state: 'running', pid: 7, socketPath: SOCKET })
    const dispose = vi.fn(async () => {})
    vi.mocked(connectFlowControl).mockResolvedValue({
      control: {},
      client: { request: () => new Promise(() => {}) },
      dispose,
    } as never)
    const running = run('start', '-s', SOCKET)
    await vi.advanceTimersByTimeAsync(30_001)
    await running
    expect(process.exitCode).toBe(1)
    expect(stderr.join('')).toContain('still starting')
    expect(dispose).toHaveBeenCalledTimes(1)
  } finally {
    vi.useRealTimers()
  }
})

test('SIGINT interrupts a pending info request and disposes the connection', async () => {
  vi.mocked(getDaemonStatus).mockResolvedValue({ state: 'running', pid: 7, socketPath: SOCKET })
  const dispose = vi.fn(async () => {})
  vi.mocked(connectFlowControl).mockResolvedValue({
    control: {},
    client: { request: () => new Promise(() => {}) },
    dispose,
  } as never)
  const running = run('start', '-s', SOCKET)
  await vi.waitFor(() => expect(connectFlowControl).toHaveBeenCalled())
  await new Promise((resolve) => setTimeout(resolve, 10))
  process.emit('SIGINT')
  await running
  expect(process.exitCode).toBe(1)
  expect(stderr.join('')).toContain('Interrupted')
  expect(dispose).toHaveBeenCalledTimes(1)
})

test('restart --json prints a single JSON document', async () => {
  vi.mocked(getDaemonStatus).mockResolvedValue({ state: 'running', pid: 7, socketPath: SOCKET })
  vi.mocked(stopDaemon).mockResolvedValue({ stopped: true, pid: 7, forced: false })
  connection({ flowService: { state: 'ready' } })
  await run('restart', '-s', SOCKET, '--json')
  expect(JSON.parse(stdout.join(''))).toEqual({
    stop: { state: 'stopped', pid: 7, forced: false },
    start: { pid: 7, socketPath: SOCKET, flowService: { state: 'ready' } },
  })
})

test('restart of a not-running daemon proceeds to start', async () => {
  vi.mocked(getDaemonStatus).mockResolvedValue({ state: 'not-running' })
  vi.mocked(stopDaemon).mockResolvedValue({ stopped: false, reason: 'not-running' })
  connection({ flowService: { state: 'ready' } })
  await run('restart', '-s', SOCKET)
  expect(connectFlowControl).toHaveBeenCalledWith({ socketPath: SOCKET, autoStart: false })
  expect(process.exitCode).toBeUndefined()
})

test('restart with a mismatched socket never stops or starts', async () => {
  vi.mocked(getDaemonStatus).mockResolvedValue({ state: 'running', pid: 7, socketPath: OTHER })
  await run('restart', '-s', SOCKET)
  expect(process.exitCode).toBe(1)
  expect(stopDaemon).not.toHaveBeenCalled()
  expect(connectFlowControl).not.toHaveBeenCalled()
})

test('logs rejects a malformed line count', async () => {
  await writeFile(join(directory, 'daemon.log'), 'a\n')
  await run('logs', '-n', '3abc')
  expect(process.exitCode).toBe(1)
  expect(stderr.join('')).toContain('Invalid line count')
})

test('logs -f reports a failure after following begins and cleans up', async () => {
  const logPath = join(directory, 'daemon.log')
  await writeFile(logPath, 'one\n')
  const sigintBefore = process.listenerCount('SIGINT')
  const following = run('logs', '-f')
  await vi.waitFor(() => expect(process.listenerCount('SIGINT')).toBe(sigintBefore + 1))
  await rm(logPath)
  await following
  expect(process.exitCode).toBe(1)
  expect(stderr.join('')).toContain('Cannot follow')
  expect(process.listenerCount('SIGINT')).toBe(sigintBefore)
})

test('bounds a stalled service request with its startup timeout message', async () => {
  const request = connection(undefined)
  request.mockImplementation(() => new Promise(() => {}))
  vi.useFakeTimers()
  try {
    const starting = run('start', '-s', SOCKET)
    await vi.advanceTimersByTimeAsync(30_000)
    await starting
    expect(stderr.join('')).toContain('The flow service is still starting after 30s')
    expect(process.exitCode).toBe(1)
  } finally {
    vi.useRealTimers()
  }
})

test('a request rejecting after the startup deadline is not left unhandled', async () => {
  const unhandled: Array<unknown> = []
  const onUnhandled = (reason: unknown) => {
    unhandled.push(reason)
  }
  process.on('unhandledRejection', onUnhandled)
  vi.useFakeTimers()
  try {
    let requested = false
    // A plain function: vi.fn attaches handlers to returned promises, masking the rejection.
    const request = () => {
      requested = true
      return new Promise((_resolve, reject) => {
        setTimeout(() => reject(new Error('connection closed')), 10)
      })
    }
    vi.mocked(connectFlowControl).mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 31_000))
      return { control: {}, client: { request }, dispose: vi.fn(async () => {}) } as never
    })
    const starting = run('start', '-s', SOCKET)
    await vi.advanceTimersByTimeAsync(31_100)
    await starting
    expect(requested).toBe(true)
    expect(stderr.join('')).toContain('The flow service is still starting after 30s')
  } finally {
    vi.useRealTimers()
  }
  await new Promise((resolve) => setImmediate(resolve))
  process.off('unhandledRejection', onUnhandled)
  expect(unhandled).toEqual([])
})

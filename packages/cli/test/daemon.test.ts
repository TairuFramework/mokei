import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type * as NodeStreamsExports from '@enkaku/node-streams'
import { createTransportStream } from '@enkaku/node-streams'
import type * as FlowHostNodeExports from '@mokei/flow-host-node'
import { createFlowService, type FlowService, type FlowServiceParams } from '@mokei/flow-host-node'
import {
  createDesktopInputSurface,
  createDesktopNotifier,
  createDesktopTools,
} from '@mokei/host-desktop'
import { startMonitor } from '@mokei/host-monitor'
import type * as HostNodeExports from '@mokei/host-node'
import { createClient, runDaemon, serveHostDaemon } from '@mokei/host-node'
import type { HostEvent } from '@mokei/host-protocol'
import type * as TejikaCLIExports from '@tejika/cli'
import { runInk } from '@tejika/cli'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { createMonitorCommand } from '../src/commands/monitor.js'
import { createProxyCommand } from '../src/commands/proxy.js'
import { ensureMokeiDaemon } from '../src/daemon.js'
import { startMokeiDaemon } from '../src/daemon-entry.js'

vi.mock('@mokei/host-node', async (importOriginal) => {
  const actual = await importOriginal<typeof HostNodeExports>()
  return { ...actual, runDaemon: vi.fn(), serveHostDaemon: vi.fn(actual.serveHostDaemon) }
})
vi.mock('@mokei/flow-host-node', async (importOriginal) => {
  const actual = await importOriginal<typeof FlowHostNodeExports>()
  return { ...actual, createFlowService: vi.fn(actual.createFlowService) }
})
vi.mock('@mokei/host-desktop', () => ({
  createDesktopInputSurface: vi.fn(),
  createDesktopNotifier: vi.fn(),
  createDesktopTools: vi.fn(),
}))
vi.mock('@enkaku/node-streams', async (importOriginal) => {
  const actual = await importOriginal<typeof NodeStreamsExports>()
  return { ...actual, createTransportStream: vi.fn(actual.createTransportStream) }
})
vi.mock('@mokei/host-monitor', () => ({
  startMonitor: vi.fn(async () => ({
    url: 'http://127.0.0.1:9876',
    disposer: { dispose: vi.fn(async () => {}) },
  })),
}))
vi.mock('@tejika/cli', async (importOriginal) => {
  const actual = await importOriginal<typeof TejikaCLIExports>()
  return { ...actual, runInk: vi.fn(async () => {}) }
})

let directory: string
let params: {
  socketPath: string
  pidPath: string
  configPath: string
  databasePath: string
  handleSignals: false
}
const surface = {
  canPrompt: vi.fn(() => true),
  prompt: vi.fn(async () => ({ action: 'cancel' as const })),
  notify: vi.fn(async () => {}),
  dispose: vi.fn(async () => {}),
}
const notifier = { notify: vi.fn(async () => {}), dispose: vi.fn(async () => {}) }

beforeEach(async () => {
  vi.clearAllMocks()
  directory = await mkdtemp(join(tmpdir(), 'mokei-cli-daemon-'))
  params = {
    socketPath: join(directory, 'daemon.sock'),
    pidPath: join(directory, 'daemon.pid'),
    configPath: join(directory, 'flows.json'),
    databasePath: join(directory, 'flows.db'),
    handleSignals: false,
  }
  vi.mocked(createDesktopInputSurface).mockReturnValue(surface)
  vi.mocked(createDesktopNotifier).mockReturnValue(notifier)
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

test('launch wrapper selects the composed entry', async () => {
  await ensureMokeiDaemon({ socketPath: params.socketPath })
  expect(runDaemon).toHaveBeenCalledWith({
    socketPath: params.socketPath,
    entry: fileURLToPath(new URL('../src/daemon-entry.js', import.meta.url)),
  })
})

test('proxy and monitor select the composed entry', async () => {
  const channel = {
    readable: new ReadableStream({ start: (controller) => controller.close() }),
    writable: new WritableStream(),
  }
  vi.mocked(runDaemon).mockResolvedValueOnce({
    createChannel: vi.fn(() => channel),
  } as unknown as HostNodeExports.HostClient)
  vi.mocked(createTransportStream).mockResolvedValueOnce({
    readable: new ReadableStream({ start: (controller) => controller.close() }),
    writable: new WritableStream(),
  })
  await createProxyCommand().parseAsync(['--socket-path', params.socketPath, 'node'], {
    from: 'user',
  })
  await createMonitorCommand().parseAsync(['--socket-path', params.socketPath], { from: 'user' })
  expect(runDaemon).toHaveBeenCalledTimes(2)
  for (const call of vi.mocked(runDaemon).mock.calls) {
    expect(call[0]).toEqual({
      socketPath: params.socketPath,
      entry: fileURLToPath(new URL('../src/daemon-entry.js', import.meta.url)),
    })
  }
  expect(startMonitor).toHaveBeenCalledWith({ socketPath: params.socketPath, port: undefined })
  expect(runInk).toHaveBeenCalledTimes(1)
})

test('importing the entry does not boot a daemon or create flow resources', async () => {
  vi.resetModules()
  await import('../src/daemon-entry.js')
  expect(serveHostDaemon).not.toHaveBeenCalled()
  expect(createFlowService).not.toHaveBeenCalled()
  expect(createDesktopInputSurface).not.toHaveBeenCalled()
})

test('generic serving is available while flow initialization is delayed', async () => {
  let finish!: () => void
  const initialization = new Promise<void>((resolve) => {
    finish = resolve
  })
  const service: FlowService = {
    status: () => ({ state: 'starting' }),
    resources: () => {
      throw new Error('Not ready')
    },
    run: async () => {
      throw new Error('Not ready')
    },
    start: vi.fn(() => {
      expect(existsSync(params.socketPath)).toBe(true)
      return initialization
    }),
    prompt: vi.fn(),
    dispose: vi.fn(async () => {}),
  }
  vi.mocked(createFlowService).mockReturnValueOnce(service)
  const daemon = await startMokeiDaemon(params)
  const client = await createClient(params.socketPath)
  try {
    expect(service.start).toHaveBeenCalledTimes(1)
    expect(await client.request('info')).toMatchObject({ flowService: { state: 'starting' } })
  } finally {
    finish()
    await client.dispose()
    await daemon.close()
  }
  expect(service.dispose).toHaveBeenCalledTimes(1)
})

test('failed flow initialization preserves info, events and proxy handlers', async () => {
  await writeFile(params.configPath, '{ invalid')
  const daemon = await startMokeiDaemon(params)
  const client = await createClient(params.socketPath)
  const stream = client.createStream('events')
  void stream.catch(() => {})
  const received: Array<HostEvent> = []
  const reading = (async () => {
    for await (const event of stream.readable) received.push(event)
  })()
  void reading.catch(() => {})
  try {
    await vi.waitFor(async () => {
      expect(await client.request('info')).toMatchObject({
        flowService: { state: 'failed', error: { type: 'FlowConfigError' } },
      })
    })
    await expect(client.request('flows.list')).rejects.toMatchObject({ code: 'FLOW_UNAVAILABLE' })
    const proxy = client.createChannel('spawn', {
      param: {
        command: process.execPath,
        args: [
          '-e',
          'process.stdout.write(JSON.stringify({ ready: true }) + "\\n"); setInterval(() => {}, 1000)',
        ],
      },
    })
    void proxy.catch(() => {})
    const reader = proxy.readable.getReader()
    expect(await reader.read()).toEqual({ done: false, value: { ready: true } })
    reader.releaseLock()
    await vi.waitFor(() => {
      expect(received.some((event) => event.type === 'context:start')).toBe(true)
    })
    proxy.close()
  } finally {
    stream.close()
    await reading.catch(() => {})
    await client.dispose()
    await daemon.close()
  }
})

test('two connections share one flow service and event bridge', async () => {
  const daemon = await startMokeiDaemon(params)
  const clients = await Promise.all([
    createClient(params.socketPath),
    createClient(params.socketPath),
  ])
  const streams = clients.map((client) => client.createStream('events'))
  const collectors = streams.map((stream) => {
    const events: Array<HostEvent> = []
    void stream.catch(() => {})
    const task = (async () => {
      for await (const event of stream.readable) events.push(event)
    })()
    void task.catch(() => {})
    return { task, events }
  })
  try {
    await vi.waitFor(async () => {
      const info = await Promise.all(clients.map((client) => client.request('info')))
      expect(info[0]?.flowService).toEqual({ state: 'ready' })
      expect(info[1]).toEqual(info[0])
    })
    expect(createFlowService).toHaveBeenCalledTimes(1)
    expect(await clients[0].request('flows.list')).toEqual([])
    expect(await clients[1].request('flows.list')).toEqual([])
    const serviceParams = vi.mocked(createFlowService).mock.calls[0]?.[0]
    expect(serviceParams).toBeDefined()
    const event: HostEvent = {
      type: 'service:status',
      meta: { eventID: crypto.randomUUID(), time: Date.now() },
      data: { service: 'flow', status: { state: 'ready' } },
    }
    serviceParams?.onEvent(event)
    await vi.waitFor(() => {
      for (const { events } of collectors) expect(events).toContainEqual(event)
    })
  } finally {
    for (const stream of streams) stream.close()
    await Promise.allSettled(collectors.map(({ task }) => task))
    await Promise.all(clients.map((client) => client.dispose()))
    await daemon.close()
  }
})

test('desktop adapter uses explicit prompts and generic notifications without model tools', async () => {
  await writeFile(params.configPath, JSON.stringify({ desktop: { notifications: true } }))
  let serviceParams!: FlowServiceParams
  const actual = await vi.importActual<typeof FlowHostNodeExports>('@mokei/flow-host-node')
  vi.mocked(createFlowService).mockImplementationOnce((options) => {
    serviceParams = options
    return actual.createFlowService(options)
  })
  const daemon = await startMokeiDaemon(params)
  try {
    const request = {
      params: {
        message: 'Input needed',
        requestedSchema: { type: 'object' as const, properties: {} },
      },
      signal: new AbortController().signal,
    }
    expect(serviceParams.desktop?.canPrompt(request)).toBe(true)
    expect(await serviceParams.desktop?.prompt(request)).toEqual({ action: 'cancel' })
    const onClick = () => {}
    await serviceParams.desktop?.notify('Flow needs your input', { group: 'g', onClick })
    expect(surface.prompt).toHaveBeenCalledWith(request)
    expect(notifier.notify).toHaveBeenCalledWith('Flow needs your input', { group: 'g', onClick })
    expect(surface.notify).not.toHaveBeenCalled()
    expect(createDesktopTools).not.toHaveBeenCalled()
  } finally {
    await daemon.close()
  }
  expect(surface.dispose).toHaveBeenCalledTimes(1)
  expect(notifier.dispose).toHaveBeenCalledTimes(1)
})

test('socket boot failure disposes the unstarted service and its desktop adapter', async () => {
  vi.mocked(serveHostDaemon).mockRejectedValueOnce(new Error('Socket boot failed'))
  await expect(startMokeiDaemon(params)).rejects.toThrow('Socket boot failed')
  expect(surface.dispose).toHaveBeenCalledTimes(1)
  expect(notifier.dispose).toHaveBeenCalledTimes(1)
})

test('unexpected startup rejection is reported without rejecting application boot', async () => {
  const error = new Error('Startup reporter failed')
  const report = vi.spyOn(console, 'error').mockImplementation(() => {})
  const actual = await vi.importActual<typeof FlowHostNodeExports>('@mokei/flow-host-node')
  vi.mocked(createFlowService).mockImplementationOnce((options) => ({
    ...actual.createFlowService(options),
    start: vi.fn(async () => {
      throw error
    }),
  }))
  const daemon = await startMokeiDaemon(params)
  const client = await createClient(params.socketPath)
  try {
    expect(await client.request('info')).toMatchObject({ flowService: { state: 'starting' } })
    expect(report).toHaveBeenCalledWith(error)
  } finally {
    await client.dispose()
    await daemon.close()
    report.mockRestore()
  }
})

test('injected desktop adapter belongs to the service and replaces native surfaces', async () => {
  const desktop = {
    canPrompt: vi.fn(() => false),
    prompt: vi.fn(async () => ({ action: 'cancel' as const })),
    notify: vi.fn(async () => {}),
    dispose: vi.fn(async () => {}),
  }
  const daemon = await startMokeiDaemon({ ...params, desktop })
  await daemon.close()
  await daemon.close()
  expect(createDesktopInputSurface).not.toHaveBeenCalled()
  expect(createDesktopNotifier).not.toHaveBeenCalled()
  expect(desktop.dispose).toHaveBeenCalledTimes(1)
})

test('cleanup drains both native surfaces when one disposal fails', async () => {
  const bootError = new Error('Socket boot failed')
  const disposalError = new Error('Dialog disposal failed')
  const delivery = Promise.withResolvers<void>()
  vi.mocked(serveHostDaemon).mockRejectedValueOnce(bootError)
  surface.dispose.mockRejectedValueOnce(disposalError)
  notifier.dispose.mockImplementationOnce(() => delivery.promise)
  let settled = false
  const boot = startMokeiDaemon(params)
  void boot.then(
    () => {
      settled = true
    },
    () => {
      settled = true
    },
  )
  await vi.waitFor(() => {
    expect(surface.dispose).toHaveBeenCalledTimes(1)
    expect(notifier.dispose).toHaveBeenCalledTimes(1)
  })
  expect(settled).toBe(false)
  delivery.resolve()
  await expect(boot).rejects.toMatchObject({
    message: 'Daemon boot and cleanup failed',
    errors: [bootError, expect.objectContaining({ message: 'Failed to dispose flow service' })],
  })
})

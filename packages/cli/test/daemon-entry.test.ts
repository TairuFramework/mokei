import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LocalTraceRecorder, openMokeiDatabase, type TraceRecorderEvent } from '@mokei/app-node'
import type * as FlowExports from '@mokei/flow-host-node'
import { createFlowService } from '@mokei/flow-host-node'
import type * as HostExports from '@mokei/host-node'
import { serveHostDaemon } from '@mokei/host-node'
import { expect, test, vi } from 'vitest'

import { startMokeiDaemonWithDependencies } from '../src/daemon-entry.js'

vi.mock('@mokei/flow-host-node', async (original) => {
  const actual = await original<typeof FlowExports>()
  return { ...actual, createFlowService: vi.fn(actual.createFlowService) }
})
vi.mock('@mokei/host-node', async (original) => {
  const actual = await original<typeof HostExports>()
  return { ...actual, serveHostDaemon: vi.fn() }
})

test('sweepInterrupted runs before service.start', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mokei-entry-'))
  const order: Array<string> = []
  let publish: ((event: TraceRecorderEvent) => void) | undefined
  let observed: unknown
  const sweepGate = Promise.withResolvers<void>()
  const service = {
    start: vi.fn(async () => {
      order.push('start')
    }),
    dispose: vi.fn(async () => {}),
    status: () => ({ state: 'starting' as const }),
    resources: vi.fn(),
    run: vi.fn(),
    prompt: vi.fn(),
  }
  vi.mocked(createFlowService).mockReturnValueOnce(service)
  let shutdown: (() => Promise<void>) | undefined
  vi.mocked(serveHostDaemon).mockImplementationOnce(async (options) => {
    order.push('serve')
    options.events.addEventListener('trace:summary', (event) => {
      observed = (event as CustomEvent<unknown>).detail
    })
    shutdown = options.onShutdown
    return {
      close: async () => {
        await shutdown?.()
      },
    } as Awaited<ReturnType<typeof serveHostDaemon>>
  })
  try {
    const boot = startMokeiDaemonWithDependencies(
      {
        desktop: {
          canPrompt: () => false,
          prompt: async () => ({ action: 'cancel' }),
          notify: async () => {},
          dispose: async () => {},
        },
      },
      {
        loadConfig: async () => {
          order.push('config')
          return { logs: { level: 'info', file: false }, tracing: { payloads: 'off' } }
        },
        openDatabase: async (options) => {
          order.push('database')
          return openMokeiDatabase({ ...options, path: join(directory, 'mokei.db') })
        },
        setupTelemetry: ({ provider, onEvent }) => {
          order.push('telemetry')
          publish = onEvent
          const recorder = new LocalTraceRecorder({ provider, onEvent })
          vi.spyOn(recorder, 'sweepInterrupted').mockImplementation(async () => {
            order.push('sweep')
            await sweepGate.promise
            return 0
          })
          return { recorder, dispose: () => recorder.shutdown() }
        },
      },
    )
    await vi.waitFor(() => expect(order).toContain('sweep'))
    expect(createFlowService).not.toHaveBeenCalled()
    expect(service.start).not.toHaveBeenCalled()
    sweepGate.resolve()
    const daemon = await boot
    expect(order).toEqual(['config', 'database', 'telemetry', 'sweep', 'serve', 'start'])
    expect(createFlowService).toHaveBeenCalledWith(
      expect.objectContaining({
        tracing: { payloads: 'off' },
        traceIndex: expect.any(Function),
      }),
    )
    expect(serveHostDaemon).toHaveBeenCalledWith(
      expect.objectContaining({
        tracing: { payloads: 'off' },
        tracingInfo: expect.any(Function),
        handlers: expect.objectContaining({
          'traces.list': expect.any(Function),
          'traces.get': expect.any(Function),
        }),
      }),
    )
    expect(publish).toBeTypeOf('function')
    const summary = {
      traceID: '0123456789abcdef0123456789abcdef',
      rootSpanID: '0123456789abcdef',
      kind: 'flow' as const,
      name: 'flow.run',
      active: true,
      outcome: null,
      startTime: Date.now(),
      attributes: {},
      spanCount: 0,
      errorCount: 0,
      droppedCount: 0,
      revision: 1,
    }
    publish?.({ type: 'trace:summary', data: summary })
    expect(observed).toEqual({
      meta: { eventID: expect.any(String), time: expect.any(Number) },
      data: summary,
    })
    await daemon.close()
  } finally {
    sweepGate.resolve()
    await shutdown?.()
    await rm(directory, { recursive: true, force: true })
  }
})

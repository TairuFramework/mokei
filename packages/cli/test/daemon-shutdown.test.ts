import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { LocalTraceRecorder, openMokeiDatabase } from '@mokei/app-node'
import type * as FlowHostNodeExports from '@mokei/flow-host-node'
import { createFlowService, type FlowConfig } from '@mokei/flow-host-node'
import type { HostEvent } from '@mokei/host-protocol'
import { NodeSession } from '@mokei/session-node'
import { expect, test, vi } from 'vitest'

import { createFlowHost } from '../../flow-host/src/host.js'
import { createFlowServiceWithDependencies } from '../../flow-host-node/src/service.js'
import { startMokeiDaemonWithDependencies } from '../src/daemon-entry.js'

vi.mock('@mokei/flow-host-node', async (importOriginal) => {
  const actual = await importOriginal<typeof FlowHostNodeExports>()
  return { ...actual, createFlowService: vi.fn(actual.createFlowService) }
})

test.each(['initialization', 'admitted call'] as const)(
  'composed shutdown drains delayed %s before closing its database',
  async (stage) => {
    const directory = await mkdtemp('/tmp/mokei-shutdown-')
    const order: Array<string> = []
    const events: Array<HostEvent> = []
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let entered!: () => void
    const entering = new Promise<void>((resolve) => {
      entered = resolve
    })
    const adapter = {
      canPrompt: () => false,
      prompt: async () => ({ action: 'cancel' as const }),
      notify: async () => {},
      dispose: async () => {
        order.push('desktop')
      },
    }
    let service!: FlowHostNodeExports.FlowService
    vi.mocked(createFlowService).mockImplementationOnce((params) => {
      service = createFlowServiceWithDependencies(
        {
          ...params,
          desktop: adapter,
          onEvent: (event) => {
            events.push(event)
          },
        },
        {
          loadConfig: async (): Promise<FlowConfig> => ({
            siblings: stage === 'initialization' ? { delayed: { command: 'injected' } } : {},
            flowDirs: [],
            approval: { allow: [] },
            retention: { days: 30 },
            desktop: { notifications: false },
          }),
          loadFlows: async () => ({ files: [], flows: [] }),
          createSession: () => {
            const session = new NodeSession({ elicit: true })
            vi.spyOn(session, 'addContext').mockImplementation(async () => {
              entered()
              await gate
              order.push('connected')
              return []
            })
            const dispose = session.dispose.bind(session)
            vi.spyOn(session, 'dispose').mockImplementation(async () => {
              order.push('session')
              await dispose()
            })
            return session
          },
          createHost: createFlowHost,
          startRetention: () => ({
            stop: async () => {
              order.push('retention')
            },
          }),
          report: (error) => {
            throw error
          },
        },
      )
      return service
    })
    const daemon = await startMokeiDaemonWithDependencies(
      {
        socketPath: join(directory, 'daemon.sock'),
        pidPath: join(directory, 'daemon.pid'),
        databasePath: join(directory, 'mokei.db'),
        desktop: adapter,
        handleSignals: false,
      },
      {
        loadConfig: async () => ({ logs: { level: 'info', file: false }, tracing: {} }),
        openDatabase: async (params) => {
          const database = await openMokeiDatabase(params)
          const close = database.close.bind(database)
          vi.spyOn(database, 'close').mockImplementation(async () => {
            order.push('database')
            await close()
          })
          return database
        },
        setupTelemetry: ({ provider }) => {
          const recorder = new LocalTraceRecorder({ provider })
          return {
            recorder,
            dispose: async () => {
              await recorder.shutdown()
              order.push('telemetry')
            },
          }
        },
      },
    )
    let working: Promise<unknown> | undefined
    try {
      if (stage === 'initialization') await entering
      else {
        await service.start()
        working = service.run(async ({ traceStore }) => {
          await gate
          await traceStore.getTrace('admitted')
          order.push('called')
        })
      }
      const closing = daemon.close()
      const outcome = closing.then(
        () => undefined,
        (error: unknown) => error,
      )
      await delay(6000)
      expect(order).toEqual(['desktop'])
      release()
      await working
      expect(await outcome).toBeUndefined()
      expect(order.slice(-3)).toEqual(['session', 'telemetry', 'database'])
      expect(order.filter((step) => step === 'database')).toHaveLength(1)
      if (stage === 'initialization') {
        expect(
          events.some(
            (event) => event.type === 'service:status' && event.data.status.state === 'ready',
          ),
        ).toBe(false)
      }
      expect(() => service.resources()).toThrow('shutting down')
    } finally {
      release()
      await service.dispose()
      await daemon.close().catch(() => {})
      await rm(directory, { recursive: true, force: true })
    }
  },
  20_000,
)

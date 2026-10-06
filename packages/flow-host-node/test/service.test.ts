import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FlowHostParams } from '@mokei/flow-host'
import { createFlowHost } from '@mokei/flow-host'
import type { HostEvent } from '@mokei/host-protocol'
import { NodeSession } from '@mokei/session-node'
import { afterEach, expect, test, vi } from 'vitest'

import type { FlowConfig } from '../src/config.js'
import { FlowConfigError, loadFlowConfig } from '../src/config.js'
import type { FlowDesktopAdapter } from '../src/desktop.js'
import { loadFlowDirs } from '../src/flow-dirs.js'
import { createMonitorPresence } from '../src/monitor-presence.js'
import type { FlowServiceDependencies, FlowServiceParams } from '../src/service.js'
import { createFlowServiceWithDependencies, FlowServiceUnavailableError } from '../src/service.js'
import { openFlowDatabase } from '../src/stores.js'
import { runRecord } from './support/records.js'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((yes) => {
    resolve = yes
  })
  return { promise, resolve }
}
const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((dispose) => dispose()))
})
const config: FlowConfig = {
  siblings: {},
  flowDirs: [],
  approval: { allow: [] },
  tracing: {},
  logs: { level: 'info' },
  retention: { days: 30 },
  desktop: { notifications: true },
}
function setup(
  overrides: Partial<FlowServiceDependencies> = {},
  desktopOverrides: Partial<FlowDesktopAdapter> = {},
  onEvent?: (event: HostEvent) => void,
  params: Partial<FlowServiceParams> = {},
) {
  const order: Array<string> = []
  const events: Array<HostEvent> = []
  const errors: Array<unknown> = []
  const messages: Array<string> = []
  const adapter: FlowDesktopAdapter = {
    canPrompt: () => true,
    prompt: async () => ({ action: 'cancel' }),
    notify: async (message) => {
      messages.push(message)
    },
    dispose: async () => {
      order.push('desktop')
    },
    ...desktopOverrides,
  }
  const dependencies: FlowServiceDependencies = {
    loadConfig: async () => config,
    loadFlows: async () => ({ files: [], flows: [] }),
    openDatabase: async () => {
      const database = await openFlowDatabase({ path: ':memory:' })
      const close = database.close.bind(database)
      vi.spyOn(database, 'close').mockImplementation(async () => {
        order.push('database')
        await close()
      })
      return database
    },
    setupTelemetry: () => ({
      dispose: async () => {
        order.push('telemetry')
      },
    }),
    createSession: () => {
      const session = new NodeSession({ elicit: true })
      const dispose = session.dispose.bind(session)
      vi.spyOn(session, 'dispose').mockImplementation(async () => {
        order.push('session')
        await dispose()
      })
      return session
    },
    createHost: async (params) => {
      const host = await createFlowHost(params)
      const dispose = host.dispose.bind(host)
      host.dispose = async () => {
        order.push('runtime')
        await dispose()
      }
      return host
    },
    startRetention: () => ({
      stop: async () => {
        order.push('retention')
      },
    }),
    report: (error) => {
      errors.push(error)
    },
    ...overrides,
  }
  const service = createFlowServiceWithDependencies(
    {
      ...params,
      desktop: adapter,
      onEvent: (event) => {
        events.push(event)
        onEvent?.(event)
      },
    },
    dependencies,
  )
  cleanup.push(() => service.dispose().catch(() => {}))
  return { service, dependencies, order, events, errors, messages }
}

test('recovery gates readiness and announces the committed inbox snapshot once', async () => {
  const recovered = deferred<void>()
  const entered = deferred<void>()
  const hostParams = deferred<FlowHostParams>()
  const fixture = setup({
    createHost: async (params) => {
      hostParams.resolve(params)
      await params.runStore?.create(
        runRecord({
          runID: 'approval',
          state: 'awaiting_approval',
          taskID: undefined,
          result: undefined,
          error: undefined,
          request: { toolName: 'unavailable:tool', arguments: {} },
        }),
      )
      // Use recovery's real inbox reconciliation, then hold the acquisition result.
      const host = await createFlowHost(params)
      entered.resolve()
      await recovered.promise
      return host
    },
  })
  const starting = fixture.service.start()
  await entered.promise
  expect(fixture.service.status()).toEqual({ state: 'starting' })
  expect(fixture.messages).toEqual([])
  expect(fixture.events.some((event) => event.type === 'inbox:added')).toBe(true)
  expect(() => fixture.service.resources()).toThrow(FlowServiceUnavailableError)
  recovered.resolve()
  await starting
  expect(fixture.service.status()).toEqual({ state: 'ready' })
  expect(fixture.messages).toEqual(['Flow needs your approval'])
  const params = await hostParams.promise
  const item = fixture.service.resources().host.inbox.list()[0]
  if (item == null) throw new Error('Expected recovered approval')
  await params.listeners?.['inbox:added']?.(item)
  expect(fixture.messages).toHaveLength(1)
})

test.each([
  ['loadConfig', []],
  ['loadFlows', []],
  ['openDatabase', []],
  ['setupTelemetry', ['database']],
  ['createSession', ['telemetry', 'database']],
  ['createHost', ['session', 'telemetry', 'database']],
  ['startRetention', ['runtime', 'session', 'telemetry', 'database']],
] as const)(
  'failure acquiring %s disables service and cleans earlier resources',
  async (stage, prior) => {
    const failure = new Error('secret-token in upstream response')
    const fixture = setup({
      [stage]: () => {
        throw failure
      },
    })
    await expect(fixture.service.start()).resolves.toBeUndefined()
    expect(fixture.service.status()).toMatchObject({ state: 'failed' })
    expect(JSON.stringify(fixture.service.status())).not.toContain('secret-token')
    expect(fixture.errors).toContain(failure)
    expect(fixture.order).toEqual(['desktop', ...prior])
    await expect(fixture.service.run(() => 'no')).rejects.toBeInstanceOf(
      FlowServiceUnavailableError,
    )
    await expect(
      fixture.service.prompt('missing', new AbortController().signal),
    ).rejects.toBeInstanceOf(FlowServiceUnavailableError)
    await fixture.service.dispose()
    expect(fixture.order).toEqual(['desktop', ...prior])
  },
)

test('stops before opening telemetry when disposed while the database opens', async () => {
  const gate = deferred<void>()
  const opening = deferred<void>()
  const setupTelemetry = vi.fn(() => ({ dispose: async () => {} }))
  const fixture = setup({ setupTelemetry })
  const openDatabase = fixture.dependencies.openDatabase
  fixture.dependencies.openDatabase = async (params) => {
    opening.resolve()
    await gate.promise
    return openDatabase(params)
  }
  const starting = fixture.service.start()
  await opening.promise
  const stopping = fixture.service.dispose()
  gate.resolve()
  await Promise.all([starting, stopping])
  expect(setupTelemetry).not.toHaveBeenCalled()
  expect(fixture.order).toEqual(['desktop', 'database'])
  expect(() => fixture.service.resources()).toThrow(FlowServiceUnavailableError)
})

test('failed sibling startup disposes the owning session and never registers flows', async () => {
  let disposed = false
  const fixture = setup({
    loadConfig: async () => ({ ...config, siblings: { sibling: { command: 'test-command' } } }),
    createSession: () => {
      const session = new NodeSession({ elicit: true })
      vi.spyOn(session, 'addContext').mockRejectedValue(new Error('credential'))
      const dispose = session.dispose.bind(session)
      vi.spyOn(session, 'dispose').mockImplementation(async () => {
        disposed = true
        await dispose()
      })
      return session
    },
  })
  await fixture.service.start()
  expect(fixture.service.status()).toMatchObject({ state: 'failed' })
  expect(disposed).toBe(true)
  expect(fixture.order).toEqual(['desktop', 'telemetry', 'database'])
})

test('shutdown waits for a late sibling connection, closes it once and never publishes ready', async () => {
  const gate = deferred<void>()
  const connecting = deferred<void>()
  let active = false
  let disposals = 0
  const fixture = setup({
    loadConfig: async () => ({
      ...config,
      siblings: { sibling: { command: 'test-command', args: ['arg'], env: { KEY: 'value' } } },
    }),
    createSession: () => {
      const session = new NodeSession({ elicit: true })
      vi.spyOn(session, 'addContext').mockImplementation(async (params) => {
        expect(params).toMatchObject({
          key: 'sibling',
          command: 'test-command',
          args: ['arg'],
          env: { KEY: 'value' },
        })
        connecting.resolve()
        await gate.promise
        active = true
        return []
      })
      const dispose = session.dispose.bind(session)
      vi.spyOn(session, 'dispose').mockImplementation(async () => {
        active = false
        disposals++
        await dispose()
      })
      return session
    },
  })
  const starting = fixture.service.start()
  expect(fixture.service.start()).toBe(starting)
  await connecting.promise
  const stopping = fixture.service.dispose()
  expect(fixture.service.dispose()).toBe(stopping)
  gate.resolve()
  await Promise.all([starting, stopping])
  expect(active).toBe(false)
  expect(disposals).toBe(1)
  expect(
    fixture.events.some(
      (event) => event.type === 'service:status' && event.data.status.state === 'ready',
    ),
  ).toBe(false)
  expect(fixture.order).toEqual(['desktop', 'telemetry', 'database'])
  expect(() => fixture.service.resources()).toThrow(FlowServiceUnavailableError)
})

test('shutdown closes admission immediately and drains admitted work before storage', async () => {
  const fixture = setup()
  await fixture.service.start()
  const gate = deferred<void>()
  const working = fixture.service.run(async ({ traceStore }) => {
    await gate.promise
    return traceStore.getTrace('test')
  })
  const stopping = fixture.service.dispose()
  expect(() => fixture.service.resources()).toThrow(FlowServiceUnavailableError)
  await expect(fixture.service.run(() => 'no')).rejects.toBeInstanceOf(FlowServiceUnavailableError)
  expect(fixture.order).toEqual(['desktop'])
  gate.resolve()
  await working
  await stopping
  expect(fixture.order).toEqual([
    'desktop',
    'retention',
    'runtime',
    'session',
    'telemetry',
    'database',
  ])
  expect(fixture.service.status()).toEqual({ state: 'ready' })
})

test('disposal before start owns the adapter without acquiring resources', async () => {
  const fixture = setup({
    loadConfig: () => {
      throw new Error('must not start')
    },
  })
  await fixture.service.dispose()
  await fixture.service.start()
  expect(fixture.order).toEqual(['desktop'])
  expect(fixture.errors).toEqual([])
})

test('all resources close even when retention and adapter disposal throw', async () => {
  const failure = new Error('retention stop')
  const fixture = setup(
    {
      startRetention: () => ({
        stop: async () => {
          throw failure
        },
      }),
    },
    {
      dispose: async () => {
        throw new Error('desktop stop')
      },
    },
  )
  await fixture.service.start()
  await expect(fixture.service.dispose()).rejects.toBeInstanceOf(AggregateError)
  expect(fixture.order).toEqual(['runtime', 'session', 'telemetry', 'database'])
})

test('configuration JSON diagnostics and dynamic field names cannot leak secrets to status or events', async () => {
  const failure = new FlowConfigError({
    path: '/tmp/flows.json',
    issues: [
      'JSON: Unexpected token secret-token',
      'siblings.secret-token.env.secret-token',
      'desktop.notifications',
    ],
  })
  const fixture = setup({
    loadConfig: async () => {
      throw failure
    },
  })
  await fixture.service.start()
  expect(fixture.service.status()).toMatchObject({
    state: 'failed',
    error: { type: 'FlowConfigError', path: '/tmp/flows.json' },
  })
  expect(JSON.stringify([fixture.service.status(), fixture.events])).not.toContain('secret-token')
  expect(fixture.errors).toContain(failure)
})

test('real malformed config and flow JSON fail before telemetry installation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'flow-service-'))
  cleanup.push(() => rm(directory, { recursive: true, force: true }))
  const path = join(directory, 'flows.json')
  await writeFile(path, '{"secret-token":')
  const telemetry = vi.fn(() => {
    throw new Error('telemetry must not install')
  })
  const invalidConfig = setup({ loadConfig: () => loadFlowConfig(path), setupTelemetry: telemetry })
  await invalidConfig.service.start()
  const invalidFlows = setup({
    loadFlows: () => loadFlowDirs([directory]),
    setupTelemetry: telemetry,
  })
  await invalidFlows.service.start()
  expect(invalidConfig.service.status()).toMatchObject({ state: 'failed' })
  expect(invalidFlows.service.status()).toMatchObject({ state: 'failed' })
  expect(JSON.stringify([invalidConfig.events, invalidFlows.events])).not.toContain('secret-token')
  expect(telemetry).not.toHaveBeenCalled()
})

test('immediate shutdown after start does not acquire configuration', async () => {
  const loadConfig = vi.fn(async () => config)
  const fixture = setup({ loadConfig })
  const starting = fixture.service.start()
  await fixture.service.dispose()
  await starting
  expect(loadConfig).not.toHaveBeenCalled()
})

test.each(['loadConfig', 'loadFlows', 'createHost'] as const)(
  'shutdown during %s cleans its eventual resources without advancing startup',
  async (stage) => {
    const gate = deferred<void>()
    const acquired = deferred<void>()
    const fixture = setup()
    if (stage === 'loadConfig') {
      fixture.dependencies.loadConfig = async () => {
        acquired.resolve()
        await gate.promise
        return config
      }
    } else if (stage === 'loadFlows') {
      fixture.dependencies.loadFlows = async () => {
        acquired.resolve()
        await gate.promise
        return { files: [], flows: [] }
      }
    } else {
      const createHost = fixture.dependencies.createHost
      fixture.dependencies.createHost = async (params) => {
        const host = await createHost(params)
        acquired.resolve()
        await gate.promise
        return host
      }
    }
    const starting = fixture.service.start()
    await acquired.promise
    let finished = false
    const stopping = fixture.service.dispose().then(() => {
      finished = true
    })
    await Promise.resolve()
    expect(finished).toBe(false)
    gate.resolve()
    await Promise.all([starting, stopping])
    expect(fixture.order).toEqual(
      stage === 'createHost'
        ? ['desktop', 'runtime', 'session', 'telemetry', 'database']
        : ['desktop'],
    )
    expect(
      fixture.events.some(
        (event) => event.type === 'service:status' && event.data.status.state === 'ready',
      ),
    ).toBe(false)
  },
)

test('registered invalid flow fails with sanitized status and closes session and storage', async () => {
  const fixture = setup({
    loadFlows: async () => ({
      files: ['/tmp/invalid.json'],
      flows: [{ id: 'secret-token', name: 'Invalid', version: 1, start: 'missing', nodes: {} }],
    }),
  })
  await fixture.service.start()
  expect(fixture.service.status()).toMatchObject({ state: 'failed' })
  expect(JSON.stringify(fixture.events)).not.toContain('secret-token')
  expect(fixture.order).toEqual(['desktop', 'session', 'telemetry', 'database'])
})

test('shutdown aborts an admitted prompt, drains its native completion and preserves pending input', async () => {
  const native = deferred<{ action: 'cancel' }>()
  const opened = deferred<AbortSignal>()
  const fixture = setup(
    {
      createHost: async (params) => {
        await params.runStore?.create(
          runRecord({
            runID: 'approval',
            state: 'awaiting_approval',
            result: undefined,
            error: undefined,
          }),
        )
        return createFlowHost(params)
      },
    },
    {
      prompt: (request) => {
        opened.resolve(request.signal)
        return native.promise
      },
    },
  )
  await fixture.service.start()
  const host = fixture.service.resources().host
  const item = host.inbox.list()[0]
  if (item == null) throw new Error('Expected recovered approval')
  const prompting = fixture.service
    .prompt(item.id, new AbortController().signal)
    .catch((error: unknown) => error)
  const signal = await opened.promise
  let stopped = false
  const stopping = fixture.service.dispose().then(() => {
    stopped = true
  })
  await prompting
  expect(signal.aborted).toBe(true)
  expect(stopped).toBe(false)
  expect(fixture.order).toEqual(['desktop'])
  expect(host.inbox.get(item.id)).toBeDefined()
  native.resolve({ action: 'cancel' })
  await stopping
  expect(fixture.order).toEqual(['desktop', 'retention', 'session', 'telemetry', 'database'])
})

test('operation rejection releases shutdown drainage and preserves the original error', async () => {
  const fixture = setup()
  await fixture.service.start()
  const failure = new Error('operation failed')
  await expect(
    fixture.service.run(() => {
      throw failure
    }),
  ).rejects.toBe(failure)
  await fixture.service.dispose()
  expect(fixture.order.at(-1)).toBe('database')
})

test('startup notification follows ready publication and retention startup', async () => {
  const sequence: Array<string> = []
  const fixture = setup(
    {
      createHost: async (params) => {
        await params.runStore?.create(
          runRecord({ state: 'awaiting_approval', result: undefined, error: undefined }),
        )
        return createFlowHost(params)
      },
      startRetention: () => {
        sequence.push('retention')
        return { stop: async () => {} }
      },
    },
    {
      notify: async () => {
        sequence.push('notification')
      },
    },
    (event) => {
      if (event.type === 'service:status' && event.data.status.state === 'ready')
        sequence.push('ready')
    },
  )
  await fixture.service.start()
  expect(sequence).toEqual(['retention', 'ready', 'notification'])
})

test('shutdown from ready publication suppresses startup notifications', async () => {
  let stopping: Promise<void> | undefined
  const fixture = setup(
    {
      createHost: async (params) => {
        await params.runStore?.create(
          runRecord({ state: 'awaiting_approval', result: undefined, error: undefined }),
        )
        return createFlowHost(params)
      },
    },
    {},
    (event) => {
      if (event.type === 'service:status' && event.data.status.state === 'ready')
        stopping = fixture.service.dispose()
    },
  )
  await fixture.service.start()
  await stopping
  expect(fixture.messages).toEqual([])
  expect(fixture.order).toEqual(['desktop', 'retention', 'session', 'telemetry', 'database'])
})

test.each(['answered', 'declined', 'cancelled', 'withdrawn'] as const)(
  'service monitor prompt receives %s outcome',
  async (outcome) => {
    const monitor = createMonitorPresence()
    const { attachmentID } = monitor.attach('http://127.0.0.1:4000/')
    let shown = false
    const tab = monitor.connect(attachmentID, {
      close() {},
      send(message) {
        if (message.type === 'ping') tab.receive({ type: 'pong', nonce: message.nonce })
        if (message.type === 'prompt') {
          shown = true
          tab.receive({ type: 'ack', attemptID: message.attemptID, shown: true })
        }
      },
    })
    tab.receive({ type: 'state', visible: true, canNotify: false })
    cleanup.push(async () => monitor.dispose())
    const fixture = setup(
      {
        createHost: async (params) => {
          await params.runStore?.create(
            runRecord({ state: 'awaiting_approval', result: undefined, error: undefined }),
          )
          return createFlowHost(params)
        },
      },
      {},
      undefined,
      { monitor },
    )
    await fixture.service.start()
    const host = fixture.service.resources().host
    const item = host.inbox.list()[0]
    if (item == null) throw new Error('Expected approval')
    const prompting = fixture.service
      .prompt(item.id, new AbortController().signal)
      .catch((error: unknown) => error)
    await vi.waitFor(() => expect(shown).toBe(true))
    if (outcome === 'answered') await host.inbox.answer(item.id)
    else if (outcome === 'declined') await host.inbox.decline(item.id)
    else if (outcome === 'cancelled') await host.inbox.cancel(item.id)
    else await host.events.emit('inbox:settled', { item, outcome: 'withdrawn' })
    if (outcome === 'withdrawn')
      expect(await prompting).toMatchObject({ name: 'InboxItemNotFoundError' })
    else
      expect(await prompting).toEqual({
        action: outcome === 'answered' ? 'accept' : outcome === 'declined' ? 'decline' : 'cancel',
      })
  },
)

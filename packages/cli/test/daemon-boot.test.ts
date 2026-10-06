import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { MokeiConfigError, openMokeiDatabase } from '@mokei/app-node'
import type * as FlowHostNodeExports from '@mokei/flow-host-node'
import { createFlowService } from '@mokei/flow-host-node'
import { createClient } from '@mokei/host-node'
import { trace } from '@opentelemetry/api'
import { getLogger } from '@sozai/log'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { startMokeiDaemon, startMokeiDaemonWithDependencies } from '../src/daemon-entry.js'

vi.mock('@mokei/flow-host-node', async (importOriginal) => {
  const actual = await importOriginal<typeof FlowHostNodeExports>()
  return { ...actual, createFlowService: vi.fn(actual.createFlowService) }
})

let directory: string
let params: {
  socketPath: string
  pidPath: string
  configPath: string
  flowsConfigPath: string
  databasePath: string
  handleSignals: false
  desktop: FlowHostNodeExports.FlowDesktopAdapter
}

beforeEach(async () => {
  vi.clearAllMocks()
  directory = await mkdtemp(join(tmpdir(), 'mokei-daemon-boot-'))
  params = {
    socketPath: join(directory, 'daemon.sock'),
    pidPath: join(directory, 'daemon.pid'),
    configPath: join(directory, 'mokei.json'),
    flowsConfigPath: join(directory, 'flows.json'),
    databasePath: join(directory, 'mokei.db'),
    handleSignals: false,
    desktop: {
      canPrompt: () => false,
      prompt: async () => ({ action: 'cancel' }),
      notify: async () => {},
      dispose: async () => {},
    },
  }
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

test('rejects an invalid mokei.json before opening the database', async () => {
  await writeFile(params.configPath, JSON.stringify({ bogus: 1 }))
  const error = await startMokeiDaemon(params).catch((value: unknown) => value)
  expect(error).toBeInstanceOf(MokeiConfigError)
  expect(error).toMatchObject({ path: params.configPath, issues: ['bogus'] })
  expect(existsSync(params.databasePath)).toBe(false)
  expect(createFlowService).not.toHaveBeenCalled()
})

test('disposes the flow service, then telemetry, then the database', async () => {
  const order: Array<string> = []
  const actual = await vi.importActual<typeof FlowHostNodeExports>('@mokei/flow-host-node')
  vi.mocked(createFlowService).mockImplementationOnce((options) => {
    const service = actual.createFlowService(options)
    const dispose = service.dispose
    return {
      ...service,
      dispose: async () => {
        order.push('service')
        await dispose()
      },
    }
  })
  const daemon = await startMokeiDaemonWithDependencies(params, {
    loadConfig: async () => ({ logs: { level: 'info', file: false }, tracing: {} }),
    openDatabase: async (options) => {
      const database = await openMokeiDatabase(options)
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
  })
  await daemon.close()
  expect(order).toEqual(['service', 'telemetry', 'database'])
})

async function startWithFailingDisposal(failures: { service?: Error; telemetry?: Error }) {
  const actual = await vi.importActual<typeof FlowHostNodeExports>('@mokei/flow-host-node')
  vi.mocked(createFlowService).mockImplementationOnce((options) => {
    const service = actual.createFlowService(options)
    const dispose = service.dispose
    return {
      ...service,
      dispose: async () => {
        await dispose()
        if (failures.service != null) throw failures.service
      },
    }
  })
  const closed = vi.fn()
  const daemon = await startMokeiDaemonWithDependencies(params, {
    loadConfig: async () => ({ logs: { level: 'info', file: false }, tracing: {} }),
    openDatabase: async (options) => {
      const database = await openMokeiDatabase(options)
      const close = database.close.bind(database)
      vi.spyOn(database, 'close').mockImplementation(async () => {
        closed()
        await close()
      })
      return database
    },
    setupTelemetry: () => ({
      dispose: async () => {
        if (failures.telemetry != null) throw failures.telemetry
      },
    }),
  })
  return { daemon, closed }
}

test('closes the database and rethrows a single disposal failure as is', async () => {
  const failure = new Error('telemetry dispose failed')
  const { daemon, closed } = await startWithFailingDisposal({ telemetry: failure })
  await expect(daemon.close()).rejects.toBe(failure)
  expect(closed).toHaveBeenCalledOnce()
})

test('closes the database and aggregates several disposal failures', async () => {
  const service = new Error('service dispose failed')
  const telemetry = new Error('telemetry dispose failed')
  const { daemon, closed } = await startWithFailingDisposal({ service, telemetry })
  const error = await daemon.close().then(
    () => undefined,
    (reason: unknown) => reason,
  )
  expect(error).toBeInstanceOf(AggregateError)
  expect((error as AggregateError).message).toBe('Daemon shutdown failed')
  expect((error as AggregateError).errors).toEqual([service, telemetry])
  expect(closed).toHaveBeenCalledOnce()
})

test('releases the database when telemetry setup fails', async () => {
  let database: Awaited<ReturnType<typeof openMokeiDatabase>> | undefined
  const failure = new Error('telemetry failed')
  const boot = startMokeiDaemonWithDependencies(params, {
    loadConfig: async () => ({ logs: { level: 'info', file: false }, tracing: {} }),
    openDatabase: async (options) => {
      database = await openMokeiDatabase(options)
      vi.spyOn(database, 'close')
      return database
    },
    setupTelemetry: () => {
      throw failure
    },
  })
  await expect(boot).rejects.toBe(failure)
  expect(database?.close).toHaveBeenCalledTimes(1)
  expect(createFlowService).not.toHaveBeenCalled()
})

// Installs the process-wide telemetry for real, so it must stay the only such test in this file.
test('captures telemetry while the flow service is failed', async () => {
  await writeFile(params.configPath, JSON.stringify({ logs: { file: false } }))
  await writeFile(params.flowsConfigPath, JSON.stringify({ bogus: 1 }))
  const daemon = await startMokeiDaemon(params)
  try {
    const client = await createClient(params.socketPath)
    try {
      await vi.waitFor(async () => {
        expect(await client.request('info')).toMatchObject({
          flowService: { state: 'failed', error: { type: 'FlowConfigError' } },
        })
      })
    } finally {
      await client.dispose()
    }
    trace.getTracer('test').startActiveSpan('probe', (span) => {
      getLogger(['test']).info('Probe record')
      span.end()
    })
  } finally {
    await daemon.close()
  }
  const db = new DatabaseSync(params.databasePath, { readOnly: true })
  try {
    const count = (table: string) => {
      const row = db.prepare(`SELECT count(*) AS count FROM ${table}`).get()
      return Number(row?.count)
    }
    expect(count('hozon_spans')).toBeGreaterThanOrEqual(1)
    expect(count('hozon_logs')).toBeGreaterThanOrEqual(1)
  } finally {
    db.close()
  }
})

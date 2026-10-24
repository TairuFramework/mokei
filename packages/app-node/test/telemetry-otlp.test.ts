import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { metrics, trace } from '@opentelemetry/api'
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace'
import { getLogger } from '@sozai/log'
import { createFileSink } from '@tejika/log'
import { expect, test, vi } from 'vitest'

import { setupMokeiTelemetry } from '../src/index.js'
import { useTestStores } from './support/stores.js'

const stores = useTestStores()
vi.mock('@opentelemetry/sdk-trace', { spy: true })

const file = vi.hoisted(() => ({ sink: vi.fn(), dispose: vi.fn() }))
vi.mock('@tejika/log', () => ({
  createFileSink: vi.fn(() => Object.assign(file.sink, { [Symbol.dispose]: file.dispose })),
}))

test('exports OTLP spans to a local HTTP receiver', async () => {
  expect(setupMokeiTelemetry).toBeTypeOf('function')
  const requests: Array<{ path?: string; header?: string | Array<string>; body: string }> = []
  const server = createServer((request, response) => {
    const chunks: Array<Buffer> = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      requests.push({
        path: request.url,
        header: request.headers['x-telemetry-test'],
        body: Buffer.concat(chunks).toString(),
      })
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end('{}')
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const { db, logStore, telemetryStore } = await stores()
  const port = (server.address() as AddressInfo).port
  let handle: ReturnType<typeof setupMokeiTelemetry> | undefined
  try {
    handle = setupMokeiTelemetry({
      provider: db,
      otlp: {
        endpoint: `http://127.0.0.1:${port}/v1/traces`,
        headers: { 'x-telemetry-test': 'configured' },
      },
      logs: { level: 'debug' },
    })
    expect(BatchSpanProcessor).toHaveBeenCalledOnce()
    expect(createFileSink).toHaveBeenCalledExactlyOnceWith({
      app: 'mokei',
      name: 'mokei',
      rotate: 'daily',
    })
    const traceID = trace.getTracer('otlp-test').startActiveSpan('exported span', (span) => {
      getLogger('application').debug('included debug')
      span.end()
      return span.spanContext().traceId
    })
    await handle.dispose()
    expect(await telemetryStore.getSpans(traceID)).toHaveLength(1)
    expect(requests).toHaveLength(1)
    expect(requests[0]?.path).toBe('/v1/traces')
    expect(requests[0]?.header).toBe('configured')
    expect(requests[0]?.body).toContain('exported span')
    expect((await logStore.getTraceLogs(traceID)).map((log) => log.message)).toEqual([
      'included debug',
    ])
    expect(file.sink).toHaveBeenCalledOnce()
    expect(file.dispose).toHaveBeenCalledOnce()
  } finally {
    try {
      await handle?.dispose()
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      )
    }
  }
})

// setupMokeiTelemetry installs once per module instance, so each test loads a fresh one.
async function freshModule(): Promise<typeof import('../src/index.js')> {
  vi.resetModules()
  return await import('../src/index.js')
}

async function withReceiver(
  run: (receiver: {
    port: number
    requests: Array<{ path?: string; body: string }>
  }) => Promise<void>,
): Promise<void> {
  const requests: Array<{ path?: string; body: string }> = []
  const server = createServer((request, response) => {
    const chunks: Array<Buffer> = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      requests.push({ path: request.url, body: Buffer.concat(chunks).toString() })
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end('{}')
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  try {
    await run({ port: (server.address() as AddressInfo).port, requests })
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
  }
}

test('exports spans with the default and configured resource', async () => {
  const { db } = await stores()
  const { setupMokeiTelemetry: setup } = await freshModule()
  await withReceiver(async ({ port, requests }) => {
    const handle = setup({
      provider: db,
      otlp: { endpoint: `http://127.0.0.1:${port}/v1/traces` },
      service: { version: '1.2.3' },
      logs: { file: false },
    })
    trace.getTracer('resource-test').startSpan('resource span').end()
    await handle.dispose()
    const body = requests.find((request) => request.path === '/v1/traces')?.body ?? ''
    expect(body).toContain('"service.name"')
    expect(body).toContain('"stringValue":"mokei"')
    expect(body).toContain('"service.version"')
    expect(body).toContain('"stringValue":"1.2.3"')
  })
})

test('exports metrics to the endpoint derived from the traces endpoint', async () => {
  const { db } = await stores()
  const { setupMokeiTelemetry: setup } = await freshModule()
  await withReceiver(async ({ port, requests }) => {
    const handle = setup({
      provider: db,
      otlp: { endpoint: `http://127.0.0.1:${port}/v1/traces` },
      service: { name: 'custom-service' },
      logs: { file: false },
    })
    metrics.getMeter('metrics-test').createCounter('mokei.test.counter').add(1)
    await handle.dispose()
    const metricRequest = requests.find((request) => request.path === '/v1/metrics')
    expect(metricRequest?.body).toContain('mokei.test.counter')
    expect(metricRequest?.body).toContain('custom-service')
  })
})

test('exports metrics to a custom metrics endpoint', async () => {
  const { db } = await stores()
  const { setupMokeiTelemetry: setup } = await freshModule()
  await withReceiver(async ({ port, requests }) => {
    const handle = setup({
      provider: db,
      otlp: {
        endpoint: `http://127.0.0.1:${port}/v1/traces`,
        metricsEndpoint: `http://127.0.0.1:${port}/custom-metrics`,
      },
      logs: { file: false },
    })
    metrics.getMeter('metrics-test').createCounter('mokei.test.counter').add(1)
    await handle.dispose()
    expect(requests.some((request) => request.path === '/custom-metrics')).toBe(true)
    expect(requests.some((request) => request.path === '/v1/metrics')).toBe(false)
  })
})

test('registers no meter provider when the metrics endpoint cannot be derived', async () => {
  const { db } = await stores()
  const { setupMokeiTelemetry: setup } = await freshModule()
  await withReceiver(async ({ port, requests }) => {
    const handle = setup({
      provider: db,
      otlp: { endpoint: `http://127.0.0.1:${port}/custom` },
      logs: { file: false },
    })
    expect(
      Reflect.get(Reflect.get(globalThis, Symbol.for('opentelemetry.js.api.1')), 'metrics'),
    ).toBeUndefined()
    await handle.dispose()
    expect(requests.some((request) => request.path?.includes('metrics'))).toBe(false)
  })
})

test('dispose unregisters the meter provider', async () => {
  const { db } = await stores()
  const { setupMokeiTelemetry: setup } = await freshModule()
  await withReceiver(async ({ port }) => {
    const handle = setup({
      provider: db,
      otlp: { endpoint: `http://127.0.0.1:${port}/v1/traces` },
      logs: { file: false },
    })
    const registry = Reflect.get(globalThis, Symbol.for('opentelemetry.js.api.1'))
    expect(Reflect.get(registry, 'metrics')).toBeDefined()
    await handle.dispose()
    expect(Reflect.get(registry, 'metrics')).toBeUndefined()
  })
})

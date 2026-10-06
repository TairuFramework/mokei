import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { trace } from '@opentelemetry/api'
import { getLogger } from '@sozai/log'
import { createFileSink } from '@tejika/log'
import { expect, test, vi } from 'vitest'

import { setupMokeiTelemetry } from '../src/index.js'
import { useTestStores } from './support/stores.js'

const stores = useTestStores()

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
  const { logStore, telemetryStore } = await stores()
  const port = (server.address() as AddressInfo).port
  let handle: ReturnType<typeof setupMokeiTelemetry> | undefined
  try {
    handle = setupMokeiTelemetry({
      logStore,
      telemetryStore,
      otlp: {
        endpoint: `http://127.0.0.1:${port}/v1/traces`,
        headers: { 'x-telemetry-test': 'configured' },
      },
      logs: { level: 'debug' },
    })
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

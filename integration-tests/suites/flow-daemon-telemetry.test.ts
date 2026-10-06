import { existsSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { expect, test } from 'vitest'

import { type FlowDaemonFixture, startFlowDaemonFixture } from '../support/flow-daemon/driver.js'

test.each([
  { name: 'delayed success', delayMs: 6500, status: 200, exitCode: 0 },
  { name: 'remote failure', delayMs: 0, status: 400, exitCode: 1 },
])(
  'production daemon preserves local capture and closes SQLite after collector $name',
  async ({ delayMs, status, exitCode }) => {
    const timers = new Set<ReturnType<typeof setTimeout>>()
    let replies = 0
    const collector = createServer((request, response) => {
      request.resume()
      request.on('end', () => {
        const timer = setTimeout(() => {
          timers.delete(timer)
          replies++
          response.writeHead(status, { 'content-type': 'application/json' })
          response.end('{}')
        }, delayMs)
        timers.add(timer)
      })
    })
    await new Promise<void>((resolve, reject) => {
      collector.once('error', reject)
      collector.listen(0, '127.0.0.1', resolve)
    })
    let fixture: FlowDaemonFixture | undefined
    try {
      const { port } = collector.address() as AddressInfo
      fixture = await startFlowDaemonFixture({
        productionEntry: true,
        otlp: { endpoint: `http://127.0.0.1:${port}/v1/traces` },
      })
      const client = await fixture.connect()
      const run = await client.request('runs.start', { param: { flow: 'end' }, timeout: 10_000 })
      expect(await fixture.terminal(client, run.runID)).toMatchObject({ state: 'completed' })
      const start = Date.now()
      await fixture.stop(exitCode)
      if (delayMs > 5000) expect(Date.now() - start).toBeGreaterThan(5000)
      expect(Date.now() - start).toBeLessThan(60_000)
      expect(replies).toBeGreaterThan(0)
      if (exitCode !== 0) {
        // The daemon, not the flow service, owns telemetry.
        expect(fixture.diagnostics()).toContain('Failed to dispose mokei telemetry')
        expect(fixture.diagnostics()).not.toContain('Failed to dispose flow service')
        expect(fixture.diagnostics()).not.toContain('onShutdown timed out')
      }
      if (run.traceID == null) throw new Error('Missing trace ID')
      // Check before opening another reader, which could itself checkpoint a leftover WAL.
      expect(existsSync(join(fixture.directory, 'mokei.db-wal'))).toBe(false)
      expect((await fixture.readTrace(run.traceID)).spans).toContainEqual(
        expect.objectContaining({ name: 'flow.run', traceID: run.traceID }),
      )
    } finally {
      for (const timer of timers) clearTimeout(timer)
      collector.closeAllConnections()
      await new Promise<void>((resolve) => collector.close(() => resolve()))
      await fixture?.dispose()
    }
  },
)

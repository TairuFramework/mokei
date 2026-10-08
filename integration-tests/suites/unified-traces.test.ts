import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { ProxyHost } from '@mokei/host-node'
import type { TracesGetResult } from '@mokei/host-protocol'
import { expect, test } from 'vitest'

import { type FlowDaemonFixture, startFlowDaemonFixture } from '../support/flow-daemon/driver.js'

function persistedSummary(fixture: FlowDaemonFixture, traceID: string) {
  const database = new DatabaseSync(join(fixture.directory, 'mokei.db'), { readOnly: true })
  try {
    return database
      .prepare('SELECT active, revision FROM mokei_traces WHERE trace_id = ?')
      .get(traceID)
  } finally {
    database.close()
  }
}

test('a flow run that calls a tool yields one trace with flow.run above mcp.tools/call, linked to the context trace', async () => {
  const fixture = await startFlowDaemonFixture()
  try {
    const client = await fixture.connect()
    const run = await client.request('runs.start', { param: { flow: 'approval' } })
    const item = await fixture.pending(client, run.runID)
    await client.request('inbox.answer', { param: { id: item.id, content: { approve: true } } })
    expect(await fixture.terminal(client, run.runID)).toMatchObject({ state: 'completed' })
    if (run.traceID == null) throw new Error('Missing flow trace')
    const trace = await client.request('traces.get', { param: { traceID: run.traceID } })
    const root = trace.spans.find((span) => span.name === 'flow.run')
    const call = trace.spans.find((span) => span.name === 'mcp.tools/call')
    expect(root).toBeDefined()
    expect(call).toBeDefined()
    expect(call?.attributes['mokei.mcp.request']).toBeTypeOf('string')
    const ancestors = new Map(trace.spans.map((span) => [span.spanID, span.parentSpanID]))
    let parent = call?.parentSpanID
    while (parent != null && parent !== root?.spanID) parent = ancestors.get(parent)
    expect(parent).toBe(root?.spanID)
    const contexts = await client.request('traces.list', { param: { kind: 'context', limit: 10 } })
    expect(call?.links).toContainEqual(
      expect.objectContaining({ traceID: contexts.traces[0]?.traceID }),
    )
    expect(
      (await client.request('traces.list', { param: { kind: 'flow', limit: 10 } })).traces.map(
        (trace) => trace.traceID,
      ),
    ).toEqual([run.traceID])
    const legacy = await fixture.wait('persisted run trace', async () => {
      const result = await client.request('runs.trace', { param: { runID: run.runID } })
      return result.spans.some((span) => span.spanID === call?.spanID) ? result : undefined
    })
    expect(legacy.spans).toContainEqual(expect.objectContaining({ spanID: call?.spanID }))
  } finally {
    await fixture.dispose()
  }
})

test('a spawned proxied context yields a context trace with paired request spans', async () => {
  const fixture = await startFlowDaemonFixture({ invalidConfig: true, logLevel: 'info' })
  try {
    const client = await fixture.connect()
    const proxy = new ProxyHost({ client })
    try {
      const context = await proxy.spawn({ key: 'echo', ...fixture.sibling })
      await context.callTool({ name: 'echo', arguments: { value: 'trace me' } })
      // `notify` is typed to the client's declared notifications; `cancelled` exists in both revisions.
      const notify = context.notify.bind(context) as (
        event: string,
        params: object,
      ) => Promise<void>
      await notify('cancelled', { requestId: 'unknown-request', reason: 'trace check' })
      const list = await client.request('traces.list', { param: { kind: 'context', limit: 10 } })
      expect(list.traces).toHaveLength(1)
      const summary = list.traces[0]
      if (summary == null) throw new Error('Missing context trace')
      await fixture.wait('persisted context request span', () => {
        const database = new DatabaseSync(join(fixture.directory, 'mokei.db'), { readOnly: true })
        try {
          return database
            .prepare(
              "SELECT seq FROM mokei_spans WHERE trace_id = ? AND json_extract(data, '$.name') = 'mcp.tools/call'",
            )
            .get(summary.traceID)
        } finally {
          database.close()
        }
      })
      const trace = await fixture.wait('captured context notification', async () => {
        const result = await client.request('traces.get', { param: { traceID: summary.traceID } })
        return result.logs.some((log) => log.properties.method === 'notifications/cancelled')
          ? result
          : undefined
      })
      expect(trace.logs).toContainEqual(
        expect.objectContaining({
          category: ['mokei', 'mcp', 'notification'],
          level: 'debug',
          properties: expect.objectContaining({ method: 'notifications/cancelled' }),
        }),
      )
      const calls = trace.spans.filter((span) => span.name === 'mcp.tools/call')
      expect(calls).toHaveLength(1)
      expect(calls[0]).toMatchObject({
        endTime: expect.any(Number),
        attributes: expect.objectContaining({
          'mokei.mcp.request': expect.stringContaining('trace me'),
          'jsonrpc.request.id': expect.any(String),
        }),
        events: expect.arrayContaining([expect.objectContaining({ name: 'mcp.response' })]),
      })
    } finally {
      await proxy.dispose()
    }
  } finally {
    await fixture.dispose()
  }
})

test("restart marks an active run's trace interrupted, then recovery reactivates it", async () => {
  const fixture = await startFlowDaemonFixture()
  try {
    const client = await fixture.connect()
    const run = await client.request('runs.start', { param: { flow: 'input' } })
    await fixture.pending(client, run.runID)
    if (run.traceID == null) throw new Error('Missing flow trace')
    const traceID = run.traceID
    await fixture.wait(
      'persisted active trace',
      () => persistedSummary(fixture, traceID)?.active === 1,
    )
    await fixture.kill()
    await writeFile(join(fixture.directory, 'flows.json'), '{invalid')
    await fixture.restart('failed')
    const swept = await fixture.connect()
    const interrupted = await swept.request('traces.get', { param: { traceID } })
    expect(interrupted.summary).toMatchObject({ active: false, outcome: 'interrupted' })
    await fixture.stop()
    await writeFile(
      join(fixture.directory, 'flows.json'),
      JSON.stringify({ flowDirs: ['./flows'], siblings: { sibling: fixture.sibling } }),
    )
    await fixture.restart()
    const second = await fixture.connect()
    const trace = await second.request('traces.get', { param: { traceID } })
    expect(trace.summary).toMatchObject({ active: true, outcome: null })
    expect(trace.spans.some((span) => span.name === 'flow.run.resume')).toBe(true)
    await second.request('inbox.answer', {
      param: { id: (await fixture.pending(second, run.runID)).id, content: { value: 'recovered' } },
    })
    await fixture.terminal(second, run.runID)
  } finally {
    await fixture.dispose()
  }
})

test('live events arrive on the events stream before the trace is persisted', async () => {
  const fixture = await startFlowDaemonFixture({ flushIntervalMs: 600_000 })
  try {
    const client = await fixture.connect()
    const stream = client.createStream('events')
    const observed = Promise.withResolvers<{ trace: TracesGetResult; persistedCount: number }>()
    const reading = (async () => {
      for await (const event of stream.readable) {
        if (event.type !== 'span:start' || event.data.name !== 'flow.run') continue
        const persisted = persistedSummary(fixture, event.data.traceID)
        const trace = await client.request('traces.get', { param: { traceID: event.data.traceID } })
        expect(event.meta).toMatchObject({ eventID: expect.any(String), time: expect.any(Number) })
        observed.resolve({ trace, persistedCount: persisted == null ? 0 : 1 })
      }
    })()
    void reading.catch((error: unknown) => observed.reject(error))
    try {
      await client.request('info')
      await client.request('runs.start', { param: { flow: 'input' } })
      const result = await fixture.within('live span', observed.promise)
      expect(result.persistedCount).toBe(0)
      expect(result.trace.spans).toContainEqual(expect.objectContaining({ name: 'flow.run' }))
    } finally {
      stream.close()
      await reading.catch(() => {})
    }
  } finally {
    await fixture.dispose()
  }
})

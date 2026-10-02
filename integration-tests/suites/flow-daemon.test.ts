import { existsSync } from 'node:fs'
import { ProxyHost } from '@mokei/host-node'
import { expect, test } from 'vitest'

import { startFlowDaemonFixture } from '../support/flow-daemon/driver.js'

for (const replacement of ['stop', 'kill'] as const) {
  test(`resumes durable waiting input after daemon ${replacement}`, async () => {
    const fixture = await startFlowDaemonFixture()
    try {
      const first = await fixture.connect()
      const run = await first.request('runs.start', { timeout: 10_000, param: { flow: 'input' } })
      const before = await fixture.pending(first, run.runID)
      const checkpoint = await fixture.wait('durable input checkpoint', async () => {
        const stored = fixture.readDatabase()
        return stored.tasks.length === 1 &&
          stored.tasks[0]?.status === 'input_required' &&
          stored.tasks[0]?.resumeData != null &&
          stored.tasks[0]?.inputs.some((input) => input.outcome == null) &&
          stored.runs[0]?.state === 'input_required'
          ? stored
          : undefined
      })
      expect(run.traceID).toMatch(/^[a-f\d]{32}$/)
      await fixture[replacement]()
      if (run.traceID == null) throw new Error('Missing run trace')
      if (replacement === 'stop') {
        const suspended = await fixture.readTrace(run.traceID)
        expect(suspended.spans).toContainEqual(
          expect.objectContaining({
            name: 'flow.run',
            traceID: run.traceID,
            attributes: expect.objectContaining({ 'run.id': run.runID }),
          }),
        )
      }
      await fixture.restart()
      const second = await fixture.connect()
      const { createdAt: _createdAt, ...identity } = before
      expect(
        await second.request('inbox.list', { timeout: 10_000, param: { runID: run.runID } }),
      ).toMatchObject([identity])
      expect(
        await second.request('runs.get', { timeout: 10_000, param: { runID: run.runID } }),
      ).toMatchObject({
        traceID: run.traceID,
        state: 'input_required',
      })
      const recovered = fixture.readDatabase()
      expect(recovered.tasks.map((task) => task.taskID)).toEqual(
        checkpoint.tasks.map((task) => task.taskID),
      )
      expect(recovered.runs[0]?.taskID).toBe(checkpoint.runs[0]?.taskID)
      await second.request('inbox.answer', {
        timeout: 10_000,
        param: { id: before.id, content: { value: 'Ada' } },
      })
      expect(await fixture.terminal(second, run.runID)).toMatchObject({
        state: 'completed',
        result: { output: { answer: { value: 'Ada' } } },
      })
      await fixture.stop()
      const stored = fixture.readDatabase()
      expect(stored.tasks).toHaveLength(1)
      expect(stored.tasks[0]?.taskID).toBe(checkpoint.tasks[0]?.taskID)
      const trace = await fixture.readTrace(run.traceID)
      const spans = trace.spans
      expect(spans).toContainEqual(
        expect.objectContaining({
          name: 'flow.run.resume',
          traceID: run.traceID,
          parentSpanID: checkpoint.runs[0]?.traceparent?.split('-')[2],
          attributes: expect.objectContaining({ 'run.id': run.runID }),
        }),
      )
      expect(spans.every((span) => span.endTime >= span.startTime)).toBe(true)
    } finally {
      await fixture.dispose()
    }
    expect(existsSync(fixture.directory)).toBe(false)
  })
}

test('restores approval and launches the sibling tool exactly once', async () => {
  const fixture = await startFlowDaemonFixture()
  try {
    const first = await fixture.connect()
    const run = await first.request('runs.start', { timeout: 10_000, param: { flow: 'approval' } })
    const item = await fixture.pending(first, run.runID)
    expect(item.kind).toBe('approval')
    expect(fixture.readDatabase().tasks).toEqual([])
    await fixture.stop()
    await fixture.restart()
    const second = await fixture.connect()
    expect(await second.request('inbox.list', { timeout: 10_000, param: {} })).toEqual([item])
    await second.request('inbox.answer', { timeout: 10_000, param: { id: item.id } })
    expect(await fixture.terminal(second, run.runID)).toMatchObject({ state: 'completed' })
    await expect(
      second.request('inbox.answer', { timeout: 10_000, param: { id: item.id } }),
    ).rejects.toMatchObject({
      code: 'INBOX_ITEM_NOT_FOUND',
    })
    await fixture.stop()
    expect(fixture.siblingRecords().filter((record) => record.type === 'echo')).toEqual([
      expect.objectContaining({ value: 'approved' }),
    ])
    expect(fixture.readDatabase().tasks).toHaveLength(1)
  } finally {
    await fixture.dispose()
  }
})

test('invalid flow configuration preserves proxy echo and shared monitor state', async () => {
  const fixture = await startFlowDaemonFixture({ invalidConfig: true })
  try {
    const first = await fixture.connect()
    const second = await fixture.connect()
    expect(await first.request('info', { timeout: 10_000 })).toMatchObject({
      flowService: { state: 'failed', error: { type: 'FlowConfigError' } },
    })
    await expect(first.request('runs.list', { timeout: 10_000, param: {} })).rejects.toMatchObject({
      code: 'FLOW_UNAVAILABLE',
    })
    const proxy = new ProxyHost({ client: first })
    try {
      const context = await proxy.spawn({ key: 'echo', ...fixture.sibling })
      expect(
        await fixture.within(
          'proxy echo',
          context.callTool({ name: 'echo', arguments: { value: 'proxy works' }, timeout: 10_000 }),
        ),
      ).toMatchObject({
        content: [{ type: 'text', text: 'proxy works' }],
      })
      const info = await second.request('info', { timeout: 10_000 })
      expect(Object.keys(info.activeContexts)).toHaveLength(1)
      expect(await first.request('info', { timeout: 10_000 })).toEqual(info)
    } finally {
      await fixture.within('proxy disposal', proxy.dispose())
    }
  } finally {
    await fixture.dispose()
  }
})

test('clients share runs and receive each event once across subscriber cancellation and reconnect', async () => {
  const fixture = await startFlowDaemonFixture()
  try {
    const first = await fixture.connect()
    const second = await fixture.connect()
    const left = await fixture.subscribe(first)
    const right = await fixture.subscribe(second)
    const run = await first.request('runs.start', { timeout: 10_000, param: { flow: 'input' } })
    const item = await fixture.pending(first, run.runID)
    await fixture.wait(
      'both inbox subscribers',
      () =>
        left.events.some((event) => event.type === 'inbox:added') &&
        right.events.some((event) => event.type === 'inbox:added'),
    )
    expect(await second.request('runs.list', { timeout: 10_000, param: {} })).toEqual(
      await first.request('runs.list', { timeout: 10_000, param: {} }),
    )
    await left.close()
    const leftCount = left.events.length
    await fixture.within('first client disposal', first.dispose())
    await second.request('inbox.answer', {
      timeout: 10_000,
      param: { id: item.id, content: { value: 'Grace' } },
    })
    await fixture.wait('remaining subscriber completion', () =>
      right.events.some(
        (event) =>
          event.type === 'run:state' &&
          event.data.runID === run.runID &&
          event.data.state === 'completed',
      ),
    )
    expect(left.events).toHaveLength(leftCount)
    const reconnected = await fixture.connect()
    const renewed = await fixture.subscribe(reconnected)
    const next = await reconnected.request('runs.start', {
      timeout: 10_000,
      param: { flow: 'end' },
    })
    await fixture.wait('new event on both subscribers', () =>
      [right, renewed].every(({ events }) =>
        events.some(
          (event) =>
            event.type === 'run:state' &&
            event.data.runID === next.runID &&
            event.data.state === 'completed',
        ),
      ),
    )
    await Promise.all([right.close(), renewed.close()])
    for (const subscription of [left, right, renewed]) {
      expect(new Set(subscription.events.map((event) => event.meta.eventID)).size).toBe(
        subscription.events.length,
      )
    }
    expect(left.events.filter((event) => event.type === 'inbox:added')).toHaveLength(1)
    expect(right.events.filter((event) => event.type === 'inbox:added')).toHaveLength(1)
    expect(
      renewed.events.every((event) => event.type !== 'run:state' || event.data.runID !== run.runID),
    ).toBe(true)
    expect(fixture.siblingRecords().filter((record) => record.type === 'started')).toHaveLength(1)
  } finally {
    await fixture.dispose()
  }
})

test('desktop notifications default to disabled for restored and live items', async () => {
  const fixture = await startFlowDaemonFixture()
  try {
    const first = await fixture.connect()
    const run = await first.request('runs.start', { timeout: 10_000, param: { flow: 'input' } })
    await fixture.pending(first, run.runID)
    await fixture.stop()
    await fixture.restart()
    const second = await fixture.connect()
    const live = await second.request('runs.start', { timeout: 10_000, param: { flow: 'input' } })
    await fixture.pending(second, live.runID)
    await fixture.stop()
    expect(fixture.notifications()).toEqual([])
  } finally {
    await fixture.dispose()
  }
})

for (const restoredCount of [0, 1, 3]) {
  test(`notifies once for ${restoredCount} restored items and once for a live item`, async () => {
    const fixture = await startFlowDaemonFixture({ notifications: true })
    try {
      const first = await fixture.connect()
      expect(fixture.notifications()).toEqual([])
      for (let index = 0; index < restoredCount; index++) {
        const run = await first.request('runs.start', { timeout: 10_000, param: { flow: 'input' } })
        await fixture.pending(first, run.runID)
      }
      await fixture.stop()
      const priorCount = fixture.notifications().length
      expect(priorCount).toBe(restoredCount)
      await fixture.restart()
      const second = await fixture.connect()
      const startup =
        restoredCount === 0
          ? []
          : [restoredCount === 1 ? 'Flow needs your input' : '3 pending prompts']
      if (startup.length)
        await fixture.wait(
          'startup notification',
          () => fixture.notifications().length === priorCount + 1,
        )
      expect(fixture.notifications().slice(priorCount)).toEqual(startup)
      const live = await second.request('runs.start', { timeout: 10_000, param: { flow: 'input' } })
      await fixture.pending(second, live.runID)
      await fixture.wait(
        'live notification',
        () => fixture.notifications().length === priorCount + startup.length + 1,
      )
      for (let index = 0; index < 3; index++)
        await second.request('inbox.list', { timeout: 10_000, param: {} })
      await fixture.within('second client disposal', second.dispose())
      const third = await fixture.connect()
      await third.request('inbox.list', { timeout: 10_000, param: {} })
      await fixture.stop()
      expect(fixture.notifications().slice(priorCount)).toEqual([
        ...startup,
        'Flow needs your input',
      ])
      expect(fixture.desktopRecords().filter((record) => record.type === 'prompt')).toEqual([])
    } finally {
      await fixture.dispose()
    }
  })
}

test.each(['abort', 'disconnect'] as const)(
  'caller %s preserves pending input and releases prompt ownership',
  async (cancellation) => {
    const fixture = await startFlowDaemonFixture()
    try {
      const first = await fixture.connect()
      const second = await fixture.connect()
      const run = await first.request('runs.start', { timeout: 10_000, param: { flow: 'input' } })
      const item = await fixture.pending(first, run.runID)
      const caller = new AbortController()
      const prompting = first.request('inbox.prompt', {
        timeout: 10_000,
        param: { id: item.id },
        signal: caller.signal,
      })
      const rejected = prompting.catch((error: unknown) => error)
      await fixture.wait('first dialog', () =>
        fixture.desktopRecords().some((record) => record.type === 'prompt' && record.index === 0),
      )
      if (cancellation === 'abort') caller.abort(new Error('caller cancelled'))
      else await fixture.within('prompt caller disconnection', first.dispose())
      expect(await rejected).not.toMatchObject({ action: 'accept' })
      await fixture.wait('native dialog abort', () =>
        fixture.desktopRecords().some((record) => record.type === 'aborted' && record.index === 0),
      )
      expect(
        await second.request('inbox.get', { timeout: 10_000, param: { id: item.id } }),
      ).toEqual(item)
      const retry = second.request('inbox.prompt', { timeout: 10_000, param: { id: item.id } })
      await fixture.wait('replacement dialog', () =>
        fixture.desktopRecords().some((record) => record.type === 'prompt' && record.index === 1),
      )
      await fixture.answerPrompt(0, 'late answer')
      expect(
        await second.request('inbox.get', { timeout: 10_000, param: { id: item.id } }),
      ).toEqual(item)
      await fixture.answerPrompt(1, 'Ada')
      expect(await retry).toEqual({ action: 'accept' })
      expect(await fixture.terminal(second, run.runID)).toMatchObject({
        state: 'completed',
        result: { output: { answer: { value: 'Ada' } } },
      })
    } finally {
      await fixture.dispose()
    }
  },
)

test('remote settlement aborts a dialog and prevents its late answer', async () => {
  const fixture = await startFlowDaemonFixture()
  try {
    const first = await fixture.connect()
    const second = await fixture.connect()
    const events = await fixture.subscribe(second)
    const run = await first.request('runs.start', { timeout: 10_000, param: { flow: 'input' } })
    const item = await fixture.pending(first, run.runID)
    const prompting = first.request('inbox.prompt', { timeout: 10_000, param: { id: item.id } })
    const rejected = prompting.catch((error: unknown) => error)
    await fixture.wait('dialog open', () =>
      fixture.desktopRecords().some((record) => record.type === 'prompt'),
    )
    await second.request('inbox.answer', {
      timeout: 10_000,
      param: { id: item.id, content: { value: 'remote' } },
    })
    expect(await rejected).toMatchObject({ code: 'INBOX_ITEM_NOT_FOUND' })
    await fixture.wait('dialog aborted', () =>
      fixture.desktopRecords().some((record) => record.type === 'aborted'),
    )
    await fixture.answerPrompt(0, 'late answer')
    expect(await fixture.terminal(second, run.runID)).toMatchObject({
      state: 'completed',
      result: { output: { answer: { value: 'remote' } } },
    })
    await fixture.wait('settlement event', () =>
      events.events.some((event) => event.type === 'inbox:settled'),
    )
    await events.close()
    expect(events.events.filter((event) => event.type === 'inbox:settled')).toHaveLength(1)
    expect(await second.request('inbox.list', { timeout: 10_000, param: {} })).toEqual([])
  } finally {
    await fixture.dispose()
  }
})

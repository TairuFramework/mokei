import assert from 'node:assert/strict'
import { mkdtemp, open, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import type { RigDriver, StubCall } from '../support/flow-rig/rig-driver.ts'
import { startRig } from '../support/flow-rig/rig-driver.ts'

const queryFlow = {
  input: {},
  definition: {
    id: 'confirm-query',
    name: 'Confirm query',
    version: 1,
    start: 'q',
    nodes: {
      q: {
        kind: 'tool',
        tool: 'sqlite:sqlite_all',
        args: { sql: { value: 'SELECT 1 AS one' } },
        next: 'done',
      },
      done: { kind: 'end', outcome: 'queried', output: { rows: { ref: ['results', 'q'] } } },
    },
  },
}

describe('inbox rig', () => {
  let rig: RigDriver | undefined

  beforeAll(async () => {
    rig = await startRig({ input: 'inbox' })
  }, 60_000)

  afterAll(async () => {
    if (rig == null) return
    try {
      expect(rig.data<{ runnerCalls: number }>(await rig.call('stub_dialogs')).runnerCalls).toBe(0)
    } finally {
      await rig.dispose()
    }
  }, 30_000)

  async function withRuns(action: (driver: RigDriver, runIDs: Array<string>) => Promise<void>) {
    if (rig == null) throw new Error('Rig has not started')
    const runIDs: Array<string> = []
    try {
      await action(rig, runIDs)
    } finally {
      await rig.cleanup(runIDs)
    }
  }

  async function start(driver: RigDriver, runIDs: Array<string>, args: Record<string, unknown>) {
    const { runID } = driver.data<{ runID: string }>(await driver.call('start_flow', args))
    expect(runID).toBeTypeOf('string')
    runIDs.push(runID)
    return runID
  }

  test('lists the sample flows', async () => {
    await withRuns(async (driver) => {
      const result = await driver.call('list_flows')
      driver.data(result)
      for (const flow of ['demo/ask', 'demo/nested', 'demo/triage']) {
        expect(JSON.stringify(result.content)).toContain(flow)
      }
    })
  })

  test('check_flow reports issues', async () => {
    await withRuns(async (driver) => {
      const checked = driver.data<{ ok: boolean; issues: Array<unknown> }>(
        await driver.call('check_flow', { definition: { id: 'bad', nodes: {} } }),
      )
      expect(checked.ok).toBe(false)
      expect(checked.issues.length).toBeGreaterThan(0)
    })
  })

  test('stub_answer rejects an unknown index', async () => {
    await withRuns(async (driver) => {
      const result = await driver.call('stub_answer', {
        index: 999,
        result: { status: 'declined' },
      })
      expect(result.isError).toBe(true)
      expect(result.content).toEqual([{ type: 'text', text: 'No pending dialog at 999' }])
    })
  })

  for (const scenario of [
    {
      name: 'answers demo/ask through answer_input',
      flow: 'demo/ask',
      decline: false,
      outcome: 'answered',
      output: { value: 'hi' },
    },
    {
      name: 'declines demo/ask through decline_input',
      flow: 'demo/ask',
      decline: true,
      outcome: 'declined',
      output: {},
    },
    {
      name: 'answers the inner input of demo/nested',
      flow: 'demo/nested',
      decline: false,
      outcome: 'answered',
      output: { output: { value: 'hi' } },
    },
  ]) {
    test(scenario.name, async () => {
      await withRuns(async (driver, runIDs) => {
        const runID = await start(driver, runIDs, { flow: scenario.flow })
        const pending = await driver.waitFor(
          runID,
          (s) => s.pending.length === 1,
          'one pending input',
        )
        const entry = pending.pending[0]
        assert.ok(entry)
        const inputID = entry.id
        driver.data(
          await driver.call(scenario.decline ? 'decline_input' : 'answer_input', {
            id: inputID,
            ...(scenario.decline ? {} : { value: { value: 'hi' } }),
          }),
        )
        const done = await driver.waitFor(runID, (s) => s.state === 'completed', 'flow completion')
        expect(done.result?.isError).not.toBe(true)
        expect(done.result?.structuredContent).toMatchObject({ outcome: scenario.outcome })
        expect(done.result?.structuredContent?.output).toEqual(scenario.output)
      })
    })
  }

  test('prompts demo/ask through a dialog', async () => {
    await withRuns(async (driver, runIDs) => {
      const w1 = await driver.watermark()
      const runID = await start(driver, runIDs, { flow: 'demo/ask' })
      const notification = await driver.waitForDialog(
        w1,
        (call) => call.type === 'notify',
        'inbox notification',
      )
      expect(notification.text).toContain('flow-rig: demo/ask needs your input')
      const pending = await driver.waitFor(
        runID,
        (s) => s.pending.length === 1,
        'one pending input',
      )
      const entry = pending.pending[0]
      assert.ok(entry)
      const inputID = entry.id
      const w2 = await driver.watermark()
      const prompted = driver.startBlocking('prompt_input', { id: inputID })
      const ask = await driver.waitForDialog(
        w2,
        (call) => call.type === 'ask' && call.pending,
        'prompt dialog',
      )
      const { calls } = driver.data<{ calls: Array<StubCall> }>(await driver.call('stub_dialogs'))
      expect(
        calls.filter((call) => call.index > w2 && call.type === 'ask' && call.pending),
      ).toHaveLength(1)
      driver.data(
        await driver.call('stub_answer', {
          index: ask.index,
          result: { status: 'answered', value: 'hi' },
        }),
      )
      expect(driver.data(await prompted.promise)).toEqual({ id: inputID, action: 'accept' })
      const done = await driver.waitFor(
        runID,
        (s) => s.state === 'completed',
        'prompted flow completion',
      )
      expect(done.result?.isError).not.toBe(true)
      expect(done.result?.structuredContent).toMatchObject({ outcome: 'answered' })
      expect(done.result?.structuredContent?.output).toEqual({ value: 'hi' })
    })
  })

  for (const approved of [true, false]) {
    test(`confirms a flow outside the allowlist with ${approved ? 'yes' : 'no'}`, async () => {
      await withRuns(async (driver, runIDs) => {
        const watermark = await driver.watermark()
        const runID = await start(driver, runIDs, queryFlow)
        const ask = await driver.waitForDialog(
          watermark,
          (call) => call.type === 'ask' && call.pending,
          'confirm dialog',
        )
        expect(ask).toMatchObject({ backend: 'zenity', kind: 'confirm' })
        expect(driver.data(await driver.call('flow_status', { runID }))).toMatchObject({
          state: 'awaiting_approval',
          pending: [],
        })
        driver.data(
          await driver.call('stub_answer', {
            index: ask.index,
            result: { status: 'answered', value: approved },
          }),
        )
        if (!approved) {
          const denied = await driver.waitFor(runID, (s) => s.state === 'denied', 'denied run')
          expect(denied.error).toMatchObject({ type: 'FlowDenied', message: 'Flow denied' })
          return
        }
        const done = await driver.waitFor(
          runID,
          (s) => s.state === 'completed',
          'approved flow completion',
        )
        expect(done.result?.isError).not.toBe(true)
        expect(done.result?.structuredContent).toMatchObject({ outcome: 'queried' })
        expect(done.result?.structuredContent?.output).toEqual({ rows: [{ one: 1 }] })
      })
    })
  }

  test('shutdown cancels a queued run and closes its confirm dialog', async () => {
    const driver = await startRig({ input: 'inbox' })
    try {
      const watermark = await driver.watermark()
      const { runID } = driver.data<{ runID: string }>(await driver.call('start_flow', queryFlow))
      expect(runID).toBeTypeOf('string')
      const ask = await driver.waitForDialog(
        watermark,
        (call) => call.type === 'ask' && call.pending,
        'abandoned confirm dialog',
      )
      expect(driver.data(await driver.call('flow_status', { runID }))).toMatchObject({
        state: 'awaiting_approval',
        pending: [],
      })
      const cleanupStartedAt = performance.now()
      driver.data(await driver.call('stub_shutdown'))
      expect(performance.now() - cleanupStartedAt).toBeLessThan(5000)
      expect(driver.data(await driver.call('flow_status', { runID }))).toMatchObject({
        state: 'cancelled',
        pending: [],
      })
      await driver.waitForDialog(
        watermark,
        (call) => call.index === ask.index && !call.pending,
        'withdrawn confirm dialog',
      )
    } finally {
      await driver.dispose()
    }
    await withRuns(async (driver, runIDs) => {
      const fresh = await driver.watermark()
      const nextRunID = await start(driver, runIDs, queryFlow)
      const nextAsk = await driver.waitForDialog(
        fresh,
        (call) => call.type === 'ask' && call.pending,
        'next confirm dialog',
      )
      expect(nextAsk).toMatchObject({ backend: 'zenity', kind: 'confirm' })
      driver.data(
        await driver.call('stub_answer', {
          index: nextAsk.index,
          result: { status: 'answered', value: false },
        }),
      )
      const denied = await driver.waitFor(nextRunID, (s) => s.state === 'denied', 'denied run')
      expect(denied.error).toMatchObject({ type: 'FlowDenied', message: 'Flow denied' })
      const runID = await start(driver, runIDs, { flow: 'demo/ask' })
      const pending = await driver.waitFor(
        runID,
        (s) => s.state === 'input_required',
        'following inbox input',
      )
      expect(pending.pending).toHaveLength(1)
    })
  })

  test('triages with the fake label', async () => {
    await withRuns(async (driver, runIDs) => {
      const runID = await start(driver, runIDs, { flow: 'demo/triage' })
      const done = await driver.waitFor(runID, (s) => s.state === 'completed', 'triage completion')
      expect(done.result?.isError).not.toBe(true)
      expect(done.result?.structuredContent).toMatchObject({ outcome: 'triaged' })
      expect(done.result?.structuredContent?.output).toEqual({ row: { label: 'question' } })
    })
  })

  test('reports node_failed for a missing fake answer', async () => {
    await withRuns(async (driver, runIDs) => {
      const runID = await start(driver, runIDs, {
        input: {},
        definition: {
          id: 'missing-answer',
          name: 'Missing answer',
          version: 1,
          start: 'decide',
          nodes: {
            decide: {
              kind: 'decide',
              state: { ref: ['input'] },
              questions: {
                missing: {
                  type: 'choice',
                  instructions: 'Choose a label',
                  criteria: { yes: 'yes', no: 'no' },
                },
              },
              cases: [],
              default: 'done',
            },
            done: { kind: 'end', outcome: 'done' },
          },
        },
      })
      const done = await driver.waitFor(
        runID,
        (s) => s.state === 'failed',
        'failed flow completion',
      )
      expect(done.error).toMatchObject({ code: 'node_failed' })
    })
  })

  test('cancel_flow clears the pending input', async () => {
    await withRuns(async (driver, runIDs) => {
      const runID = await start(driver, runIDs, { flow: 'demo/ask' })
      const pending = await driver.waitFor(
        runID,
        (s) => s.pending.length === 1,
        'one pending input',
      )
      const entry = pending.pending[0]
      assert.ok(entry)
      const inputID = entry.id
      expect(driver.data(await driver.call('cancel_flow', { runID }))).toEqual({
        state: 'cancelled',
      })
      expect(driver.data(await driver.call('flow_status', { runID }))).toMatchObject({
        state: 'cancelled',
        pending: [],
      })
      const result = await driver.call('answer_input', { id: inputID, value: { value: 'hi' } })
      expect(result.isError).toBe(true)
      expect(result.content).toEqual([{ type: 'text', text: `Unknown input: ${inputID}` }])
    })
  })
})

describe('dialog rig', () => {
  let rig: RigDriver | undefined

  beforeAll(async () => {
    rig = await startRig({ input: 'dialog' })
  }, 60_000)

  afterAll(async () => {
    if (rig == null) return
    try {
      expect(rig.data<{ runnerCalls: number }>(await rig.call('stub_dialogs')).runnerCalls).toBe(0)
    } finally {
      await rig.dispose()
    }
  }, 30_000)

  async function withRuns(action: (driver: RigDriver, runIDs: Array<string>) => Promise<void>) {
    if (rig == null) throw new Error('Rig has not started')
    const runIDs: Array<string> = []
    try {
      await action(rig, runIDs)
    } finally {
      await rig.cleanup(runIDs)
    }
  }

  test('opens a dialog directly for demo/ask', async () => {
    await withRuns(async (driver, runIDs) => {
      const watermark = await driver.watermark()
      const { runID } = driver.data<{ runID: string }>(
        await driver.call('start_flow', { flow: 'demo/ask' }),
      )
      runIDs.push(runID)
      const ask = await driver.waitForDialog(
        watermark,
        (call) => call.type === 'ask' && call.pending,
        'direct input dialog',
      )
      const pending = await driver.waitFor(
        runID,
        (s) => s.state === 'input_required',
        'dialog input required',
      )
      expect(pending.pending).toEqual([])
      driver.data(
        await driver.call('stub_answer', {
          index: ask.index,
          result: { status: 'answered', value: 'hi' },
        }),
      )
      const done = await driver.waitFor(
        runID,
        (s) => s.state === 'completed',
        'dialog flow completion',
      )
      expect(done.result?.isError).not.toBe(true)
      expect(done.result?.structuredContent).toMatchObject({ outcome: 'answered' })
      expect(done.result?.structuredContent?.output).toEqual({ value: 'hi' })
    })
  })

  test('cancelling a run withdraws its open dialog', async () => {
    await withRuns(async (driver, runIDs) => {
      const watermark = await driver.watermark()
      const { runID } = driver.data<{ runID: string }>(
        await driver.call('start_flow', { flow: 'demo/ask' }),
      )
      runIDs.push(runID)
      const ask = await driver.waitForDialog(
        watermark,
        (call) => call.type === 'ask' && call.pending,
        'cancelled input dialog',
      )
      expect(driver.data(await driver.call('cancel_flow', { runID }))).toEqual({
        state: 'cancelled',
      })
      await driver.waitForDialog(
        watermark,
        (call) => call.index === ask.index && !call.pending,
        'withdrawn input dialog',
      )
      const fresh = await driver.watermark()
      const next = driver.data<{ runID: string }>(
        await driver.call('start_flow', { flow: 'demo/ask' }),
      )
      runIDs.push(next.runID)
      await driver.waitForDialog(
        fresh,
        (call) => call.type === 'ask' && call.pending,
        'following input dialog',
      )
    })
  })
})

describe('startRig', () => {
  test('startRig rejects for an invalid config', async () => {
    // Child stdio needs a real file descriptor, so capture stderr through a temp file.
    const dir = await mkdtemp(join(tmpdir(), 'flow-rig-stderr-'))
    const path = join(dir, 'stderr.log')
    const sink = await open(path, 'w')
    try {
      await expect(
        startRig({
          input: 'inbox',
          stderr: sink.fd,
          configOverrides: {
            flowsDir: fileURLToPath(
              new URL('../support/flow-rig/nonexistent-flows', import.meta.url),
            ),
          },
        }),
      ).rejects.toThrow()
      await sink.close()
      const stderr = await readFile(path, 'utf8')
      expect(stderr).toContain('ENOENT')
      expect(stderr).toContain('nonexistent-flows')
    } finally {
      await sink.close()
      await rm(dir, { recursive: true, force: true })
    }
  }, 60_000)
})

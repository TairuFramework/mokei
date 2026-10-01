import assert from 'node:assert/strict'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import type { RigDriver } from '../support/flow-rig/rig-driver.ts'
import { startRig } from '../support/flow-rig/rig-driver.ts'

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
        (s) => s.state === 'completed',
        'failed flow completion',
      )
      expect(done.result?.isError).toBe(true)
      expect(done.result?.structuredContent).toMatchObject({ error: { code: 'node_failed' } })
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

describe('startRig', () => {
  test('startRig rejects for an invalid config', async () => {
    await expect(
      startRig({
        input: 'inbox',
        configOverrides: {
          flowsDir: new URL('../support/flow-rig/nonexistent-flows', import.meta.url).pathname,
        },
      }),
    ).rejects.toThrow()
  }, 60_000)
})

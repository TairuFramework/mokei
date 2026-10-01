import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as poll } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import type { CallToolResult } from '@mokei/context-protocol'
import type { FlowRunSnapshot } from '@mokei/flow-host'
import { NodeContextHost } from '@mokei/host-node'

const WAIT_MS = 10_000
const START_MS = 30_000
const POLL_MS = 100
const absolute = (path: string) => fileURLToPath(new URL(path, import.meta.url))

export type RigConfig = {
  input: 'inbox' | 'dialog'
  fakeAnswers?: Record<string, unknown>
  configOverrides?: Record<string, unknown>
  /** File descriptor for the rig's stderr; inherited when omitted. */
  stderr?: number
}
export type FlowStatus = {
  state: FlowRunSnapshot['state']
  pending: Array<{ id: string; message: string; canPrompt: boolean }>
  result?: CallToolResult
  error?: FlowRunSnapshot['error']
}
export type StubCall = {
  index: number
  backend: string
  type: 'ask' | 'notify'
  kind?: 'text' | 'confirm' | 'choice'
  title: string
  text: string
  pending: boolean
}
export type BlockingCall = { promise: Promise<CallToolResult>; abort(): void }
export type RigDriver = {
  call(
    name: string,
    args?: Record<string, unknown>,
    options?: { timeoutMs?: number; signal?: AbortSignal },
  ): Promise<CallToolResult>
  data<T = Record<string, unknown>>(result: CallToolResult): T
  waitFor(
    runID: string,
    predicate: (status: FlowStatus) => boolean,
    what: string,
  ): Promise<FlowStatus>
  watermark(): Promise<number>
  waitForDialog(
    after: number,
    predicate: (call: StubCall) => boolean,
    what: string,
  ): Promise<StubCall>
  startBlocking(name: string, args: Record<string, unknown>): BlockingCall
  cleanup(runIDs: Array<string>): Promise<void>
  dispose(): Promise<void>
}

export async function startRig(config: RigConfig): Promise<RigDriver> {
  const host = new NodeContextHost()
  const configDir = await mkdtemp(join(tmpdir(), 'flow-rig-config-'))
  const configPath = join(configDir, 'rig.config.json')
  try {
    await writeFile(
      configPath,
      JSON.stringify({
        siblings: {
          sqlite: {
            command: process.execPath,
            args: [absolute('../../../mcp-servers/sqlite/lib/serve.js')],
          },
        },
        flowsDir: absolute('../../../scripts/flow-rig/flows'),
        allow: ['system-one:predict', 'sqlite:sqlite_get'],
        predictor: 'fake',
        fakeAnswers: config.fakeAnswers ?? {
          label: {
            type: 'choice',
            choice: 'question',
            confidence: 0.9,
            probabilities: { bug: 0.1, question: 0.9 },
          },
        },
        confirm: 'desktop',
        input: config.input,
        ...config.configOverrides,
      }),
    )
    await host.addLocalContext({
      key: 'rig',
      command: process.execPath,
      args: [absolute('./stub-rig.mjs')],
      env: { ...process.env, FLOW_RIG_CONFIG: configPath },
      stderr: config.stderr ?? 'inherit',
    })
    await host.setup({ key: 'rig', timeout: START_MS })
  } catch (error) {
    try {
      await host.dispose()
    } finally {
      await rm(configDir, { recursive: true, force: true })
    }
    throw error
  }

  const blocking = new Set<BlockingCall>()
  function call(
    name: string,
    args: Record<string, unknown> = {},
    options: { timeoutMs?: number; signal?: AbortSignal } = {},
  ) {
    return host.callNamespacedTool({
      id: `rig:${name}`,
      arguments: args,
      timeout: options.timeoutMs ?? WAIT_MS,
      signal: options.signal,
    })
  }
  function data<T = Record<string, unknown>>(result: CallToolResult): T {
    assert.notEqual(result.isError, true, `Tool error: ${JSON.stringify(result)}`)
    return (result.structuredContent ?? result) as T
  }
  async function wait<T>(
    read: (timeoutMs: number) => Promise<T>,
    predicate: (value: T) => boolean,
    what: string,
  ): Promise<T> {
    const deadline = Date.now() + WAIT_MS
    let last: T | undefined
    while (Date.now() < deadline) {
      try {
        last = await read(Math.max(1, deadline - Date.now()))
      } catch (error) {
        throw new Error(`Failed waiting for ${what}; last state: ${JSON.stringify(last)}`, {
          cause: error,
        })
      }
      if (predicate(last)) return last
      const remaining = deadline - Date.now()
      if (remaining > 0) await poll(Math.min(POLL_MS, remaining))
    }
    throw new Error(`Timed out waiting for ${what}; last state: ${JSON.stringify(last)}`)
  }

  return {
    call,
    data,
    waitFor(runID, predicate, what) {
      return wait(
        async (timeoutMs) => data<FlowStatus>(await call('flow_status', { runID }, { timeoutMs })),
        predicate,
        what,
      )
    },
    async watermark() {
      const { calls } = data<{ calls: Array<StubCall> }>(await call('stub_dialogs'))
      return calls.reduce((highest, entry) => Math.max(highest, entry.index), -1)
    },
    async waitForDialog(after, predicate, what) {
      const observed = await wait(
        async (timeoutMs) => {
          return data<{ calls: Array<StubCall> }>(await call('stub_dialogs', {}, { timeoutMs }))
        },
        ({ calls }) => calls.some((entry) => entry.index > after && predicate(entry)),
        what,
      )
      const found = observed.calls.find((entry) => entry.index > after && predicate(entry))
      assert.ok(found)
      return found
    },
    startBlocking(name, args) {
      const controller = new AbortController()
      const started = {
        promise: call(name, args, { signal: controller.signal }),
        abort: () => controller.abort(),
      }
      blocking.add(started)
      // Attach both settlement handlers immediately, without creating an unhandled rejection.
      started.promise.then(
        () => blocking.delete(started),
        () => blocking.delete(started),
      )
      return started
    },
    async cleanup(runIDs) {
      const outstanding = [...blocking]
      for (const started of outstanding) started.abort()
      await Promise.allSettled(outstanding.map((started) => started.promise))
      const deadline = Date.now() + WAIT_MS
      for (const runID of runIDs) {
        // Give every run a cancellation attempt even after the shared deadline expires.
        const timeoutMs = Math.max(2000, deadline - Date.now())
        await call('cancel_flow', { runID }, { timeoutMs }).catch(() => {})
      }
    },
    async dispose() {
      try {
        data(await call('stub_shutdown', {}, { timeoutMs: WAIT_MS }))
      } finally {
        try {
          await host.dispose()
        } finally {
          await rm(configDir, { recursive: true, force: true })
        }
      }
    },
  }
}

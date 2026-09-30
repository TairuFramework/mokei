import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type ContextClient, TaskExpiredError } from '@mokei/context-client'
import type { CallToolResult, ElicitRequest } from '@mokei/context-protocol'
import {
  createTaskManager,
  createTool,
  InputRequestWithdrawnError,
  type TaskManager,
} from '@mokei/context-server'
import { type AddDirectContextParams, ContextHost } from '@mokei/host'
import { afterAll, afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import {
  type BackendName,
  createDesktopElicitHandler,
  createInputInbox,
  type DesktopBackend,
  type DesktopElicitHandler,
  type InputInbox,
  type InputInboxEvents,
  type Runner,
} from '../src/index.js'

// Real executables on a private PATH so detection finds the zenity and notify-send backends.
const binDir = mkdtempSync(join(tmpdir(), 'mokei-host-desktop-task-'))
for (const name of ['zenity', 'notify-send']) {
  const path = join(binDir, name)
  writeFileSync(path, '#!/bin/sh\nexit 0\n')
  chmodSync(path, 0o755)
}
afterAll(() => {
  rmSync(binDir, { recursive: true, force: true })
})

const LINUX_ENV = { PATH: binDir, DISPLAY: ':0', DBUS_SESSION_BUS_ADDRESS: 'unix:path=/x' }

const QUESTION = {
  message: 'Approve the release?',
  requestedSchema: {
    type: 'object',
    properties: { approved: { type: 'boolean' } },
    required: ['approved'],
  },
} as ElicitRequest['params']

const fakeRunner: Runner = {
  run: () => Promise.reject(new Error('fake runner does not run')),
  dispose: async () => {},
}

/** Dialogs never open in these tests; notifications resolve at once. */
function createBackend(name: BackendName): DesktopBackend {
  return {
    name,
    ask: () => new Promise(() => {}),
    notify: async () => {},
  }
}

function textOf(result: CallToolResult): string {
  const [first] = result.content
  return first?.type === 'text' ? first.text : ''
}

describe('decision-flow-style task through the inbox', () => {
  let inbox: InputInbox
  let handler: DesktopElicitHandler
  let host: ContextHost
  let manager: TaskManager
  let client: ContextClient
  let unregister: () => void
  let deadline: AbortController
  let removed: Array<InputInboxEvents['removed']>
  let reports: Array<string>
  const waits: Array<AbortController> = []

  function setup(ttlMs?: number): void {
    manager = createTaskManager({ pollIntervalMs: 60_000, ttlMs })
    // Waits need the live subscription: with a 60 s poll interval, polling alone would not see
    // status changes.
    const config: AddDirectContextParams['config'] = {
      name: 'flow-server',
      version: '1.0.0',
      protocolVersions: ['2026-07-28'],
      subscriptions: true,
      tasks: manager,
      tools: {
        approve: createTool({
          description: 'Ask for approval inside a task',
          inputSchema: { type: 'object' },
          handler: ({ task }) => {
            if (task == null) throw new Error('Expected task context')
            return task.run(async (handle) => {
              try {
                const answers = await handle.requestInput(
                  { approval: { method: 'elicitation/create', params: QUESTION } },
                  { signal: deadline.signal },
                )
                return { content: [{ type: 'text', text: JSON.stringify(answers.approval) }] }
              } catch (error) {
                if (error instanceof InputRequestWithdrawnError) {
                  return { content: [{ type: 'text', text: 'timed out' }] }
                }
                throw error
              }
            })
          },
        }),
      },
    }
    client = host.addDirectContext({ key: 'flow', protocolVersion: '2026-07-28', config })
  }

  async function startTask(): Promise<string> {
    const created = await client.callTool({ name: 'approve', arguments: {}, task: 'handle' })
    if (created.resultType !== 'task' || typeof created.taskId !== 'string') {
      throw new Error('Expected a task handle')
    }
    return created.taskId
  }

  function wait(taskID: string): { result: Promise<CallToolResult>; controller: AbortController } {
    const controller = new AbortController()
    waits.push(controller)
    const result = client.tasks.wait(taskID, { signal: controller.signal })
    result.catch(() => {})
    return { result, controller }
  }

  async function pendingID(): Promise<string> {
    await vi.waitFor(() => expect(inbox.list()).toHaveLength(1))
    return inbox.list()[0]?.id as string
  }

  beforeEach(() => {
    inbox = createInputInbox()
    unregister = inbox.registerAnswerSurface()
    reports = []
    removed = []
    inbox.events.on('removed', (event) => {
      removed.push(event)
    })
    handler = createDesktopElicitHandler({
      mode: 'inbox',
      inbox,
      runner: fakeRunner,
      createBackend,
      platform: 'linux',
      env: LINUX_ENV,
      onUnsupported: (reason) => reports.push(reason),
    })
    host = new ContextHost({ elicit: handler })
    deadline = new AbortController()
  })

  afterEach(async () => {
    vi.useRealTimers()
    for (const controller of waits.splice(0)) controller.abort(new Error('Test cleanup'))
    deadline.abort(new Error('Test cleanup'))
    unregister()
    await host.dispose()
    await manager.dispose()
    await handler.dispose()
    inbox.dispose()
    expect(reports).toEqual([])
  })

  test('an inbox answer completes the task with the value', async () => {
    setup()
    const taskID = await startTask()
    const { result } = wait(taskID)
    const id = await pendingID()
    expect(inbox.get(id)).toMatchObject({ key: 'flow', message: QUESTION.message })

    expect(inbox.answer(id, { approved: true })).toBe(true)
    expect(JSON.parse(textOf(await result))).toEqual({
      action: 'accept',
      content: { approved: true },
    })
    expect(inbox.list()).toEqual([])
  })

  test.each([
    ['decline', (id: string) => inbox.decline(id)],
    ['cancel', (id: string) => inbox.cancel(id)],
  ] as const)('an inbox %s reaches the work function', async (action, settle) => {
    setup()
    const taskID = await startTask()
    const { result } = wait(taskID)
    const id = await pendingID()

    expect(settle(id)).toBe(true)
    expect(JSON.parse(textOf(await result))).toEqual({ action })
  })

  test('a deadline in the work function removes the entry as withdrawn', async () => {
    setup()
    const taskID = await startTask()
    const { result } = wait(taskID)
    const id = await pendingID()

    deadline.abort(new Error('Input deadline expired'))
    expect(textOf(await result)).toBe('timed out')
    expect(removed).toEqual([{ id, reason: 'withdrawn' }])
    expect(inbox.list()).toEqual([])
  })

  test('the last wait aborting removes the entry and leaves the task waiting for input', async () => {
    setup()
    const taskID = await startTask()
    const { result, controller } = wait(taskID)
    const id = await pendingID()

    controller.abort(new Error('Caller gone'))
    await expect(result).rejects.toThrow('Caller gone')
    await vi.waitFor(() => expect(removed).toEqual([{ id, reason: 'aborted' }]))
    expect(inbox.list()).toEqual([])
    expect(await client.tasks.get(taskID)).toMatchObject({ status: 'input_required' })
  })

  test('a second wait on the same task adds the entry again', async () => {
    setup()
    const taskID = await startTask()
    const first = wait(taskID)
    const firstID = await pendingID()
    first.controller.abort(new Error('Caller gone'))
    await first.result.catch(() => {})
    await vi.waitFor(() => expect(inbox.list()).toEqual([]))

    const second = wait(taskID)
    const secondID = await pendingID()
    expect(secondID).not.toBe(firstID)
    expect(inbox.answer(secondID, { approved: false })).toBe(true)
    expect(JSON.parse(textOf(await second.result))).toEqual({
      action: 'accept',
      content: { approved: false },
    })
  })

  test('a task TTL expiry without a status event removes the entry after the wait fails', async () => {
    // Faked clock and sweep interval make the expiry deterministic; everything else stays real
    vi.useFakeTimers({
      toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'],
    })
    setup(60_000)
    const taskID = await startTask()
    const { result } = wait(taskID)
    const id = await pendingID()

    await vi.advanceTimersByTimeAsync(59_000)
    expect(inbox.list().map((entry) => entry.id)).toEqual([id])
    await vi.advanceTimersByTimeAsync(1_000)
    await expect(result).rejects.toBeInstanceOf(TaskExpiredError)
    await vi.waitFor(() => expect(removed.map((event) => event.id)).toEqual([id]))
    expect(inbox.list()).toEqual([])
  })
})

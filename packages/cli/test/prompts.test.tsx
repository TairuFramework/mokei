import { EventEmitter } from 'node:events'
import type { InboxItem } from '@mokei/flow-client'
import { runInk } from '@tejika/cli'
import { type Instance, render } from 'ink'
import type { ReactElement } from 'react'
import { afterEach, expect, test, vi } from 'vitest'

import { promptApproval, promptForm } from '../src/prompts/index.js'

class FakeStdout extends EventEmitter {
  columns = 100
  frames: Array<string> = []
  write = (frame: string) => {
    this.frames.push(frame)
  }
}

class FakeStdin extends EventEmitter {
  isTTY = true
  data: string | null = null
  write = (data: string) => {
    this.data = data
    this.emit('readable')
    this.emit('data', data)
  }
  read = () => {
    const { data } = this
    this.data = null
    return data
  }
  setEncoding() {}
  setRawMode() {}
  resume() {}
  pause() {}
  ref() {}
  unref() {}
}

type Mounted = { instance: Instance; stdin: FakeStdin; exited: boolean }
const mounted: Array<Mounted> = []

vi.mock('@tejika/cli', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tejika/cli')>()
  return {
    ...actual,
    runInk: vi.fn(async (element: ReactElement) => {
      const stdin = new FakeStdin()
      const instance = render(element, {
        stdout: new FakeStdout() as never,
        stderr: new FakeStdout() as never,
        stdin: stdin as never,
        debug: true,
        exitOnCtrlC: false,
        patchConsole: false,
      })
      const entry: Mounted = { instance, stdin, exited: false }
      mounted.push(entry)
      await instance.waitUntilExit()
      entry.exited = true
    }),
  }
})

afterEach(() => {
  for (const entry of mounted.splice(0)) {
    if (!entry.exited) entry.instance.unmount()
  }
})

const input: InboxItem & { kind: 'input' } = {
  id: 'i1',
  runID: 'r1',
  kind: 'input',
  inputKey: 'name',
  message: 'Your name?',
  requestedSchema: { type: 'object', properties: { name: { type: 'string' } } },
  createdAt: 1,
}

const approval: InboxItem & { kind: 'approval' } = {
  id: 'a1',
  runID: 'r1',
  kind: 'approval',
  plan: { tools: ['fs:write'] },
  createdAt: 1,
}

test('promptForm aborted while open unmounts the prompt and rejects with the reason', async () => {
  const controller = new AbortController()
  const pending = promptForm(input, { signal: controller.signal })
  await vi.waitFor(() => expect(mounted).toHaveLength(1))
  expect(mounted[0]?.exited).toBe(false)
  const reason = new Error('interrupted')
  controller.abort(reason)
  await expect(pending).rejects.toBe(reason)
  expect(mounted[0]?.exited).toBe(true)
})

test('promptApproval aborted while open unmounts the prompt and rejects with the reason', async () => {
  const controller = new AbortController()
  const pending = promptApproval(approval, { signal: controller.signal })
  await vi.waitFor(() => expect(mounted).toHaveLength(1))
  const reason = new Error('interrupted')
  controller.abort(reason)
  await expect(pending).rejects.toBe(reason)
  expect(mounted[0]?.exited).toBe(true)
})

test('an already aborted signal rejects without rendering', async () => {
  const controller = new AbortController()
  controller.abort(new Error('gone'))
  await expect(promptApproval(approval, { signal: controller.signal })).rejects.toThrow('gone')
  expect(mounted).toHaveLength(0)
})

test('promptApproval with a signal still resolves the answer', async () => {
  const controller = new AbortController()
  const pending = promptApproval(approval, { signal: controller.signal })
  await vi.waitFor(() => expect(mounted).toHaveLength(1))
  await new Promise((resolve) => setImmediate(resolve))
  mounted[0]?.stdin.write('y')
  await expect(pending).resolves.toBe(true)
})

test('Ctrl-C in a prompt raises SIGINT, which aborts the command and closes the prompt', async () => {
  // Stands in for withCommandSignal's SIGINT listener; never signal the test runner itself.
  const controller = new AbortController()
  const kill = vi.spyOn(process, 'kill').mockImplementation(((_pid: number, signal: string) => {
    if (signal === 'SIGINT') controller.abort(new Error('SIGINT'))
    return true
  }) as never)
  try {
    const pending = promptForm(input, { signal: controller.signal })
    await vi.waitFor(() => expect(mounted).toHaveLength(1))
    expect(vi.mocked(runInk).mock.calls.at(-1)?.[1]).toMatchObject({ exitOnCtrlC: false })
    await new Promise((resolve) => setImmediate(resolve))
    mounted[0]?.stdin.write('\u0003')
    await expect(pending).rejects.toThrow('SIGINT')
    expect(kill).toHaveBeenCalledWith(process.pid, 'SIGINT')
    expect(mounted[0]?.exited).toBe(true)
  } finally {
    kill.mockRestore()
  }
})

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type * as HostNodeExports from '@mokei/host-node'
import { createClient } from '@mokei/host-node'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { connectFlowControl, withCommandSignal } from '../src/flow-control.js'

vi.mock('@mokei/host-node', async (importOriginal) => {
  const actual = await importOriginal<typeof HostNodeExports>()
  return { ...actual, createClient: vi.fn(actual.createClient), runDaemon: vi.fn() }
})

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mokei-fc-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

test('connectFlowControl without autoStart rejects when no daemon runs', async () => {
  const { runDaemon } = await import('@mokei/host-node')
  await expect(
    connectFlowControl({ socketPath: join(dir, 'none.sock'), autoStart: false }),
  ).rejects.toThrow()
  expect(runDaemon).not.toHaveBeenCalled()
})

test('dispose closes the client', async () => {
  const client = { dispose: vi.fn(async () => {}) }
  vi.mocked(createClient).mockResolvedValueOnce(client as never)
  const connection = await connectFlowControl({ socketPath: join(dir, 'x.sock'), autoStart: false })
  expect(connection.client).toBe(client)
  expect(typeof connection.control.runs.get).toBe('function')
  await connection.dispose()
  expect(client.dispose).toHaveBeenCalledTimes(1)
})

test('withCommandSignal aborts on SIGINT and removes listeners afterwards', async () => {
  const before = process.listenerCount('SIGINT')
  const result = await withCommandSignal(async (signal) => {
    expect(process.listenerCount('SIGINT')).toBe(before + 1)
    process.emit('SIGINT')
    expect(signal.aborted).toBe(true)
    return 'done'
  })
  expect(result).toBe('done')
  expect(process.listenerCount('SIGINT')).toBe(before)
  expect(process.listenerCount('SIGTERM')).toBe(process.listenerCount('SIGTERM'))
})

test('withCommandSignal removes listeners when work throws', async () => {
  const before = process.listenerCount('SIGTERM')
  await expect(
    withCommandSignal(async () => {
      throw new Error('x')
    }),
  ).rejects.toThrow('x')
  expect(process.listenerCount('SIGTERM')).toBe(before)
})

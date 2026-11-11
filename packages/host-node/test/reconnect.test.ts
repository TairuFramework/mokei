import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ReconnectExhaustedError } from '@mokei/host'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { NodeContextHost } from '../src/node-host.js'
import type { SpawnContextServerParams } from '../src/spawn.js'

const FIXTURE = new URL('./fixtures/flaky-server.js', import.meta.url).pathname
const FAST = { initialDelayMs: 1, maxDelayMs: 1 }
const KEY = 'flaky'

/** The host events these tests watch. */
type HostEvents = {
  'context:removed': { key: string }
  'context:failed': { key: string; error: Error }
  'context:reconnecting': { key: string; attempt: number; error: Error }
  'context:reconnected': { key: string; attempts: number }
}

type Recorded = { name: keyof HostEvents; payload: unknown }

let dir: string
let log: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mokei-reconnect-'))
  log = join(dir, 'spawns.log')
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

/** Every start of the fixture so far, in order. */
function spawns(): Array<{ pid: number; args: Array<string> }> {
  let text = ''
  try {
    text = readFileSync(log, 'utf8')
  } catch {
    return []
  }
  return text
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line))
}

function record(host: NodeContextHost): Array<Recorded> {
  const events: Array<Recorded> = []
  const names: Array<keyof HostEvents> = [
    'context:removed',
    'context:failed',
    'context:reconnecting',
    'context:reconnected',
  ]
  for (const name of names) {
    host.events.on(name, (payload) => {
      events.push({ name, payload })
    })
  }
  return events
}

function nextEvent<N extends keyof HostEvents>(
  host: NodeContextHost,
  name: N,
): Promise<HostEvents[N]> {
  return new Promise((resolve) => {
    const off = host.events.on(name, (payload) => {
      off()
      resolve(payload)
    })
  })
}

/** The `context:failed` error recorded in `events`. */
function failure(events: Array<Recorded>): HostEvents['context:failed'] {
  const failed = events.find((event) => event.name === 'context:failed')
  if (failed == null) throw new Error('no context:failed event')
  return failed.payload as HostEvents['context:failed']
}

async function serverPID(host: NodeContextHost): Promise<string> {
  const result = await host.callTool({ key: KEY, name: 'pid', arguments: {} })
  const [content] = result.content as Array<{ type: string; text: string }>
  return String(content?.text)
}

async function crash(host: NodeContextHost): Promise<void> {
  await expect(host.callTool({ key: KEY, name: 'crash', arguments: {} })).rejects.toThrow()
}

/** Appends `extra` to the previous spawn's args. */
function withArgs(...extra: Array<string>) {
  return (previous: SpawnContextServerParams): SpawnContextServerParams => ({
    ...previous,
    args: [...(previous.args ?? []), ...extra],
  })
}

test('a crashed server is respawned', async () => {
  const host = new NodeContextHost()
  try {
    await host.addLocalContext({
      key: KEY,
      command: process.execPath,
      args: [FIXTURE, '--log', log],
      reconnect: FAST,
    })
    await host.setup({ key: KEY })
    const first = await serverPID(host)

    const reconnected = nextEvent(host, 'context:reconnected')
    await crash(host)
    await expect(reconnected).resolves.toEqual({ key: KEY, attempts: 1 })

    const second = await serverPID(host)
    expect(second).not.toBe(first)
    expect(spawns().map((spawn) => String(spawn.pid))).toEqual([first, second])
    expect(host.getContextKeys()).toEqual([KEY])
  } finally {
    await host.dispose()
  }
})

test('a framing fault respawns the server', async () => {
  const host = new NodeContextHost()
  const events = record(host)
  try {
    await host.addLocalContext({
      key: KEY,
      command: process.execPath,
      args: [FIXTURE, '--log', log],
      reconnect: FAST,
    })
    await host.setup({ key: KEY })
    const first = await serverPID(host)

    const reconnected = nextEvent(host, 'context:reconnected')
    await expect(host.callTool({ key: KEY, name: 'garble', arguments: {} })).rejects.toThrow()
    await reconnected

    expect(await serverPID(host)).not.toBe(first)
    expect(events.filter((event) => event.name === 'context:reconnecting')).toHaveLength(1)
    expect(events.some((event) => event.name === 'context:failed')).toBe(false)
  } finally {
    await host.dispose()
  }
})

test('respawn is asked once per loss and its params are reused', async () => {
  const host = new NodeContextHost()
  const events = record(host)
  const respawn = vi.fn(withArgs('--die-after-ms', '10'))
  try {
    await host.addLocalContext({
      key: KEY,
      command: process.execPath,
      args: [FIXTURE, '--log', log],
      reconnect: { ...FAST, maxAttempts: 3, respawn },
    })
    await host.setup({ key: KEY })

    const removed = nextEvent(host, 'context:removed')
    await crash(host)
    await removed

    expect(respawn).toHaveBeenCalledTimes(1)
    expect(respawn).toHaveBeenCalledWith({
      command: process.execPath,
      args: [FIXTURE, '--log', log],
    })
    const attempts = spawns().slice(1)
    expect(attempts).toHaveLength(3)
    for (const attempt of attempts) {
      expect(attempt.args).toEqual(['--log', log, '--die-after-ms', '10'])
    }
    const failed = events.find((event) => event.name === 'context:failed')
    expect(failed?.payload).toEqual({
      key: KEY,
      error: expect.any(ReconnectExhaustedError),
    })
  } finally {
    await host.dispose()
  }
})

test('the params respawn returns are the previous params of the next loss', async () => {
  const host = new NodeContextHost()
  let generation = 0
  const respawn = vi.fn((previous: SpawnContextServerParams) =>
    withArgs('--generation', String(++generation))(previous),
  )
  try {
    await host.addLocalContext({
      key: KEY,
      command: process.execPath,
      args: [FIXTURE, '--log', log],
      reconnect: { ...FAST, respawn },
    })
    await host.setup({ key: KEY })

    let reconnected = nextEvent(host, 'context:reconnected')
    await crash(host)
    await reconnected
    reconnected = nextEvent(host, 'context:reconnected')
    await crash(host)
    await reconnected

    expect(respawn).toHaveBeenCalledTimes(2)
    expect(respawn.mock.calls[1]?.[0].args).toEqual([FIXTURE, '--log', log, '--generation', '1'])
    expect(spawns().at(-1)?.args).toEqual(['--log', log, '--generation', '1', '--generation', '2'])
  } finally {
    await host.dispose()
  }
})

test('respawn false fails the context', async () => {
  const host = new NodeContextHost()
  const events = record(host)
  const respawn = vi.fn(() => false as const)
  try {
    await host.addLocalContext({
      key: KEY,
      command: process.execPath,
      args: [FIXTURE, '--log', log],
      reconnect: { ...FAST, respawn },
    })
    await host.setup({ key: KEY })

    const removed = nextEvent(host, 'context:removed')
    await crash(host)
    await removed

    expect(respawn).toHaveBeenCalledTimes(1)
    expect(spawns()).toHaveLength(1)
    const terminal = events.filter(
      (event) => event.name === 'context:failed' || event.name === 'context:removed',
    )
    expect(terminal.map((event) => event.name)).toEqual(['context:failed', 'context:removed'])
    const { error } = failure(events)
    expect(error).toBeInstanceOf(ReconnectExhaustedError)
    expect((error as ReconnectExhaustedError).attempts).toBe(0)
    expect(error.cause).toEqual(new Error('respawn declined'))
    expect(host.getContextKeys()).toEqual([])
  } finally {
    await host.dispose()
  }
})

test('a server that keeps dying fails after maxAttempts', async () => {
  const host = new NodeContextHost()
  const events = record(host)
  try {
    await host.addLocalContext({
      key: KEY,
      command: process.execPath,
      args: [FIXTURE, '--log', log],
      reconnect: { ...FAST, respawn: withArgs('--die-after-ms', '10') },
    })
    await host.setup({ key: KEY })

    const removed = nextEvent(host, 'context:removed')
    await crash(host)
    await removed

    expect(spawns().slice(1)).toHaveLength(5)
    const terminal = events.filter(
      (event) => event.name === 'context:failed' || event.name === 'context:removed',
    )
    expect(terminal.map((event) => event.name)).toEqual(['context:failed', 'context:removed'])
    const { error } = failure(events)
    expect(error).toBeInstanceOf(ReconnectExhaustedError)
    expect((error as ReconnectExhaustedError).attempts).toBe(5)
    expect(events.filter((event) => event.name === 'context:reconnecting')).toHaveLength(5)
    expect(host.getContextKeys()).toEqual([])
  } finally {
    await host.dispose()
  }
})

test('before setup, a reconnecting context exits as today', async () => {
  const host = new NodeContextHost()
  const events = record(host)
  const remove = vi.spyOn(host, 'remove')
  try {
    await host.addLocalContext({
      key: KEY,
      command: process.execPath,
      args: [FIXTURE, '--log', log, '--die-after-ms', '200'],
      reconnect: FAST,
    })
    await vi.waitFor(() => expect(remove).toHaveBeenCalledWith(KEY, 'lost'))
    expect(host.getContextKeys()).toEqual([])
    expect(events.some((event) => event.name === 'context:reconnecting')).toBe(false)
    expect(spawns()).toHaveLength(1)
  } finally {
    await host.dispose()
  }
})

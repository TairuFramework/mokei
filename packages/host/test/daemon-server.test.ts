import { spawn } from 'node:child_process'
import { rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { createClient } from '../src/daemon.js'
import { killChildren, startServer } from '../src/server.js'

const sockets: Array<string> = []

function tmpSocket(): string {
  const path = join(tmpdir(), `mokei-srv-${process.pid}-${sockets.length}.sock`)
  sockets.push(path)
  return path
}

afterEach(() => {
  for (const path of sockets) {
    try {
      rmSync(path)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    }
  }
})

describe('killChildren', () => {
  test('kills every tracked child and empties the map', async () => {
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1e9)'])
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()))
    const children = new Map([['c1', child]])

    killChildren(children)

    expect(children.size).toBe(0)
    await exited // resolves only if the child was actually killed
  })
})

describe('startServer', () => {
  test('chmods the socket to 0600', async () => {
    const socketPath = tmpSocket()
    const { dispose } = await startServer({ socketPath })
    expect(statSync(socketPath).mode & 0o777).toBe(0o600)
    await dispose()
  })
})

describe('spawn handler child-exit cleanup', () => {
  test('dispatches context:stop and prunes maps when a spawned child self-exits', async () => {
    const socketPath = tmpSocket()
    const { dispose } = await startServer({ socketPath })
    const client = await createClient(socketPath)

    const stops: Array<{ type: string }> = []
    const events = client.createStream('events')
    // StreamCall is also a Promise; events.close() rejects it with 'Close'.
    // Attach a no-op catch so the expected teardown rejection stays silent.
    void events.catch(() => {})
    void (async () => {
      for await (const event of events.readable) {
        if (event.type === 'context:stop') {
          stops.push(event)
        }
      }
    })()

    // Spawn a child that exits immediately on its own. Discard the channel promise
    // so the fire-and-forget close/dispose doesn't leave an unhandled rejection.
    client
      .createChannel('spawn', {
        param: { command: process.execPath, args: ['-e', 'process.exit(0)'] },
      })
      .catch(() => {})

    await vi.waitFor(() => {
      expect(stops.length).toBeGreaterThan(0)
    })

    events.close()
    await client.dispose()
    await dispose()
  })
})

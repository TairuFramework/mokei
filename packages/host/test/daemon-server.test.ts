import { spawn } from 'node:child_process'
import { statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'

import { safeRemove } from '../src/daemon/socket.js'
import { killChildren, startServer } from '../src/server.js'

const sockets: Array<string> = []

function tmpSocket(): string {
  const path = join(tmpdir(), `mokei-srv-${process.pid}-${sockets.length}.sock`)
  sockets.push(path)
  return path
}

afterEach(() => {
  for (const path of sockets) {
    safeRemove(path)
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

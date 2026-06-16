import { createServer, type Server } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'

import { isSocketLive, safeRemove, waitForSocket } from '../src/daemon/socket.js'

let server: Server | undefined
const sockets: Array<string> = []

function tmpSocket(): string {
  const path = join(tmpdir(), `mokei-test-${process.pid}-${sockets.length}.sock`)
  sockets.push(path)
  return path
}

afterEach(async () => {
  if (server != null) {
    await new Promise<void>((resolve) => server?.close(() => resolve()))
    server = undefined
  }
  for (const path of sockets) {
    safeRemove(path)
  }
})

function listen(path: string): Promise<Server> {
  return new Promise((resolve) => {
    const s = createServer()
    s.listen(path, () => resolve(s))
  })
}

describe('isSocketLive', () => {
  test('returns false for a non-existent socket', async () => {
    await expect(isSocketLive(tmpSocket())).resolves.toBe(false)
  })

  test('returns true when a server is listening', async () => {
    const path = tmpSocket()
    server = await listen(path)
    await expect(isSocketLive(path)).resolves.toBe(true)
  })
})

describe('waitForSocket', () => {
  test('resolves once a server starts listening', async () => {
    const path = tmpSocket()
    server = await listen(path)
    await expect(waitForSocket(path, { timeout: 1000, interval: 20 })).resolves.toBeUndefined()
  })

  test('rejects when the socket never appears', async () => {
    await expect(waitForSocket(tmpSocket(), { timeout: 150, interval: 20 })).rejects.toThrow()
  })
})

describe('safeRemove', () => {
  test('does not throw when the path is absent', () => {
    expect(() => safeRemove(tmpSocket())).not.toThrow()
  })
})

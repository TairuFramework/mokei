import { createServer, type Server, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'

import { createClient } from '../src/daemon.js'

// Socket utility behaviour is now tested in @tejika/process. This file
// exercises the host-level daemon client against a bare net server so the
// socket connection path is still covered at the integration level.

let server: Server | undefined
const connections: Array<Socket> = []
const sockets: Array<string> = []

function tmpSocket(): string {
  const path = join(tmpdir(), `mokei-test-${process.pid}-${sockets.length}.sock`)
  sockets.push(path)
  return path
}

afterEach(async () => {
  // The client keeps its socket open; destroy accepted connections so
  // `server.close()` can complete instead of waiting them out.
  for (const socket of connections.splice(0)) {
    socket.destroy()
  }
  if (server != null) {
    await new Promise<void>((resolve) => server?.close(() => resolve()))
    server = undefined
  }
})

function listen(path: string): Promise<Server> {
  return new Promise((resolve) => {
    const s = createServer((socket) => {
      connections.push(socket)
    })
    s.listen(path, () => resolve(s))
  })
}

describe('createClient', () => {
  test('rejects when no daemon is listening', async () => {
    await expect(createClient(tmpSocket())).rejects.toThrow()
  })

  test('connects when a server is listening', async () => {
    const path = tmpSocket()
    server = await listen(path)
    // createClient will connect the socket transport; the server won't speak
    // the Enkaku protocol, but the Client object itself is returned before
    // any protocol exchange.
    await expect(createClient(path)).resolves.toBeDefined()
  })
})

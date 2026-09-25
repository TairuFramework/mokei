import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, test } from 'vitest'

import { NodeSession } from '../src/node-session.js'

const ECHO_SERVER = fileURLToPath(new URL('./fixtures/echo-server.mjs', import.meta.url))

describe('NodeSession.addContext', () => {
  let session: NodeSession | null = null

  afterEach(async () => {
    await session?.contextHost.dispose()
    session = null
  })

  test('passes the requested revision to the host', async () => {
    session = new NodeSession()
    await session.addContext({
      key: 'echo',
      command: process.execPath,
      args: [ECHO_SERVER],
      protocolVersion: '2025-11-25',
    })
    expect(session.contextHost.getContext('echo').client.protocolVersion).toBe('2025-11-25')
  })

  test('defaults to the host default', async () => {
    session = new NodeSession()
    await session.addContext({ key: 'echo', command: process.execPath, args: [ECHO_SERVER] })
    expect(session.contextHost.getContext('echo').client.protocolVersion).toBe('2026-07-28')
  })
})

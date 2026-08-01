import { fileURLToPath } from 'node:url'
import { Session } from '@mokei/session'
import { afterEach, describe, expect, test } from 'vitest'

const ECHO_SERVER = fileURLToPath(
  new URL('../../host/test/fixtures/echo-server.mjs', import.meta.url),
)

describe('Session.addContext', () => {
  let session: Session | null = null

  afterEach(async () => {
    await session?.contextHost.dispose()
    session = null
  })

  test('passes the requested revision to the host', async () => {
    session = new Session()
    await session.addContext({
      key: 'echo',
      command: process.execPath,
      args: [ECHO_SERVER],
      protocolVersion: '2025-11-25',
    })
    expect(session.contextHost.getContext('echo').client.protocolVersion).toBe('2025-11-25')
  })

  test('defaults to the host default', async () => {
    session = new Session()
    await session.addContext({ key: 'echo', command: process.execPath, args: [ECHO_SERVER] })
    expect(session.contextHost.getContext('echo').client.protocolVersion).toBe('2026-07-28')
  })
})

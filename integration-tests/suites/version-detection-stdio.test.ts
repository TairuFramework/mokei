/** Compatibility-matrix cases for the 'auto' probe over stdio (specification/2026-07-28/basic/versioning#compatibility-matrix). */
import { UNSUPPORTED_PROTOCOL_VERSION } from '@mokei/context-protocol'
import { spawnHostedContext } from '@mokei/host'
import { describe, expect, test } from 'vitest'

import {
  MOKEI_STDIO_SERVER_2025_11_25_PATH,
  MOKEI_STDIO_SERVER_2026_07_28_PATH,
  MOKEI_STDIO_SERVER_BOTH_PATH,
  REFUSING_STDIO_SERVER_PATH,
} from '../support/interop/servers.ts'

describe('protocol version detection over stdio', () => {
  test("'auto' falls back to 2025-11-25 against a handshake-only server", async () => {
    const context = await spawnHostedContext({
      command: process.execPath,
      args: [MOKEI_STDIO_SERVER_2025_11_25_PATH],
      protocolVersion: 'auto',
      stderr: 'inherit',
    })
    try {
      const tools = await context.client.listTools()
      expect(context.client.protocolVersion).toBe('2025-11-25')
      expect(tools.tools.map((tool) => tool.name)).toEqual(['echo', 'sum'])
    } finally {
      await context.disposer.dispose()
    }
  })

  test("'auto' selects 2026-07-28 against a server that offers it", async () => {
    const context = await spawnHostedContext({
      command: process.execPath,
      args: [MOKEI_STDIO_SERVER_2026_07_28_PATH],
      protocolVersion: 'auto',
      stderr: 'inherit',
    })
    try {
      const tools = await context.client.listTools()
      expect(context.client.protocolVersion).toBe('2026-07-28')
      expect(tools.tools.map((tool) => tool.name)).toEqual(['echo', 'sum'])
    } finally {
      await context.disposer.dispose()
    }
  })

  test('a 2025-11-25 client works against a server serving both revisions', async () => {
    const context = await spawnHostedContext({
      command: process.execPath,
      args: [MOKEI_STDIO_SERVER_BOTH_PATH],
      protocolVersion: '2025-11-25',
      stderr: 'inherit',
    })
    try {
      const tools = await context.client.listTools()
      expect(context.client.protocolVersion).toBe('2025-11-25')
      expect(tools.tools.map((tool) => tool.name)).toEqual(['echo', 'sum'])
    } finally {
      await context.disposer.dispose()
    }
  })

  test('a 2026-07-28-pinned client works against a server serving both revisions', async () => {
    const context = await spawnHostedContext({
      command: process.execPath,
      args: [MOKEI_STDIO_SERVER_BOTH_PATH],
      protocolVersion: '2026-07-28',
      stderr: 'inherit',
    })
    try {
      const tools = await context.client.listTools()
      expect(context.client.protocolVersion).toBe('2026-07-28')
      expect(tools.tools.map((tool) => tool.name)).toEqual(['echo', 'sum'])
    } finally {
      await context.disposer.dispose()
    }
  })

  // mokei's own '2025-11-25'-only server is a handshake-only implementation: it understands
  // `initialize` but rejects any request whose `_meta` names a protocol version it does not
  // serve (ContextServer#resolveProtocol). A 2026-07-28-pinned client decorates every request
  // with that `_meta`, so the rejection here is deterministic and precisely identifiable. A
  // third-party handshake-only server that ignores `_meta` instead of validating it might fail
  // differently (or not at all) — that's a property of this fixture, not of the protocol.
  test('a 2026-07-28-pinned client fails actionably against a handshake-only server', async () => {
    const context = await spawnHostedContext({
      command: process.execPath,
      args: [MOKEI_STDIO_SERVER_2025_11_25_PATH],
      protocolVersion: '2026-07-28',
      stderr: 'inherit',
    })
    try {
      await expect(context.client.listTools()).rejects.toMatchObject({
        code: UNSUPPORTED_PROTOCOL_VERSION,
        data: { supported: ['2025-11-25'] },
      })
    } finally {
      await context.disposer.dispose()
    }
  })

  // A failed setup rejects `#ready`, which is `lazy()` — the client is unusable from that point
  // on and nothing will call `dispose()` for the caller. If the client does not dispose itself,
  // the spawned server process outlives it. Note the test never disposes before asserting: the
  // exit has to come from the client's own teardown.
  test('a client whose setup fails reaps the server process', async () => {
    let onExited: () => void = () => {}
    const exited = new Promise<void>((resolve) => {
      onExited = resolve
    })
    const context = await spawnHostedContext({
      command: process.execPath,
      args: [REFUSING_STDIO_SERVER_PATH],
      protocolVersion: 'auto',
      stderr: 'inherit',
      onExit: onExited,
    })
    try {
      await expect(context.client.listTools()).rejects.toMatchObject({
        message: 'Unsupported method: initialize',
      })
      await expect(
        Promise.race([
          exited.then(() => 'exited'),
          new Promise((resolve) => setTimeout(() => resolve('still running'), 3000)),
        ]),
      ).resolves.toBe('exited')
    } finally {
      await context.disposer.dispose()
    }
  })
})

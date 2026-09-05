import type { RequestID, ServerMessage } from '@mokei/context-protocol'
import { PROTOCOLS } from '@mokei/context-protocol'
import { RPCError } from '@mokei/context-rpc'
import { describe, expect, test, vi } from 'vitest'

import { type SetupIO, SetupReader } from '../src/setup-reader.js'

/**
 * A fake `SetupIO` that models the real shared buffer + deduped-read semantics `ContextClient`'s
 * closures provide: `takeBuffered` performs a genuine predicate scan/splice over `buffer` (never a
 * FIFO pop), and `readNextFrame` serves one scripted frame per call. This is what lets the "stray
 * buffered frame" test below actually exercise `SetupReader`'s loop rather than the fake's own
 * plumbing.
 */
function createFakeIO(frames: Array<ServerMessage>): {
  buffer: Array<ServerMessage>
  io: SetupIO
  readNextFrame: ReturnType<typeof vi.fn>
  written: Array<unknown>
} {
  let nextId = 0
  const buffer: Array<ServerMessage> = []
  const queue = [...frames]
  const written: Array<unknown> = []
  const readNextFrame = vi.fn(async (): Promise<ReadableStreamReadResult<ServerMessage>> => {
    const value = queue.shift()
    if (value == null) {
      return { done: true, value: undefined }
    }
    return { done: false, value }
  })
  const io: SetupIO = {
    allocateId: (): RequestID => nextId++,
    write: async (message) => {
      written.push(message)
    },
    takeBuffered: (matches) => {
      const index = buffer.findIndex(matches)
      if (index === -1) {
        return undefined
      }
      const [message] = buffer.splice(index, 1)
      return message
    },
    readNextFrame,
    handBackFrame: (message) => {
      buffer.push(message)
    },
  }
  return { buffer, io, readNextFrame, written }
}

const NEVER_DEADLINE = new Promise<never>(() => {})

describe('SetupReader.driveInitialize', () => {
  test('returns the negotiated revision and result for a straightforward exchange', async () => {
    const response = {
      jsonrpc: '2.0' as const,
      id: 0,
      result: {
        protocolVersion: '2025-11-25' as const,
        capabilities: {},
        serverInfo: { name: 'test-server', version: '1.0.0' },
      },
    }
    const { io, written } = createFakeIO([response as unknown as ServerMessage])
    const reader = new SetupReader(io, 1000)

    const outcome = await reader.driveInitialize({
      protocolVersion: '2025-11-25',
      clientInfo: { name: 'test-client', version: '1.0.0' },
      capabilities: {},
    })

    expect(outcome).toEqual({
      result: response.result,
      negotiatedRevision: '2025-11-25',
    })
    expect(written).toEqual([
      {
        jsonrpc: '2.0',
        id: 0,
        method: 'initialize',
        params: {
          capabilities: {},
          clientInfo: { name: 'test-client', version: '1.0.0' },
          protocolVersion: '2025-11-25',
        },
      },
    ])
  })

  test('finds an already-buffered match past a stray frame via predicate scan, without reading the transport', async () => {
    // A notification that arrived mid-handshake and matched no earlier waiter, buffered exactly
    // as `ContextClient#readUntil`'s original loop would leave it -- pre-seeded *ahead of* the
    // actual match, so a naive FIFO scan (checking only the buffer's front entry, or shifting
    // it) would either misreport a non-match as the answer or never look past it to find the
    // real one.
    const stray: ServerMessage = {
      jsonrpc: '2.0',
      method: 'notifications/message',
      params: { level: 'info', data: 'stray' },
    } as unknown as ServerMessage
    const response = {
      jsonrpc: '2.0' as const,
      id: 0,
      result: {
        protocolVersion: '2025-11-25' as const,
        capabilities: {},
        serverInfo: { name: 'test-server', version: '1.0.0' },
      },
    }
    const match = response as unknown as ServerMessage
    // No frames staged for a fresh transport read: correct behaviour must resolve entirely out
    // of the buffer scan. If `SetupReader` instead skipped straight to `readNextFrame()` (the
    // bug the brief's naive "read-next-frame"/"hand-back-unmatched-frame" FIFO pairing produces
    // once the buffer scan is dropped), the empty queue reports the connection closed and the
    // call rejects instead of resolving -- which is what the assertions below would catch.
    const { buffer, io, readNextFrame } = createFakeIO([])
    buffer.push(stray, match)
    const reader = new SetupReader(io, 1000)

    const outcome = await reader.driveInitialize({
      protocolVersion: '2025-11-25',
      clientInfo: { name: 'test-client', version: '1.0.0' },
      capabilities: {},
    })

    expect(outcome).toEqual({ result: response.result, negotiatedRevision: '2025-11-25' })
    // No transport read at all: the match was found by scanning the buffer for an entry
    // satisfying the predicate, not by popping its front entry (the stray) or by falling
    // through to a fresh read because the front entry didn't match.
    expect(readNextFrame).not.toHaveBeenCalled()
    // The stray frame is still sitting in the shared buffer afterwards -- untouched, available
    // for a later waiter (or the post-setup `_read()` drain) to claim. Only the actual match was
    // removed.
    expect(buffer).toEqual([stray])
  })

  test('reads past a stray frame that arrives fresh, then finds the match on the next buffer scan', async () => {
    // Models the interleaved case: the buffer starts with one stray entry, and the actual match
    // only shows up via a fresh transport read. Exercises the loop's other edge: a non-matching
    // buffer entry must not stop the scan from proceeding to `readNextFrame()`, and a frame read
    // fresh must go through `handBackFrame()` + a re-scan rather than being returned directly --
    // mirroring the original `#readUntil()`'s unconditional-push-then-rescan shape exactly.
    const stray: ServerMessage = {
      jsonrpc: '2.0',
      method: 'notifications/message',
      params: { level: 'info', data: 'stray' },
    } as unknown as ServerMessage
    const response = {
      jsonrpc: '2.0' as const,
      id: 0,
      result: {
        protocolVersion: '2025-11-25' as const,
        capabilities: {},
        serverInfo: { name: 'test-server', version: '1.0.0' },
      },
    }
    const { buffer, io, readNextFrame } = createFakeIO([response as unknown as ServerMessage])
    buffer.push(stray)
    const reader = new SetupReader(io, 1000)

    const outcome = await Promise.race([
      reader.driveInitialize({
        protocolVersion: '2025-11-25',
        clientInfo: { name: 'test-client', version: '1.0.0' },
        capabilities: {},
      }),
      // A naive FIFO pop/push adapter would spin forever on the stray frame and never resolve;
      // race it against a short timer so a regression fails the test instead of hanging it.
      new Promise<never>((_resolve, reject) =>
        setTimeout(
          () => reject(new Error('driveInitialize did not resolve -- infinite loop?')),
          500,
        ),
      ),
    ])

    expect(outcome).toEqual({ result: response.result, negotiatedRevision: '2025-11-25' })
    // Exactly one real transport read: the stray frame was correctly recognised as non-matching
    // by a predicate scan, not consumed/re-offered as if the buffer were a FIFO queue.
    expect(readNextFrame).toHaveBeenCalledTimes(1)
    // The stray frame is still sitting in the shared buffer afterwards -- untouched, available
    // for a later waiter (or the post-setup `_read()` drain) to claim.
    expect(buffer).toEqual([stray])
  })

  test('throws RPCError when the server answers with an error response', async () => {
    const errorResponse = {
      jsonrpc: '2.0' as const,
      id: 0,
      error: { code: -32600, message: 'boom' },
    }
    const { io } = createFakeIO([errorResponse as unknown as ServerMessage])
    const reader = new SetupReader(io, 1000)

    await expect(
      reader.driveInitialize({
        protocolVersion: '2025-11-25',
        clientInfo: { name: 'test-client', version: '1.0.0' },
        capabilities: {},
      }),
    ).rejects.toThrow(RPCError)
  })

  test('rejects once the setup deadline elapses with no matching frame', async () => {
    const io: SetupIO = {
      allocateId: () => 0,
      write: async () => {},
      takeBuffered: () => undefined,
      readNextFrame: () =>
        NEVER_DEADLINE as unknown as Promise<ReadableStreamReadResult<ServerMessage>>,
      handBackFrame: () => {},
    }
    const reader = new SetupReader(io, 10)

    await expect(
      reader.driveInitialize({
        protocolVersion: '2025-11-25',
        clientInfo: { name: 'test-client', version: '1.0.0' },
        capabilities: {},
      }),
    ).rejects.toThrow(/did not respond/)
  })
})

describe('SetupReader.driveDiscover', () => {
  test('returns the negotiated revision and result, decorated through the protocol', async () => {
    const protocol = PROTOCOLS['2026-07-28']
    const response = {
      jsonrpc: '2.0' as const,
      id: 0,
      result: {
        resultType: 'complete' as const,
        capabilities: {},
        supportedVersions: ['2026-07-28'],
      },
    }
    const { io, written } = createFakeIO([response as unknown as ServerMessage])
    const reader = new SetupReader(io, 1000)

    const outcome = await reader.driveDiscover({
      protocol,
      clientInfo: { name: 'test-client', version: '1.0.0' },
      capabilities: {},
    })

    expect(outcome).toEqual({ result: response.result, negotiatedRevision: '2026-07-28' })
    expect(written).toHaveLength(1)
    const [sent] = written as Array<{ method: string; id: number }>
    expect(sent?.method).toBe('server/discover')
  })

  test('throws RPCError on an invalid discover result', async () => {
    const protocol = PROTOCOLS['2026-07-28']
    const response = {
      jsonrpc: '2.0' as const,
      id: 0,
      result: { resultType: 'complete' as const },
    }
    const { io } = createFakeIO([response as unknown as ServerMessage])
    const reader = new SetupReader(io, 1000)

    await expect(
      reader.driveDiscover({
        protocol,
        clientInfo: { name: 'test-client', version: '1.0.0' },
        capabilities: {},
      }),
    ).rejects.toThrow(RPCError)
  })
})

/**
 * Proves requests are handled concurrently over stdio, on `2026-07-28`.
 *
 * `ContextRPC`'s read loop no longer awaits a message's handler before reading the next one
 * (`packages/context-rpc/src/rpc.ts`) — requests start in wire order but complete out of order,
 * scheduled through `RequestScheduler` (`packages/context-rpc/src/scheduler.ts`). This drives
 * that through a real process boundary: a slow tool call must not block a quick one issued while
 * it is still pending.
 */
import { afterEach, describe, expect, test } from 'vitest'

import {
  MOKEI_STDIO_SERVER_CONCURRENCY_PATH,
  type SpawnedMokeiClient,
  spawnMokeiStdioClient,
} from '../support/interop/servers.ts'

const PROTOCOL_VERSION = '2026-07-28'

describe('concurrent request handling over stdio', () => {
  let spawned: SpawnedMokeiClient | null = null

  afterEach(async () => {
    if (spawned != null) {
      await spawned.dispose()
      spawned = null
    }
  })

  test('a quick tool call is answered while a slow one is still running', async () => {
    spawned = await spawnMokeiStdioClient(MOKEI_STDIO_SERVER_CONCURRENCY_PATH, PROTOCOL_VERSION)
    const { client } = spawned

    const slow = client.callTool({ name: 'slow', arguments: {} } as never)
    slow.catch(() => {})
    // Let the slow call reach the server before issuing the second one.
    await new Promise((resolve) => setTimeout(resolve, 100))

    const startedAt = Date.now()
    const quick = await client.callTool({ name: 'quick', arguments: {} } as never)
    const elapsed = Date.now() - startedAt

    expect(quick.content[0]).toMatchObject({ type: 'text', text: 'quick' })
    // The slow tool sleeps 5s. Anything near that means the server serialized the two.
    expect(elapsed).toBeLessThan(1_000)

    await slow
  }, 15_000)
})

/**
 * Multi round-trip requests (MRTR, SEP-2322) across the two stacks, on `2026-07-28`, in all four
 * client × server × transport combinations.
 *
 * Every case drives the same fixture tool: it suspends its first round with an embedded
 * `roots/list` request plus a minted `requestState`, and answers `rootsAnswer(ROOTS.length)` only
 * once it has both the client's roots *and* its own state back verbatim. So the one text assertion
 * per case covers the whole loop — the suspension crossing the wire, the peer client fulfilling
 * the embedded request from its own handler, the retry carrying `inputResponses` and the echoed
 * `requestState`, and the server resuming on them. Anything dropped or mangled along the way lands
 * as a different string, not as a silent pass.
 *
 * Both sides drive their own loop with no help from the test: mokei's `ContextClient` through its
 * `inputRequired.autoFulfill` driver, the SDK's `Client` through its own. Neither `callTool` call
 * below opts into `allowInputRequired`, so both keep their plain `CallToolResult` return type —
 * the interactive rounds happen inside the call.
 */
import { type Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import type { ContextClient } from '@mokei/context-client'
import { afterEach, describe, expect, test } from 'vitest'

import { MRTR_TOOL_NAME, rootsAnswer } from '../support/interop/mrtr-fixture.ts'
import {
  connectMokeiHTTPClient,
  createSDKClient,
  MOKEI_STDIO_SERVER_MRTR_PATH,
  type RunningHTTPServer,
  SDK_STDIO_SERVER_MRTR_PATH,
  spawnMokeiStdioClient,
  startMokeiMRTRHTTPServer,
  startSDKMRTRHTTPServer,
} from '../support/interop/servers.ts'

/** The roots every client under test reports, and therefore the count the tool answers with. */
const ROOTS = [{ uri: 'file:///work', name: 'work' }]

const EXPECTED_CONTENT = [{ type: 'text', text: rootsAnswer(ROOTS.length) }]

/**
 * An SDK client able to fulfil the fixture's embedded `roots/list`: the capability declared and a
 * handler registered for the method its MRTR driver dispatches to.
 *
 * Both are needed, and the declaration is load-bearing twice over. `setRequestHandler('roots/list')`
 * itself throws `Client does not support roots capability` on an instance that did not declare it
 * (verified by dropping the argument) — so the handler cannot even be installed first. And the
 * declaration is what the SDK stamps into every request's `_meta` envelope, which is what mokei's
 * server reads before letting a suspension out; an undeclared capability there is what `-32021` is
 * for. The SDK never derives the envelope from the registered handlers, only from `ClientOptions`.
 */
function createRootsSDKClient(): Client {
  const client = createSDKClient('2026-07-28', { roots: {} })
  client.setRequestHandler('roots/list', () => ({ roots: ROOTS }))
  return client
}

describe('MRTR interop on 2026-07-28', () => {
  let httpServer: RunningHTTPServer | null = null
  let sdkClient: Client | null = null
  let disposeMokeiClient: (() => Promise<void>) | null = null
  let mokeiClient: ContextClient | null = null

  afterEach(async () => {
    if (sdkClient != null) {
      await sdkClient.close()
      sdkClient = null
    }
    if (disposeMokeiClient != null) {
      await disposeMokeiClient()
      disposeMokeiClient = null
    }
    if (mokeiClient != null) {
      await mokeiClient.dispose()
      mokeiClient = null
    }
    if (httpServer != null) {
      await httpServer.dispose()
      httpServer = null
    }
  })

  test('mokei client fulfils an SDK server suspension over stdio', async () => {
    const spawned = await spawnMokeiStdioClient(SDK_STDIO_SERVER_MRTR_PATH, '2026-07-28', {
      listRoots: ROOTS,
    })
    disposeMokeiClient = spawned.dispose
    const result = await spawned.client.callTool({ name: MRTR_TOOL_NAME, arguments: {} })
    expect(result.content).toEqual(EXPECTED_CONTENT)
  })

  test('mokei client fulfils an SDK server suspension over Streamable HTTP', async () => {
    httpServer = await startSDKMRTRHTTPServer()
    mokeiClient = connectMokeiHTTPClient(httpServer.url, '2026-07-28', { listRoots: ROOTS })
    const result = await mokeiClient.callTool({ name: MRTR_TOOL_NAME, arguments: {} })
    expect(result.content).toEqual(EXPECTED_CONTENT)
  })

  test('SDK client fulfils a mokei server suspension over stdio', async () => {
    sdkClient = createRootsSDKClient()
    await sdkClient.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [MOKEI_STDIO_SERVER_MRTR_PATH],
      }),
    )
    const result = await sdkClient.callTool({ name: MRTR_TOOL_NAME, arguments: {} })
    expect(result.content).toEqual(EXPECTED_CONTENT)
  })

  test('SDK client fulfils a mokei server suspension over Streamable HTTP', async () => {
    httpServer = await startMokeiMRTRHTTPServer()
    sdkClient = createRootsSDKClient()
    await sdkClient.connect(new StreamableHTTPClientTransport(new URL(httpServer.url)))
    const result = await sdkClient.callTool({ name: MRTR_TOOL_NAME, arguments: {} })
    expect(result.content).toEqual(EXPECTED_CONTENT)
  })
})

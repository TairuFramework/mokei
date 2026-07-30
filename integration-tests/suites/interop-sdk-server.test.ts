/** mokei client ↔ official SDK v2 server, over stdio and Streamable HTTP. */
import { type ClientTransport, ContextClient } from '@mokei/context-client'
import { spawnHostedContext } from '@mokei/host'
import { HTTPTransport } from '@mokei/http-client'
import { afterEach, describe, test } from 'vitest'

import { checkMokeiClient } from '../support/interop/expectations.ts'
import {
  type RunningHTTPServer,
  SDK_STDIO_SERVER_PATH,
  startSDKHTTPServer,
} from '../support/interop/servers.ts'

describe('mokei client against the SDK v2 server', () => {
  let httpServer: RunningHTTPServer | null = null
  let client: ContextClient | null = null

  afterEach(async () => {
    if (client != null) {
      await client.dispose()
      client = null
    }
    if (httpServer != null) {
      await httpServer.dispose()
      httpServer = null
    }
  })

  test('over stdio', async () => {
    const context = await spawnHostedContext({
      command: process.execPath,
      args: [SDK_STDIO_SERVER_PATH],
    })
    try {
      await checkMokeiClient(context.client)
    } finally {
      await context.disposer.dispose()
    }
  })

  test('over Streamable HTTP', async () => {
    httpServer = await startSDKHTTPServer()
    const transport = new HTTPTransport({ url: httpServer.url })
    client = new ContextClient({
      protocolVersion: '2025-11-25',
      transport: transport as ClientTransport,
    })
    await checkMokeiClient(client)
  })
})

/** Official SDK v2 client ↔ mokei server, over stdio and Streamable HTTP. */
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import { afterEach, describe, test } from 'vitest'

import { checkSDKClient } from '../support/interop/expectations.ts'
import {
  MOKEI_STDIO_SERVER_PATH,
  type RunningHTTPServer,
  startMokeiHTTPServer,
} from '../support/interop/servers.ts'

const CLIENT_INFO = { name: 'mokei-interop-test', version: '1.0.0' }

describe('SDK v2 client against the mokei server', () => {
  let httpServer: RunningHTTPServer | null = null
  let client: Client | null = null

  afterEach(async () => {
    if (client != null) {
      await client.close()
      client = null
    }
    if (httpServer != null) {
      await httpServer.dispose()
      httpServer = null
    }
  })

  test('over stdio', async () => {
    client = new Client(CLIENT_INFO)
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [MOKEI_STDIO_SERVER_PATH],
      }),
    )
    await checkSDKClient(client)
  })

  test('over Streamable HTTP', async () => {
    httpServer = await startMokeiHTTPServer()
    client = new Client(CLIENT_INFO)
    await client.connect(new StreamableHTTPClientTransport(new URL(httpServer.url)))
    await checkSDKClient(client)
  })
})

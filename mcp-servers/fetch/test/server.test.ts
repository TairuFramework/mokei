import { DirectTransports } from '@enkaku/transport'
import { ContextClient } from '@mokei/context-client'
import type { ClientMessage, ServerMessage } from '@mokei/context-protocol'
import { ContextServer } from '@mokei/context-server'
import { expect, test } from 'vitest'

// Deliberately the untyped ContextClient: ExtractServerTypes cannot currently produce usable tool
// types -- it yields `never` arguments when the server config is annotated, and exceeds the
// instantiation depth when it is not. See backlog/2026-07-11-typed-client-extraction.md. These
// tests cover the server, not that feature.

import { createFetchConfig } from '../src/config.js'

test('run server', async () => {
  const config = createFetchConfig()
  const transports = new DirectTransports<ServerMessage, ClientMessage>()
  const server = new ContextServer({ ...config, transport: transports.server })

  const client = new ContextClient({ transport: transports.client })

  await expect(
    client.callTool({ name: 'get_markdown', arguments: { url: 'https://mokei.dev' } }),
  ).resolves.toMatchObject({
    content: [{ type: 'text', text: expect.stringContaining('Mokei') }],
    isError: false,
  })

  await server.dispose()
})

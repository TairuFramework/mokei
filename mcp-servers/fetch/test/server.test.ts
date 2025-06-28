import { DirectTransports } from '@enkaku/transport'
import { ContextClient } from '@mokei/context-client'
import type { ClientMessage, ServerMessage } from '@mokei/context-protocol'
import { ContextServer } from '@mokei/context-server'

import { config } from '../src/config.js'

test('run server', async () => {
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

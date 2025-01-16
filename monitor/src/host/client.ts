import { Client } from '@enkaku/client'
import { ClientTransport } from '@enkaku/http-client-transport'

import type { Protocol } from './protocol.js'

export type HostClient = Client<Protocol>

export function createClient(url: string): HostClient {
  const transport = new ClientTransport<Protocol>({ url })
  return new Client<Protocol>({ transport })
}

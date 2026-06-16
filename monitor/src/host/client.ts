import { Client } from '@enkaku/client'
import { ClientTransport } from '@enkaku/http-client-transport'
import type { Protocol } from '@mokei/host-protocol'

export type HostClient = Client<Protocol>

export function createHostClient(url: string): HostClient {
  const token = (globalThis as { __MOKEI_TOKEN__?: string }).__MOKEI_TOKEN__
  const authFetch: typeof fetch = (input, init) => {
    const headers = new Headers(init?.headers)
    if (token != null) {
      headers.set('authorization', `Bearer ${token}`)
    }
    return fetch(input, { ...init, headers })
  }
  const transport = new ClientTransport<Protocol>({ url, fetch: authFetch })
  return new Client<Protocol>({ transport })
}

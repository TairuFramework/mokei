import {
  type ClientTransport,
  ContextClient,
  type ContextTypes,
  type ElicitHandler,
  type UnknownContextTypes,
} from '@mokei/context-client'
import type { ProtocolVersion } from '@mokei/context-protocol'
import { Disposer } from '@sozai/async'

import type { ContextTool } from './tools.js'

export type HostedContext<T extends ContextTypes = UnknownContextTypes> = {
  client: ContextClient<T>
  disposer: Disposer
  tools: Array<ContextTool>
}

export type CreateHostedContextParams = {
  transport: ClientTransport
  tools?: Array<ContextTool>
  elicit?: ElicitHandler
  dispose?: () => void | Promise<void>
  /**
   * Revision the client speaks, or `'auto'` to probe the server. Defaults to `'auto'`:
   * the probe resolves `'2026-07-28'` when the server serves it and falls back to
   * `'2025-11-25'` otherwise. Pin a revision to skip the probe's extra round trip.
   */
  protocolVersion?: ProtocolVersion | 'auto'
}

export function createHostedContext<T extends ContextTypes = UnknownContextTypes>(
  params: CreateHostedContextParams,
): HostedContext<T> {
  // `'auto'` rather than the newest revision: a host points at arbitrary third-party servers,
  // most of which serve `'2025-11-25'` only, and a `'2026-07-28'` pin rejects those with
  // `-32022` instead of negotiating down. Callers that know their server pin explicitly.
  const { transport, tools = [], dispose, protocolVersion = 'auto', elicit } = params
  const client = new ContextClient<T>({ protocolVersion, transport, elicit })
  const disposer = new Disposer({
    dispose: async () => {
      // Via the client, not the transport: `client.dispose()` runs `_beforeTransportClose` (tears
      // down the subscription driver, suppresses reconnect) then disposes the transport. Disposing
      // the transport directly would skip that and could leave a reconnect firing after teardown.
      await client.dispose()
      await dispose?.()
    },
  })
  return { client, disposer, tools }
}

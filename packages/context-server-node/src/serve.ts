import { NodeStreamsTransport } from '@enkaku/node-streams'
import type { ClientMessage, ServerMessage } from '@mokei/context-protocol'
import { ContextServer, type ServerConfig } from '@mokei/context-server'

/**
 * Create a Context server communicating over the process's stdio streams.
 */
export function serveProcess(config: ServerConfig): ContextServer {
  const transport = new NodeStreamsTransport<ClientMessage, ServerMessage>({
    streams: { readable: process.stdin, writable: process.stdout },
  })
  return new ContextServer({ ...config, transport })
}

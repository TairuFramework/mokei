/** Helpers starting the interop fixture over stdio or Streamable HTTP, on either stack. */
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node'
import { ContextServer } from '@mokei/context-server'
import { serveHTTP } from '@mokei/http-server'

import { createMokeiConfig, createSDKServer } from './fixture.ts'

export const MOKEI_STDIO_SERVER_PATH = fileURLToPath(
  new URL('./mokei-stdio-server.ts', import.meta.url),
)
export const SDK_STDIO_SERVER_PATH = fileURLToPath(
  new URL('./sdk-stdio-server.ts', import.meta.url),
)

export type RunningHTTPServer = {
  url: string
  dispose: () => Promise<void>
}

/** The minimal listening surface shared by `node:http` and the `serveHTTP` return value. */
type ListeningServer = {
  listening: boolean
  once: (event: string, listener: (...args: Array<unknown>) => void) => unknown
  address: () => string | { port: number } | null
}

async function listening(server: ListeningServer, hostname: string): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    if (server.listening) {
      resolve()
      return
    }
    server.once('listening', () => {
      resolve()
    })
    server.once('error', (error) => {
      reject(error instanceof Error ? error : new Error(String(error)))
    })
  })
  const address = server.address()
  if (address == null || typeof address === 'string') {
    throw new Error(`Server is not listening on ${hostname}`)
  }
  return address.port
}

/** Serves the fixture over Streamable HTTP using `@mokei/http-server`. */
export async function startMokeiHTTPServer(): Promise<RunningHTTPServer> {
  const config = createMokeiConfig()
  const result = serveHTTP({
    createServer: (transport) => new ContextServer({ ...config, transport }),
    port: 0,
    hostname: '127.0.0.1',
  })
  const port = await listening(result.server, '127.0.0.1')
  return {
    url: `http://127.0.0.1:${port}/mcp`,
    dispose: async () => {
      result.dispose()
    },
  }
}

/**
 * Serves the fixture over Streamable HTTP using the SDK v2 Node transport, in stateless
 * mode: every POST is handled by a transport bound to a fresh server instance.
 */
export async function startSDKHTTPServer(): Promise<RunningHTTPServer> {
  const server = createServer((request, response) => {
    void (async () => {
      const transport = new NodeStreamableHTTPServerTransport({ sessionIdGenerator: undefined })
      response.on('close', () => {
        void transport.close()
      })
      try {
        await createSDKServer().connect(transport)
        await transport.handleRequest(request, response)
      } catch (cause) {
        if (!response.headersSent) {
          response.writeHead(500).end(String(cause))
        }
      }
    })()
  })
  server.listen(0, '127.0.0.1')
  const port = await listening(server, '127.0.0.1')
  return {
    url: `http://127.0.0.1:${port}/mcp`,
    dispose: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error == null ? resolve() : reject(error)))
        server.closeAllConnections()
      }),
  }
}

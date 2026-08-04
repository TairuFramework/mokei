/** Helpers starting the interop fixture over stdio or Streamable HTTP, on either stack. */
import { type ChildProcessByStdio, spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { PassThrough, type Readable, type Writable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { NodeStreamsTransport } from '@enkaku/node-streams'
import { Client } from '@modelcontextprotocol/client'
import { NodeStreamableHTTPServerTransport, toNodeHandler } from '@modelcontextprotocol/node'
import { createMcpHandler } from '@modelcontextprotocol/server'
import { type ClientTransport, ContextClient } from '@mokei/context-client'
import type { ProtocolVersion } from '@mokei/context-protocol'
import { ContextServer, createTool, type ServerConfig } from '@mokei/context-server'
import { createHTTPClient } from '@mokei/http-client'
import { serveHTTP } from '@mokei/http-server'

import { createMokeiConfig, createSDKServer, SERVER_NAME, SERVER_VERSION } from './fixture.ts'

export const MOKEI_STDIO_SERVER_PATH = fileURLToPath(
  new URL('./mokei-stdio-server.ts', import.meta.url),
)
export const SDK_STDIO_SERVER_PATH = fileURLToPath(
  new URL('./sdk-stdio-server.ts', import.meta.url),
)
/** Serves the fixture on protocol version `2026-07-28` only, via the official SDK v2 server. */
export const SDK_STDIO_SERVER_2026_07_28_PATH = fileURLToPath(
  new URL('./sdk-stdio-server-2026-07-28.ts', import.meta.url),
)
/**
 * Serves the fixture on protocol version `2025-11-25` only, via `@mokei/context-server`. Distinct
 * from `MOKEI_STDIO_SERVER_PATH`, which now serves both revisions (matching mokei's own bundled
 * servers): the version-detection suite needs a server that genuinely refuses `2026-07-28` to
 * exercise the handshake-only fallback and rejection cases.
 */
export const MOKEI_STDIO_SERVER_2025_11_25_PATH = fileURLToPath(
  new URL('./mokei-stdio-server-2025-11-25.ts', import.meta.url),
)
/** Serves the fixture on protocol version `2026-07-28` only, via `@mokei/context-server`. */
export const MOKEI_STDIO_SERVER_2026_07_28_PATH = fileURLToPath(
  new URL('./mokei-stdio-server-2026-07-28.ts', import.meta.url),
)
/** Serves the fixture on both `2026-07-28` and `2025-11-25`, via `@mokei/context-server`. */
export const MOKEI_STDIO_SERVER_BOTH_PATH = fileURLToPath(
  new URL('./mokei-stdio-server-both.ts', import.meta.url),
)
/** Serves a tool that only settles when its handler signal aborts, on `2026-07-28`. */
export const MOKEI_STDIO_SERVER_CANCELLATION_PATH = fileURLToPath(
  new URL('./mokei-stdio-server-cancellation.ts', import.meta.url),
)
/** Serves a slow and a quick tool, on `2026-07-28`, to exercise concurrent request handling. */
export const MOKEI_STDIO_SERVER_CONCURRENCY_PATH = fileURLToPath(
  new URL('./mokei-stdio-server-concurrency.ts', import.meta.url),
)
/** Refuses every request, including `server/discover` and `initialize`. */
export const REFUSING_STDIO_SERVER_PATH = fileURLToPath(
  new URL('./refusing-stdio-server.ts', import.meta.url),
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

/** Grace period (ms) between SIGTERM and SIGKILL when tearing down a spawned client's child. */
const KILL_TIMEOUT = 5000

/**
 * Splits a byte stream into JSON lines, pushing each parsed line onto `sink`. A line that fails
 * to parse is reported via `onError` instead of thrown: throwing out of a stream's `data`
 * handler raises an uncaught exception that crashes the whole test-runner process, not just the
 * current test (see `spawnMokeiStdioClient`, which mirrors `packages/host/src/host.ts`'s
 * `onInvalidJSON`/`readFailed` intent at test-fixture scale for exactly this reason).
 */
function recordJSONLines(
  state: { text: string },
  chunk: Buffer | string,
  sink: Array<Record<string, unknown>>,
  onError: (error: Error) => void,
): void {
  state.text += chunk.toString('utf8')
  let index = state.text.indexOf('\n')
  while (index !== -1) {
    const line = state.text.slice(0, index).trim()
    state.text = state.text.slice(index + 1)
    if (line.length > 0) {
      try {
        sink.push(JSON.parse(line) as Record<string, unknown>)
      } catch (cause) {
        onError(
          new Error(`Invalid JSON on the tapped stdin line: ${line.slice(0, 200)}`, { cause }),
        )
      }
    }
    index = state.text.indexOf('\n')
  }
}

type SpawnedChildProcess = ChildProcessByStdio<Writable, Readable, Readable>

async function killChild(childProcess: SpawnedChildProcess): Promise<void> {
  if (childProcess.exitCode != null || childProcess.signalCode != null) {
    return
  }
  await new Promise<void>((resolve) => {
    let killTimer: ReturnType<typeof setTimeout>
    childProcess.once('exit', () => {
      clearTimeout(killTimer)
      resolve()
    })
    childProcess.kill('SIGTERM')
    killTimer = setTimeout(() => {
      childProcess.kill('SIGKILL')
    }, KILL_TIMEOUT)
  })
}

export type SpawnedMokeiClient = {
  client: ContextClient
  /**
   * Every JSON-RPC request object the client wrote to the wire, captured by tapping the raw
   * stdin bytes before they reach the child — independent of whatever `ContextClient`'s own
   * typed surface exposes back to the caller, since a request's decorated `_meta` never comes
   * back through the client's public API.
   */
  sent: Array<Record<string, unknown>>
  dispose: () => Promise<void>
}

/**
 * Spawns `serverPath` and connects a mokei `ContextClient` to it directly over stdio, at
 * `protocolVersion`.
 *
 * Deliberately does not go through `@mokei/host`'s `spawnHostedContext` (which does support a
 * `protocolVersion` parameter): this helper also taps the raw stdin bytes to capture every
 * JSON-RPC request the client wrote to the wire (`sent`), used to assert on `_meta` that
 * `ContextClient`'s public API never surfaces back to the caller. `spawnHostedContext` has no
 * hook for that tap, so tests that need `sent` spawn directly here instead.
 */
export async function spawnMokeiStdioClient(
  serverPath: string,
  protocolVersion: ProtocolVersion,
): Promise<SpawnedMokeiClient> {
  const childProcess = spawn(process.execPath, [serverPath], {
    stdio: ['pipe', 'pipe', 'pipe'],
  }) as SpawnedChildProcess
  // Without this, a fixture that crashes on startup produces an opaque hang (the client waits
  // forever for a response that will never come) instead of the server's own error.
  childProcess.stderr.pipe(process.stderr)

  const sent: Array<Record<string, unknown>> = []
  const state = { text: '' }
  const tap = new PassThrough()
  const reportStreamError = (context: string, error: Error): void => {
    console.error(`[interop fixture] ${serverPath} — ${context}:`, error)
  }
  // Neither `tap` nor `childProcess.stdin` has an `error` listener by default; a dead child
  // turns a write into an unhandled EPIPE that crashes the whole test-runner process rather
  // than failing just this test. Reporting (not swallowing) keeps the failure diagnosable.
  tap.on('error', (error: Error) => {
    reportStreamError('tapped stdin stream error', error)
  })
  childProcess.stdin.on('error', (error: Error) => {
    reportStreamError('child stdin write error', error)
  })
  tap.on('data', (chunk: Buffer) => {
    recordJSONLines(state, chunk, sent, (error) => {
      reportStreamError('malformed tapped stdin line', error)
    })
  })
  tap.pipe(childProcess.stdin)

  const transport = new NodeStreamsTransport({
    streams: { readable: childProcess.stdout, writable: tap },
  })
  const client = new ContextClient({ protocolVersion, transport: transport as ClientTransport })

  return {
    client,
    sent,
    dispose: async () => {
      await client.dispose()
      await killChild(childProcess)
    },
  }
}

/**
 * Serves the fixture over Streamable HTTP using `@mokei/http-server`.
 *
 * `protocolVersions` is passed straight through to `createMokeiConfig`, whose own default
 * (both revisions) applies when it is omitted. Suites needing a server that genuinely refuses
 * one of the two revisions pass an explicit one-element list.
 */
export async function startMokeiHTTPServer(
  protocolVersions?: Array<ProtocolVersion>,
): Promise<RunningHTTPServer> {
  const config = createMokeiConfig(protocolVersions)
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

/** Connects a mokei `ContextClient` to `url` over Streamable HTTP at `protocolVersion`. */
export function connectMokeiHTTPClient(
  url: string,
  protocolVersion: ProtocolVersion | 'auto',
): ContextClient {
  return createHTTPClient({ url, protocolVersion })
}

const SDK_CLIENT_INFO = { name: 'mokei-interop-test', version: '1.0.0' }

/**
 * An SDK v2 `Client` for `protocolVersion`.
 *
 * `2025-11-25` is the SDK's default negotiation mode — a plain `new Client(info)`, byte-identical
 * to a client carrying no negotiation option at all. `2026-07-28` pins: the connect-time
 * `server/discover` must offer exactly that revision, and anything else fails loudly rather than
 * falling back to the `initialize` handshake.
 */
export function createSDKClient(protocolVersion: ProtocolVersion): Client {
  return protocolVersion === '2026-07-28'
    ? new Client(SDK_CLIENT_INFO, { versionNegotiation: { mode: { pin: '2026-07-28' } } })
    : new Client(SDK_CLIENT_INFO)
}

export type BlockingHTTPServer = RunningHTTPServer & {
  /** Name of the tool that blocks until `dispose()` releases it. */
  toolName: string
  /** Resolves once the blocking tool's handler has been entered. */
  toolCalled: Promise<void>
  /** Resolves once the throwaway `ContextServer` of a stateless exchange has been disposed. */
  serverDisposed: Promise<void>
}

/**
 * Serves a single tool that never returns on its own, over Streamable HTTP on `2026-07-28`.
 *
 * Used to observe what a stateless exchange does while a request is genuinely in flight —
 * principally whether the throwaway `ContextServer` is torn down when the caller hangs up.
 * `dispose()` releases the blocked handler so the exchange cannot outlive the test.
 */
export async function startBlockingHTTPServer(): Promise<BlockingHTTPServer> {
  let onCalled: () => void = () => {}
  const toolCalled = new Promise<void>((resolve) => {
    onCalled = resolve
  })
  let onDisposed: () => void = () => {}
  const serverDisposed = new Promise<void>((resolve) => {
    onDisposed = resolve
  })
  let release: () => void = () => {}
  const released = new Promise<void>((resolve) => {
    release = resolve
  })

  const config: ServerConfig = {
    name: SERVER_NAME,
    version: SERVER_VERSION,
    protocolVersions: ['2026-07-28'],
    tools: {
      block: createTool({
        description: 'Blocks until the test releases it',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        handler: async () => {
          onCalled()
          await released
          return { content: [{ type: 'text', text: 'released' }] }
        },
      }),
    },
  }

  const result = serveHTTP({
    createServer: (transport) => {
      const server = new ContextServer({ ...config, transport })
      const dispose = server.dispose.bind(server)
      server.dispose = async () => {
        onDisposed()
        await dispose()
      }
      return server
    },
    port: 0,
    hostname: '127.0.0.1',
  })
  const port = await listening(result.server, '127.0.0.1')
  return {
    url: `http://127.0.0.1:${port}/mcp`,
    toolName: 'block',
    toolCalled,
    serverDisposed,
    dispose: async () => {
      release()
      result.dispose()
    },
  }
}

/**
 * Serves the fixture over Streamable HTTP on `2026-07-28`, using the SDK v2 `createMcpHandler`
 * entry mounted on `node:http` through `toNodeHandler`.
 *
 * `legacy: 'reject'` makes the endpoint serve `2026-07-28` and nothing else. It changes nothing
 * about today's result — mokei declares the revision on every request either way — so it is
 * there against a *partial* regression: were mokei to stop declaring it on, say, `tools/call`
 * but not `server/discover`, the default fallback would answer those calls from the SDK's
 * `2025-11-25` path and every assertion here would still pass, silently testing the wrong
 * revision. The factory runs per request, as that entry requires — `createSDKServer()` builds a
 * fresh instance each time.
 */
export async function startSDK20260728HTTPServer(): Promise<RunningHTTPServer> {
  const handler = createMcpHandler(() => createSDKServer(), { legacy: 'reject' })
  const nodeHandler = toNodeHandler(handler)
  const server = createServer((request, response) => {
    void nodeHandler(request, response)
  })
  server.listen(0, '127.0.0.1')
  const port = await listening(server, '127.0.0.1')
  return {
    url: `http://127.0.0.1:${port}/mcp`,
    dispose: async () => {
      await handler.close()
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error == null ? resolve() : reject(error)))
        server.closeAllConnections()
      })
    },
  }
}

/**
 * Serves the fixture over Streamable HTTP on `2025-11-25`, using the SDK v2 Node transport in
 * stateless mode: every POST is handled by a transport bound to a fresh server instance.
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

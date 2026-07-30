/** Helpers starting the interop fixture over stdio or Streamable HTTP, on either stack. */
import { type ChildProcessByStdio, spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { PassThrough, type Readable, type Writable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { NodeStreamsTransport } from '@enkaku/node-streams'
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node'
import { type ClientTransport, ContextClient } from '@mokei/context-client'
import type { ProtocolVersion } from '@mokei/context-protocol'
import { ContextServer } from '@mokei/context-server'
import { serveHTTP } from '@mokei/http-server'

import { createMokeiConfig, createSDKServer } from './fixture.ts'

export const MOKEI_STDIO_SERVER_PATH = fileURLToPath(
  new URL('./mokei-stdio-server.ts', import.meta.url),
)
export const SDK_STDIO_SERVER_PATH = fileURLToPath(
  new URL('./sdk-stdio-server.ts', import.meta.url),
)
/** Serves the fixture on protocol version `2026-07-28` only, via `@mokei/context-server`. */
export const MOKEI_STDIO_SERVER_2026_07_28_PATH = fileURLToPath(
  new URL('./mokei-stdio-server-2026-07-28.ts', import.meta.url),
)
/** Serves the fixture on both `2026-07-28` and `2025-11-25`, via `@mokei/context-server`. */
export const MOKEI_STDIO_SERVER_BOTH_PATH = fileURLToPath(
  new URL('./mokei-stdio-server-both.ts', import.meta.url),
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

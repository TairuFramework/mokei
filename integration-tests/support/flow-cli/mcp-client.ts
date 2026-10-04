import { spawn } from 'node:child_process'
import { NodeStreamsTransport } from '@enkaku/node-streams'
import { type ClientTransport, ContextClient } from '@mokei/context-client'

import { CLI_BINARY, CLI_CWD, type CLIEnv } from './run-cli.js'

const KILL_TIMEOUT_MS = 5_000

export type ToolResult = {
  content: Array<{ type: string; text?: string }>
  structuredContent?: Record<string, unknown>
  isError?: boolean
}

export type MCPConnection = Awaited<ReturnType<typeof connectMCP>>

/**
 * Spawns `mokei flows mcp -s <socketPath>` and connects a `ContextClient` over its stdio.
 * `exited` settles with the process exit; `dispose` closes the client, then kills the process if
 * it has not exited on its own.
 */
export async function connectMCP(env: CLIEnv, socketPath: string) {
  const child = spawn(process.execPath, [CLI_BINARY, 'flows', 'mcp', '-s', socketPath], {
    cwd: CLI_CWD,
    env: { ...process.env, ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  let stderr = ''
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString()
  })
  // A dead child turns a late client write into EPIPE; the test reports the exit instead.
  child.stdin.on('error', () => {})
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.once('exit', (code, signal) => resolve({ code, signal }))
  })
  const transport = new NodeStreamsTransport({
    streams: { readable: child.stdout, writable: child.stdin },
  })
  const client = new ContextClient({
    protocolVersion: '2026-07-28',
    transport: transport as ClientTransport,
  })

  async function call(name: string, args: Record<string, unknown> = {}, signal?: AbortSignal) {
    return (await client.callTool({
      name,
      arguments: args,
      ...(signal == null ? {} : { signal }),
    } as never)) as ToolResult
  }

  async function dispose(): Promise<void> {
    await client.dispose().catch(() => {})
    child.stdin.end()
    if (child.exitCode != null || child.signalCode != null) return
    const timer = setTimeout(() => child.kill('SIGKILL'), KILL_TIMEOUT_MS)
    try {
      await exited
    } finally {
      clearTimeout(timer)
    }
  }

  return { client, child, call, exited, stderr: () => stderr, dispose }
}

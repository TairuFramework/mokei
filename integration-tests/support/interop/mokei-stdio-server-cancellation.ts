/**
 * Stdio entry point for the cancellation test, on `2026-07-28`.
 *
 * `hang` settles when its own handler `signal` aborts, and records that it did in
 * process-lifetime state; `started` and `aborted` read that state back. The state is read back
 * out of band because the RPC surface cannot show it: a cancelled call's response is never
 * written, so whether the server stopped working is invisible to the client that cancelled it.
 *
 * The deadline is what actually settles `hang` today, and is not merely a harness guard.
 * `ContextRPC`'s read loop awaits each message's handler before reading the next, so nothing —
 * including `notifications/cancelled` — is read while this handler is pending, and the abort it
 * would trigger cannot arrive until after the handler has already finished. Keep it short: the
 * connection is unusable for its duration.
 */
import { createTool, serveProcess } from '@mokei/context-server'

const HANG_DEADLINE = 500

const state = { aborted: false, started: false }

const noArguments = { type: 'object', properties: {}, additionalProperties: false } as const

serveProcess({
  name: 'mokei-cancellation-fixture',
  version: '1.0.0',
  protocolVersions: ['2026-07-28'],
  tools: {
    hang: createTool({
      description: 'Settles only when its handler signal aborts',
      inputSchema: noArguments,
      handler: ({ signal }) => {
        state.started = true
        return new Promise<{ content: Array<{ type: 'text'; text: string }> }>((resolve) => {
          const settle = (text: string) => resolve({ content: [{ type: 'text', text }] })
          const timer = setTimeout(() => settle('deadline'), HANG_DEADLINE)
          signal.addEventListener(
            'abort',
            () => {
              state.aborted = true
              clearTimeout(timer)
              settle('aborted')
            },
            { once: true },
          )
        })
      },
    }),
    started: createTool({
      description: 'Reports whether the hang handler has begun',
      inputSchema: noArguments,
      handler: () => ({ content: [{ type: 'text', text: String(state.started) }] }),
    }),
    aborted: createTool({
      description: 'Reports whether the hang handler signal aborted',
      inputSchema: noArguments,
      handler: () => ({ content: [{ type: 'text', text: String(state.aborted) }] }),
    }),
  },
})

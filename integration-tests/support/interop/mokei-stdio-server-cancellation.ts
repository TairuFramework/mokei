/**
 * Stdio entry point for the cancellation test, on `2026-07-28`.
 *
 * `hang` settles when its own handler `signal` aborts, or on its deadline, whichever comes
 * first; `started` reports whether it began. That is read back out of band because the RPC
 * surface cannot show it: a cancelled call's response is never written, so what the server did
 * with the call is invisible to the client that cancelled it.
 *
 * **The abort is unobservable today, so nothing here reports it.** The deadline is what actually
 * settles `hang`, and is not merely a harness guard: `ContextRPC`'s read loop awaits each
 * message's handler before reading the next, so nothing — including `notifications/cancelled` —
 * is read while this handler is pending. By the time the cancellation is read, `hang` has already
 * settled and `#receivedRequests[id]` has been deleted, so the abort never fires. A tool
 * reporting the abort flag would therefore report `false` unconditionally, which reads as
 * verification of an abort that never happened; the abort listener is kept because it is what
 * a correct handler does, not because anything exercises it. The read loop is tracked in
 * `docs/agents/plans/backlog/2026-06-20-mcp-draft-remaining.md`.
 *
 * Keep the deadline short: the connection is unusable for its duration.
 */
import { createTool, serveProcess } from '@mokei/context-server'

const HANG_DEADLINE = 500

const state = { started: false }

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
  },
})

/**
 * Stdio entry point for the cancellation test, on `2026-07-28`.
 *
 * `hang` settles when its own handler `signal` aborts, or on its deadline, whichever comes
 * first; `started` reports whether it began, and `aborted` reports whether its `signal` fired.
 * Both are read back out of band because the RPC surface cannot show them: a cancelled call's
 * response is never written, so what the server did with the call is invisible to the client
 * that cancelled it.
 *
 * **The abort is now observable.** `ContextRPC`'s read loop no longer awaits each message's
 * handler before reading the next, so `notifications/cancelled` is read — and the corresponding
 * handler's `signal` is aborted — while `hang` is still pending, instead of only after it has
 * already settled on its deadline.
 */
import { createTool, serveProcess } from '@mokei/context-server'

const HANG_DEADLINE = 5_000

const state = { started: false, aborted: false }

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
              state.aborted = true
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
      description: 'Reports whether the hang handler observed its signal abort',
      inputSchema: noArguments,
      handler: () => ({ content: [{ type: 'text', text: String(state.aborted) }] }),
    }),
  },
})

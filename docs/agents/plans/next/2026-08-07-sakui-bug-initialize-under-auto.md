# Bug: `initialize()` throws under `protocolVersion: 'auto'`

**Filed:** 2026-08-07, from a Sakui integration-suite run. **Origin repo:** `../sakui/`.
**Status:** FIXED 2026-08-07, as reported. `initialize()` now awaits `#ready` before
`#requireProtocol()`, matching `discover()` — `packages/context-client/src/client.ts`, with a
regression test at `packages/context-client/test/lib.test.ts` calling `initialize()` as the very
first thing on a fresh `'auto'` client (verified to fail with the reported error without the fix).
The `#initialize()` version-mismatch comment was corrected: that `dispose()` *is* now reached by
`#setup()`'s blanket catch as well, which is harmless because `Disposer.dispose()` is idempotent.
The suggested fix was taken as written; the "resolve without entering `#setup()`" alternative was
not, since matching `discover()` keeps every public method on one rule.
**Affects:** `@mokei/context-client` 0.11.0 (with `@mokei/host` 0.11.0).

`ContextClient.initialize()` is unusable on any `'auto'` client. It throws synchronously,
before any I/O, on essentially every call.

## Reproduction

Any consumer of `spawnHostedContext` that calls `initialize()`:

```ts
const { client, disposer } = await spawnHostedContext({ command: 'node', args: [BIN, 'mcp'] })
await client.initialize()
// Error: The 'auto' protocol version has not been resolved yet
//   at ContextClient.#requireProtocol
//   at ContextClient.initialize
```

`spawnHostedContext` defaults to `protocolVersion: 'auto'` (`packages/host/src/host.ts:150`),
and Sakui's server speaks `2025-11-25`, so the probe falls back to the handshake — which is
exactly the path `initialize()` is for.

In Sakui this fails 35 of 37 integration tests, all at the same harness line.

## Cause

`packages/context-client/src/client.ts:1235`:

```ts
async initialize(): Promise<InitializeResult> {
  const protocol = this.#requireProtocol()   // <- throws: #protocol is still null
  if (!protocol.requiresHandshake) { ... }
  return await this.#initialized
}
```

Under `'auto'`, `#protocol` is null until `#setup()` runs the probe, and `#setup()` only runs
when something awaits `#ready`. `initialize()` never does — so `#requireProtocol()` throws
before the probe that would resolve it ever starts. It is a race only in the sense that a
same-tick resolution is impossible: the probe needs a round trip.

## This is the bug you already fixed, in the one method that was missed

From `packages/context-client/test/lib.test.ts:1860`:

> `getPrompt`, `readResource` and `callTool` call `request()` directly with no `#ready` await
> of their own (unlike `setLoggingLevel`/`complete`/`listTools`/`#listPaged`). Calling any of
> them *first* under `protocolVersion: 'auto'` used to throw "not resolved yet" synchronously
> instead of running the probe.

That fix went into `request()` (`:610`), and three regression tests cover the three methods
that reach it. `initialize()` does not go through `request()` — it writes and reads the
transport directly — so it kept the old shape and no test caught it. `discover()`'s own
docblock (`:1254`) says it "awaits `#ready` like every other public method here"; `initialize()`
is the exception to that claim.

## Why it can't be worked around downstream

Under `'auto'` there is currently **no** way for a consumer to obtain an `InitializeResult`.
`initialize()` is the only accessor, and any call to something else first (to force the probe)
resolves `#initialized` without handing the result back. A consumer that wants the server's
declared capabilities and `serverInfo` from the handshake has nowhere else to get them.

Sakui is not adding a workaround (its own guardrails forbid one) and is holding its integration
suite until this lands.

## Suggested fix

Await readiness first, the same way `discover()` does:

```ts
async initialize(): Promise<InitializeResult> {
  await this.#ready
  const protocol = this.#requireProtocol()
  ...
}
```

No deadlock: `#setup()` awaits `#initialized` for handshake revisions, and `#initialize()`
never calls `request()`, so the cycle `request()`'s comment at `:585` rules out does not apply
here either — the public method is only ever entered from outside.

**One wrinkle worth deciding deliberately**, not a blocker: `#initialize()`'s comment at `:814`
justifies its own `dispose()` on a version mismatch with *"the public `initialize()` awaits
`#initialized` directly, without ever going through `#setup()`"*. Routing it through `#ready`
makes that false — `#setup()`'s blanket catch would then also `dispose()`. Probably harmless if
`dispose()` is idempotent, but the comment needs updating either way, and you may prefer to
resolve the protocol without entering `#setup()` at all.

Whatever shape it takes, a regression test calling `initialize()` as the very first thing on a
fresh `'auto'` client — matching the three at `lib.test.ts:1866` onward — would have caught it.

## Sakui's stake

`apps/cli/test/integration/support/mcp-harness.ts:30` spawns `sakui mcp` as a real child and
handshakes over stdio before returning. That harness backs every MCP and TUI integration test.
Nothing in Sakui's shipping code path is affected — `sakui mcp` itself serves fine, and the CLI
daemon, TUI and desktop app were all verified working on the same tree.

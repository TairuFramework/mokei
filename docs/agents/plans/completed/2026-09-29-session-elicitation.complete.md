# Session elicitation — complete

**Status:** complete
**Date:** 2026-09-29
**Branch:** `feat/session-elicitation`
**Follow-ons:** [session elicitation follow-ons](../backlog/2026-09-29-session-elicitation-follow-ons.md)

## Goal

Let a `Session` or `AgentSession` answer `elicitation/create` requests from any connected MCP server on both
revisions (`2025-11-25` reverse RPC and `2026-07-28` MRTR input requests), so a server can ask the user for input
mid-call. Before this work `ContextClient` supported an `elicit` handler, but `ContextHost` built every client
without one. The first consumer is the planned decision-flow server, whose flow `input` nodes become MCP task input
requests fulfilled by the same handler.

Out of scope: host-level sampling and roots, a CLI or UI prompt, and forwarding URL-mode
`notifications/elicitation/complete`.

## Architecture and key design decisions

- **Capability fixed at host construction.** `ContextHostParams.elicit?: HostElicitHandler | true` turns elicitation
  on for every client the host builds, declared in `initialize` on `2025-11-25` and in each request's `_meta` on
  `2026-07-28`, before any agent attaches. Without the option clients are unchanged. `host.elicitationEnabled`
  reports the choice.
- **Dispatch order.** An installed override, else the base handler (when `elicit` is a function), else
  `{ action: 'decline' }`. Handlers receive `{ key, params, signal }`, where `key` names the asking context.
- **One owner at a time.** `host.handleElicitation(override)` installs a single override and returns an idempotent
  remover; a second install throws, because routing between two owners by context key alone would misroute
  requests. The override gets a `fallback({ signal? })` that runs the base handler or decline. Installing on a host
  built without `elicit` throws.
- **Per-context opt-out.** `elicit: false` on the context-adding params of `ContextHost`, `NodeContextHost`,
  `ProxyHost`, `Session.addHTTPContext` and `NodeSession.addContext`. `registerHostedContext` keeps the caller's own
  client handler. `Session` and `NodeSession` forward `elicit` to the host they build and throw when given both a
  `contextHost` and `elicit`.
- **Agent ownership and events.** On an elicitation-enabled host, `AgentSession` installs the override at
  construction; `onElicitation` answers requests, and without it the agent emits events and defers to the fallback.
  `elicitation-request` is followed by exactly one `elicitation-response` (action only, no content) or
  `elicitation-error`, paired by `requestID`. Observer failures never change the answer or the pairing.
- **Attribution.** A request is attributed only when exactly one active run has exactly one in-flight context tool
  call whose context key matches (never a `local:` tool). Attributed requests carry `toolCall` and stream from
  `agent.stream()`; unattributed ones reach `onEvent` only. A context key cannot prove which call caused a request,
  so an unrelated request from the same context can be attributed to the in-flight call.
- **Per-run event channel and settlement barrier.** Each run has an ordered channel so an elicitation is yielded
  before its callback is awaited. When a tool call settles, pending attributed requests are aborted, their terminal
  events awaited and the channel drained; the final check and the tool's terminal event are one synchronous step,
  so both the stream and `onEvent` always see `tool-call-start`, the call's elicitation events, then the tool
  terminal.
- **Cancellation.** A per-run controller links the caller signal, timeout and agent disposal; stream abandonment
  aborts it in the generator's `finally`. Callback signals combine the request signal, the tool-call signal (when
  attributed) and disposal, so `cancelToolCall`, tool timeouts and abandoned streams cancel pending prompts, and late
  callback results are ignored.
- **Disposal.** Disposing an agent aborts its runs and keeps its override until its tool calls settle, so a request
  from those calls cannot reach a replacement owner; `dispose()` does not wait for a paused stream consumer. On
  `2025-11-25` a server that keeps running a tool after the client stops waiting can still send a later request,
  which reaches whichever owner is installed then: reverse requests carry no originating call.

## What was built

Host dispatch, override and opt-outs in `@mokei/host`; `NodeContextHost`, `ProxyHost` and `spawnHostedContext`
wiring in `@mokei/host-node`; option forwarding in `@mokei/session` and `@mokei/session-node`; agent ownership,
events, event channel, settlement barrier and cancellation in `AgentSession`. Integration suites cover `Session`,
`NodeSession` and `AgentSession` against a `2025-11-25` stdio server and a `2026-07-28` MRTR HTTP server, including
callback rejection on each revision and the capability on every MRTR retry. The architecture doc and package READMEs
describe the behaviour.

## Validation

Executed subagent-driven (10 tasks, per-task review, whole-branch review with a fix round and scoped re-reviews).
Final fixes: disposal ownership, the session README's streaming description, and a `forDaemon` test that drives a
real request. Lint, full build and full `pnpm test` pass. Released as a patch in the 0.14.x band.

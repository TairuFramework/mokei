# OTel GenAI semconv follow-ons

Close the eight follow-ons left by the GenAI semantic conventions alignment (completed summary
`docs/agents/plans/completed/2026-10-18-otel-genai-semconv.complete.md`). Same branch,
`feat/otel-genai-semconv`, before it merges.

## Intent

Make mokei's GenAI and MCP metrics count each logical operation once, and close the small gaps a
reviewer found: missing labels, an unverified flag, an env var not honoured everywhere, and spans
that can stay open forever.

## Goals

1. **Proxied calls are not double-counted.** (User decision: option B.)
2. **Multi-round tool calls (MRTR) count once.** (User decision: option C.)
3. In-process contexts get a transport label in the monitor.
4. A test proves `gen_ai.prompt.variable.<name>` truncation sets `mokei.payload.truncated`.
5. `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT` also applies to daemon `context:message` events.
6. Custom providers know how to report `gen_ai.provider.name`.
7. An inference span ends even when its stream is never drained or cancelled.
8. `@mokei/decision-flow` uses the `@sozai/otel` tracer and meter factories.

## Non-goals

- No change to the default incoming parenting (`parentFrom: 'context'`).
- No wrapper `execute_tool` span around every tool call.
- No change to how many spans the proxy emits; only metrics and labelling change.

## Decisions

### 1. Proxied calls (user decision)

In `createProxyTracing` (`@mokei/host-node`), a request whose `params._meta` carries a valid W3C
`traceparent` was measured by an instrumented caller. For such requests the proxy:

- still emits its span, unchanged in name, kind, parent and links;
- sets `mokei.mcp.proxied = true` on the span;
- does **not** record `mcp.client.operation.duration` / `mcp.server.operation.duration` for it.

Requests without `traceparent` (non-instrumented callers such as Claude Desktop) keep today's
behaviour: span and metric. `mcp.client.session.duration` is unaffected. Trade-off accepted: a traced
non-mokei caller loses the daemon-side metric point; its own client metric remains.

### 2. MRTR rounds (user decision)

When `ContextClient.request` drives MRTR rounds, every wire request keeps its own `tools/call` span
(MCP semconv is per request), and retries keep linking to the first round's span (today's behaviour).
Change:

- A round whose result is `input_required` gets `mokei.mcp.round = n` (0-based) and no
  `gen_ai.operation.name`.
- The final round gets `mokei.mcp.round = n` and `gen_ai.operation.name = execute_tool`.
- A call that never suspends is unchanged: `execute_tool`, no `mokei.mcp.round`.

So backends counting `execute_tool` spans see one per logical call. Metrics are already right:
`gen_ai.execute_tool.duration` is recorded once per logical call by `Session` around the whole call, and
`mcp.client.operation.duration` is per wire request by design. Trade-off accepted: the final span's
duration covers only the last round; the full duration is reconstructable from the linked rounds.

Mechanism (my call): for `tools/call`, `gen_ai.operation.name` is set when the exchange settles
(success that is not `input_required`, or any error), not at span start, because an OTel attribute
cannot be removed once set. Cost: that attribute is not visible to samplers at span creation. The round
index reaches retries through the existing internal request options (next to the first-round link).
`prompts/get` and `resources/read` rounds get `mokei.mcp.round` the same way.

Shared path (my call): the deferral lives in the shared `requestAttributes` / exchange settle path, so
daemon proxy spans follow the same rule: a proxied `tools/call` whose response is `input_required` ends
without `gen_ai.operation.name`. The proxy cannot know the round index, so proxy spans get no
`mokei.mcp.round`. The `mcp.*.operation.duration` metric labels keep `gen_ai.operation.name =
execute_tool` for every `tools/call` request: they describe the wire method, not the logical call.

Local failure after a suspension (my call): when the call fails after round n settled as
`input_required` with no further wire round (embedded request failure, `MRTRMaxRoundsError`,
`maxTotalTimeout`, abort between rounds), `ContextClient` emits one short `execute_tool {tool}` span,
kind `INTERNAL`, with `gen_ai.operation.name = execute_tool`, `gen_ai.tool.name`, the
`gen_ai.tool.call.id` when known, `mokei.mcp.round = n`, `error.type` (`cancelled` for aborts, otherwise
the error name per `errorTypeOf`), and a link to the first round. Failed logical calls stay visible to
span-based counts and error rates.

### 3. Monitor transport label (my call)

Context spans gain `mokei.context.transport` = `direct` | `stdio` | `http` (host and daemon proxy,
which is always `stdio`). The monitor `TraceHeader` maps `direct` to `in-process`, keeps the
`network.*` mapping for stored rows without the new attribute, and falls back to `Unknown transport`.
`network.transport` stays unset for direct contexts (no semconv value fits).

### 4. Prompt variable truncation (my call)

Code already sets the flag. Add a `context-client` test: a `prompts/get` with a variable longer than the
cap yields a truncated `gen_ai.prompt.variable.<name>` and `mokei.payload.truncated = true`.

### 5. `context:message` content gate (my call)

`daemon-server.ts` sanitises `context:message` with `resolveContentCapture(tracing?.payloads)` instead of
`tracing?.payloads`, matching the proxy spans.

### 6. Custom provider name (my call)

`ModelProvider.telemetry` is already public and optional. Document in the `@mokei/model-provider` README
how a custom provider sets it (`telemetryFromBaseURL(name, baseURL)` or a literal), and add a `session`
test that a provider with `telemetry: { providerName: 'acme' }` yields `gen_ai.provider.name=acme`.
Without `telemetry` the attribute stays absent (no guessed value).

### 7. Abandoned inference streams (my call)

In `session/src/inference-tracing.ts`:

- abort of the request signal (`inner.signal` or `request.signal`) ends the span as `cancelled` even if
  the consumer never reads again;
- a `FinalizationRegistry` (guarded with `typeof FinalizationRegistry !== 'undefined'`; React Native-safe)
  ends the span as `error.type=_OTHER`, message `stream abandoned`, if the returned stream is garbage
  collected while the span is open.

`finish` stays idempotent, so normal completion wins any race. An abort records GenAI metrics as
today (`error.type=cancelled`). A garbage-collection end is span-only: no duration or usage metric
points, because collection time is arbitrary and would skew the histograms (my call).

### 8. decision-flow factories (my call)

Add `@sozai/otel` (catalog) to `@mokei/decision-flow` and build its tracer and meter with
`createTracerFactory` / `createMeterFactory` and the schema URL. No new package. The bundle stays
Node-free (already true of `@sozai/otel` in `context-client`).

## Constraints

- Node-free packages (`model-provider`, `host`, `session`, `context-client`) keep passing their
  React Native bundle tests.
- Release intent: patch (0.14.x). Update the existing `.changeset/otel-genai-semconv.md` rather than
  adding a new intent.
- Update `docs/agents/architecture.md` where it documents the proxy duplicate and MRTR legs.
- Remove the backlog file `docs/agents/plans/backlog/2026-10-18-otel-genai-semconv-follow-ons.md` once
  the spec is approved.

## Left to the builder

- Exact test shapes and file placement.

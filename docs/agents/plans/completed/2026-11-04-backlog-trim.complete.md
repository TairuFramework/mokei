# Backlog trim and cleanups

**Status:** complete
**Date:** 2026-11-04

## Goal

Trim `next/` and `backlog/` to items with a real next step, and close the low-hanging ones. Each
closed or dropped item is recorded below, so links from older records still resolve to a reason.

## Shipped

- **Flow service startup errors keep their cause.** `RegisteredFlowError` from
  `@mokei/decision-flow-server` (re-exported by `@mokei/flow-host`) and `FlowFileError` from
  `loadFlowDirs`. The daemon log names the stage, flow file and full error; the status carries
  `FlowFileError` or `FlowDefinitionError` with the file and sanitized issue codes, shown by
  `mokei daemon start` and the monitor banner. Flow ids and checker messages stay out of the status.
- **Package version constant.** `MOKEI_VERSION` (in `@mokei/context-protocol`, re-exported by
  `@mokei/context-server`) replaces stale hard-coded `clientInfo` / `serverInfo` versions (`0.4.0`,
  `0.13.0`, `0.14.0`, `0.1.0`) and versions the `mokei` tracer and meter scopes, including the
  decision-flow tracer. A test fails when it drifts from `package.json`; update it after
  `pnpm version -r`.
- **Monitor.** The live trace list caps at 1000 summaries (oldest inactive first; paging resumes
  with `until`). A limited `useRuns` re-reads only when a visible run leaves its filter. Route code
  splitting and vendor chunks clear Vite's chunk-size warning.
- **Tests.** `openURL` abort, timeout and runner ownership; monitor-surface abort after delivery; a
  `thinking…` assertion gated on a new `separatesReasoning` backend flag.
- **Website.** The quick-start chat walkthrough is rewritten from a PTY capture of the real CLI
  (scripted Ollama endpoint for the model reply). `future.faster` replaces the renamed
  `future.experimental_faster`, so the site builds again, and the API reference is regenerated.
- **CLI.** The tool-call status no longer shows a negative running time right after a call starts
  (found during the capture).

## Closed without work

- **`@mokei/flow-host` watcher sleep** -- already on `@sozai/async`.
- **`@logtape/file` peer alignment** (flow host Node follow-ons) -- `@logtape/file` and
  `@logtape/logtape` are both 2.4.2.
- **Decision-flow tracer and server versions** -- covered by `MOKEI_VERSION` above.

## Dropped

Recorded here instead of carried as backlog; reopen as a new plan if a consumer needs one.

- **Monitor Inbox and Flows design pass** -- leftover from the flow monitor work, not a priority.
- **Llama provider tuning** (`gpu` / `contextSize` flags, a positive tool-call assertion in the
  gated GGUF suite) -- optional; nothing depends on either.
- **OpenAI-compatible reasoning against a real reasoning server** -- needs infrastructure the
  suites do not have; the `reasoning_content` / `reasoning` mapping is unit-tested.
- **In-process ggml / laya.cpp System One backend** -- blocked upstream (`laya.cpp` ships no
  library or C API and crashed on inference); `laya-serve` covers local inference. The
  `SystemOneBackend` seam stays available for one.
- **Server-minted handles convention** -- decided: handles passed between tool results and tool
  arguments stay an application-layer concern. No consumer needs a shared policy, so
  `ContextHost` adds none.
- **OAuth DCR (RFC 7591), CIMD (SEP-991), JWT-bearer grant** -- revisit when a target server
  requires them.
- **Decision flows gating session turns without a tool call**, and **checker coverage of
  `{ value }`-shaped custom filter fields** -- speculative; no consumer.
- **Decision-flow server features** (runtime tool IDs with per-call approval, a standalone
  `mcp-servers/decision-flow` binary, an `llm` node kind) -- moved to the roadmap's P3 list.
- **Task-capable `start_flow`** -- waits on Claude Code supporting MCP tasks, and needs an inbox
  design first.
- **Historical trace backfill** for runs persisted before tracing was enabled -- decided: no
  backfill. Untraced historical runs stay untraced; the recovery contract keeps existing trace
  context.
- **Host desktop leftovers** (zenity 3.x escaping, notify-send manual steps) -- the macOS QA pass
  ran on 2026-09-30 (alerter 26.5 output matched the parser for every outcome, the `osascript`
  fallback, timeouts, aborts and inbox mode all behaved as documented) and Linux runs in CI.
- **Daemon shutdown order** (dispose presence and monitor before the flow service) -- declined
  in the flow daemon review; revisit only if shutdown races appear.

## Remaining backlog

- OAuth: verified `AuthInfo` for MCP handlers; multi-context token refresh coordination.
- Session elicitation: host-level sampling and roots; server-side URL-mode completion.
- Unified traces follow-ons.
- Upstream dependency gaps, collected in one list.

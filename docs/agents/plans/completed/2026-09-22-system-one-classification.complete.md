# System One classification support (Laya runtime)

Date: 2026-09-22
Status: complete
Branch: `feat/laya-classification`

## Goal

Add TypeScript client and runtime support for System One classification to the mokei stack. System
One is the TypeSafe typed-question classification contract: a non-autoregressive decision engine
evaluates typed questions over text in a single forward pass and returns calibrated probabilities
rather than generated text. The first supported runtime is
[Laya](https://github.com/NandhaKishorM/laya), a BERT-encoder model family served locally by
`laya.cpp`. The primary use case is user-intent classification and routing inside mokei sessions,
with the core kept generic so guardrails, moderation and ticket triage share the same contract.

## What was built

- **`packages/system-one-client`** (`@mokei/system-one-client`) — platform-neutral client (no
  `node:*` builtins; depends only on `ky` and `@sozai/schema`, so it runs on desktop, web and React
  Native). Contains the schemas and derived types, `SystemOneClient` (`predict`, `predictBatch`,
  `listModels`) and `createSystemOneClient`, the pluggable `SystemOneBackend` seam,
  `HTTPSystemOneBackend`, the `routeIntent` helper, the `SystemOneError` hierarchy, and preset
  question-set factories (`routerQuestions`, `guardQuestions`, `moderationQuestions`,
  `triageQuestions`).
- **`mcp-servers/system-one`** (`@mokei/mcp-system-one`) — MCP server exposing `predict` plus preset
  tools (`route`, `guard`, `moderate`, `triage`). Reuses the client, adds no inference logic.
  Configured via `SYSTEM_ONE_URL`, `SYSTEM_ONE_API_KEY`, `SYSTEM_ONE_MODEL`.
- **`docs/reference/system-one-sidecar.md`** — System One wire contract plus `laya serve` (local
  ggmlc binary) and hosted `api.typesafe.ai` setup. Documentation only.
- Both packages are published and joined the `versioning.fixed` lockstep in `pnpm-workspace.yaml`.

## Key design decisions

- **Generic naming.** Packages and API are named after the System One contract, not Laya; Laya is
  one model family and runtime (`laya.cpp`) behind it. The Laya name stays only on
  `laya.cpp`-specific pieces (the `/v1/decide/batch` extension, `laya serve` setup, the future
  in-process `laya-ggml-*` backends).
- **Pluggable backend seam.** One backend ships now — an HTTP client speaking the TypeSafe System
  One contract (`POST /v1/systemone`, `GET /v1/models`, and the `laya.cpp`-only
  `POST /v1/decide/batch`). A single HTTP client reaches both the local `laya serve` binary and the
  hosted `api.typesafe.ai`. The seam exists so a future in-process ggml / `laya.cpp` backend slots
  in with no change to client consumers. Rejected: an HTTP-only client with no seam (would break the
  public surface when the in-process backend lands) and folding classification into `ModelProvider`
  (the typed-question shape does not fit the chat/embed contract).
- **ONNX superseded by ggml / GGUF.** The real local-inference path is GGUF via ggmlc / `laya.cpp`,
  matching the stack's `node-llama-cpp` precedent and giving a mobile (on-device ggml) and web (WASM)
  story.
- **Schema-first types.** Every value crossing the wire (questions, state, answers, models) is a
  `@sozai/schema` JSON schema, with its TypeScript type derived via `FromSchema`. The same schemas
  back runtime validation of caller inputs (before dispatch) and backend responses. `predict` infers
  each answer shape from its question `type` through a mapped type, so callers get typed access like
  `result.answers.department.choice`.
- **Model always resolved.** The TypeSafe contract requires `model` on every request, so the client
  resolves it from the per-call value or `defaultModel` and throws `SystemOneError` when neither is
  set.
- **Two type layers for the response.** `SystemOneResult` models the *raw* wire output — `answers`
  and `usage` stay snake_case (`{ input_tokens, output_tokens }`). `SystemOneClient` maps that once
  to the public `PredictResult`, whose `usage` is the camelCase `Usage` and whose `extras` collects
  any top-level `laya.cpp` response keys (family, route, latency_ms) absent from the hosted API.
- **Typed error hierarchy.** `SystemOneError` base; `SystemOneInputError` (caller schema failure,
  before any request), `SystemOneConnectionError` (unreachable / unmapped non-2xx),
  `SystemOneAuthError` (401/403), `SystemOneResponseError` (malformed response),
  `SystemOneModelError` (404 / unknown model). HTTP status maps to these in `HTTPSystemOneBackend`.

## Deviations settled during implementation

- **`HTTPSystemOneBackend`** (capital `HTTP`, per `kigu:conventions`), renamed from the original
  Laya-branded names before release.
- **Batch is opt-in.** `/v1/decide/batch` is a `laya.cpp` extension absent from the hosted API, so
  the HTTP backend only advertises `batch` when a `batch: true` option is set; otherwise
  `predictBatch` falls back to sequential `/v1/systemone` calls. The backend also validates the
  batch response envelope (results is an array, count matches input) and throws
  `SystemOneResponseError` on mismatch.
- **Schema tightening:** a `score` question requires at least 2 `criteria` levels; a `choice`
  question requires at least 1 `criteria` entry. Question/answer content stays string-only; no
  external-SDK widening.
- **`Authorization` header** is built via a `Headers` instance so a caller-supplied header cannot
  clobber the Bearer token; the key is applied only when `apiKey` is a non-empty string.
- **MCP cancellation:** tool handlers rethrow on an aborted request signal instead of mapping the
  abort to a tool-error result.

## Verification

All implementation tasks passed per-task review (spec compliance + quality), a whole-branch final
review, and an independent Codex review whose 6 findings were all fixed and re-verified. The System
One rename then ran as a separate naming-only pass. Final state: `@mokei/system-one-client` 37
tests, `@mokei/mcp-system-one` 4 tests, both builds clean, lint clean, `test:types` green, full
workspace suite green.

## Follow-on

In-process ggml / `laya.cpp` backends (native and WASM, per platform) behind the same
`SystemOneBackend` seam — see `docs/agents/plans/backlog/2026-09-22-laya-in-process-ggml-backend.md`.
GGUF compilation tooling, a lifecycle-managed sidecar process, and ONNX export remain out of scope.

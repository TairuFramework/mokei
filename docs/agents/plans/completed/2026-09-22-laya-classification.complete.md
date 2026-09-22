# Laya classification support

Date: 2026-09-22
Status: complete
Branch: `feat/laya-classification`

## Goal

Add TypeScript client and runtime support for [Laya](https://github.com/NandhaKishorM/laya)
classification to the mokei stack. Laya is a non-autoregressive "System One" decision engine on BERT
encoders that evaluates typed questions over text in a single forward pass, returning calibrated
probabilities rather than generated text. The primary use case is user-intent classification and
routing inside mokei sessions, with the core kept generic so guardrails, moderation and ticket
triage share the same contract.

## What was built

- **`packages/laya-client`** — platform-neutral client (no `node:*` builtins; depends only on `ky`
  and `@sozai/schema`, so it runs on desktop, web and React Native). Contains the schemas and
  derived types, `LayaClient` (`predict`, `predictBatch`, `listModels`), the pluggable `LayaBackend`
  seam, `HTTPLayaBackend`, the `routeIntent` helper, the error hierarchy, and preset question-set
  factories (`routerQuestions`, `guardQuestions`, `moderationQuestions`, `triageQuestions`).
- **`mcp-servers/laya`** (`@mokei/mcp-laya`) — MCP server exposing `predict` plus preset tools
  (`route`, `guard`, `moderate`, `triage`). Reuses `laya-client`, adds no inference logic.
  Configured via `LAYA_URL`, `LAYA_API_KEY`, `LAYA_MODEL`.
- **`docs/reference/laya-sidecar.md`** — TypeSafe wire contract plus `laya serve` (local ggmlc
  binary) and hosted `api.typesafe.ai` setup. Documentation only.
- Both packages are published and joined the `versioning.fixed` lockstep in `pnpm-workspace.yaml`.

## Key design decisions

- **Pluggable backend seam.** One backend ships now — an HTTP client speaking the TypeSafe System
  One contract (`POST /v1/systemone`, `GET /v1/models`, and the `laya.cpp`-only
  `POST /v1/decide/batch`). A single HTTP client reaches both the local `laya serve` binary and the
  hosted `api.typesafe.ai`. The seam exists so a future in-process ggml / `laya.cpp` backend slots
  in with no change to client consumers. Rejected: a seamless HTTP-only client (would break the
  public surface when the in-process backend lands) and folding classification into `ModelProvider`
  (Laya's typed-question shape does not fit the chat/embed contract).
- **ONNX superseded by ggml / GGUF.** The real local-inference path is GGUF via ggmlc / `laya.cpp`,
  matching the stack's `node-llama-cpp` precedent and giving a mobile (on-device ggml) and web (WASM)
  story. The spec filename retained "onnx" only for continuity.
- **Schema-first types.** Every value crossing the wire (questions, state, answers, models) is a
  `@sozai/schema` JSON schema, with its TypeScript type derived via `FromSchema`. The same schemas
  back runtime validation of caller inputs (before dispatch) and sidecar responses. `predict` infers
  each answer shape from its question `type` through a mapped type, so callers get typed access like
  `result.answers.department.choice`.
- **Model always resolved.** The TypeSafe contract requires `model` on every request, so the client
  resolves it from the per-call value or `defaultModel` and throws `LayaError` when neither is set.
- **Two type layers for the response.** `LayaResult` models the *raw* wire output — `answers` and
  `usage` stay snake_case (`{ input_tokens, output_tokens }`). `LayaClient` maps that once to the
  public `PredictResult`, whose `usage` is the camelCase `Usage` and whose `extras` collects any
  top-level `laya.cpp` response keys (family, route, latency_ms) absent from the hosted API.
- **Typed error hierarchy.** `LayaError` base; `LayaInputError` (caller schema failure, before any
  request), `LayaConnectionError` (unreachable / unmapped non-2xx), `LayaAuthError` (401/403),
  `LayaResponseError` (malformed response), `LayaModelError` (404 / unknown model). HTTP status maps
  to these in `HTTPLayaBackend`.

## Deviations settled during implementation

- **`HTTPLayaBackend`** (capital `HTTP`, per `kigu:conventions`) rather than the spec's
  `HttpLayaBackend`.
- **Batch is opt-in.** `/v1/decide/batch` is a `laya.cpp` extension absent from the hosted API, so
  the HTTP backend only advertises `batch` when a `batch: true` option is set; otherwise
  `predictBatch` falls back to sequential `/v1/systemone` calls. The backend also validates the
  batch response envelope (results is an array, count matches input) and throws `LayaResponseError`
  on mismatch.
- **Schema tightening:** a `score` question requires at least 2 `criteria` levels; a `choice`
  question requires at least 1 `criteria` entry. Question/answer content stays string-only; no
  external-SDK widening.
- **`Authorization` header** is built via a `Headers` instance so a caller-supplied header cannot
  clobber the Bearer token; the key is applied only when `apiKey` is a non-empty string.
- **MCP cancellation:** tool handlers rethrow on an aborted request signal instead of mapping the
  abort to a tool-error result.

## Verification

All 13 implementation tasks passed per-task review (spec compliance + quality), a whole-branch
final review, and an independent Codex review whose 6 findings were all fixed and re-verified.
Final state: `@mokei/laya-client` 37 tests, `@mokei/mcp-laya` 4 tests, both builds clean, lint
clean, `test:types` green, full workspace suite green.

## Follow-on

In-process ggml / `laya.cpp` backends (native and WASM, per platform) behind the same `LayaBackend`
seam — see `docs/agents/plans/backlog/2026-09-22-laya-in-process-ggml-backend.md`. GGUF compilation
tooling, a lifecycle-managed sidecar process, and ONNX export remain out of scope.

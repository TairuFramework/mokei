# Laya classification support -- design

Date: 2026-09-21 (revised 2026-09-22)
Branch: `feat/laya-classification`
Status: design approved, revised for the TypeSafe System One API and the ggmlc runtime

Note: the filename retains "onnx" for continuity. ONNX is superseded. The real local-inference
path is GGUF via ggmlc / `laya.cpp`; see "Runtime landscape" below.

## Purpose

Add TypeScript client and runtime support for [Laya](https://github.com/NandhaKishorM/laya)
classification to the mokei stack. Laya is a non-autoregressive "System One" decision engine built
on BERT encoders (ModernBERT-large, mmBERT-base). It evaluates typed questions over text in a
single forward pass, returning calibrated probabilities instead of generated text.

The primary use case is user-intent classification and routing inside mokei sessions. The design
keeps the core generic so other classification use cases -- guardrails, moderation, ticket triage --
are served by the same contract. Four consumption shapes are supported through one reused client:
a direct TypeScript client, an MCP server exposing classification tools, an agent-loop intent
router, and standalone use.

## Runtime landscape

Two facts, discovered after the first draft, shape this design:

- The TypeSafe API defines a stable wire contract, `POST /v1/systemone` and `GET /v1/models`,
  documented as an OpenAPI spec at `https://api.typesafe.ai/openapi.json`. It is a hosted service
  and requires a Bearer API key.
- [ggmlc](https://github.com/monatis/ggmlc) ships `laya.cpp`, a zero-dependency C++ runtime for
  GGUF-compiled Laya models. `laya serve model.gguf` exposes the same TypeSafe-compatible REST API
  locally, from a prebuilt binary (macOS arm64 Metal, Linux CUDA, Windows CUDA), with no Python at
  runtime. GGUFs are compiled once with a Python step (`uv pip install laya`, `compile_laya.py`).

So a single HTTP client that speaks the TypeSafe System One contract reaches both the local
`laya serve` binary and the hosted `api.typesafe.ai` service, and the official `typesafe-sdk` talks
to `laya serve` unchanged.

This also supersedes the earlier ONNX plan. The real in-process path is ggml / `laya.cpp`, which
matches the stack's existing `node-llama-cpp` GGUF precedent and gives a credible mobile story
(ggml runs on-device, and a WASM build serves web). A future in-process backend binds ggml /
`laya.cpp`, not ONNX.

## Constraints and context

- The mokei stack is cross-platform. Most packages run on desktop, web and React Native. Only
  `-node` suffixed packages carry Node-specific dependencies. The Laya core client stays neutral.
- The TypeSafe wire contract requires `model` on every request. The client therefore always
  resolves a model, from the per-call value or a `defaultModel`, and throws when neither is set.
- The hosted API needs a Bearer key. `laya serve` typically does not. The client accepts an
  optional `apiKey`.
- `/v1/decide/batch` (up to 256 states) is a `laya.cpp` extension and is absent from the hosted
  OpenAPI spec. Batch support is therefore an optional backend capability, not a client guarantee.

## Chosen approach

A platform-neutral client with a pluggable backend seam. One backend is implemented now: an HTTP
client speaking the TypeSafe System One contract. The user runs the sidecar -- `laya serve` locally
or the hosted service -- and mokei documents both. When an in-process ggml backend is built, it
slots behind the same seam with no change to client consumers.

Rejected alternatives:

- HTTP client with no backend seam. Cheaper now, but adding an in-process backend later would break
  the public surface. The seam is low cost and an in-process future is intended.
- Folding classification into `ModelProvider`. Laya's typed-question shape -- state plus questions
  producing typed answers, per-choice probabilities and token usage -- does not fit the chat and
  embed provider contract. Wrong abstraction.
- A bespoke `/predict` wire contract wrapping the Laya Python SDK. Superseded: the TypeSafe System
  One contract is real, documented, served by a zero-dependency binary, and SDK-compatible.

## Package layout

```
packages/laya-client/            neutral. Types, LayaClient, LayaBackend seam, HttpLayaBackend, routeIntent, presets
mcp-servers/laya/                MCP server exposing predict + preset tools, consumes laya-client
docs/reference/laya-sidecar.md   TypeSafe wire contract + laya serve / hosted setup
(future) packages/laya-ggml-*    in-process ggml / laya.cpp backends per platform, same LayaBackend
```

Both new packages are published and join the `versioning.fixed` lockstep in `pnpm-workspace.yaml`,
matching `@mokei/mcp-fetch` and `@mokei/mcp-sqlite`. Adding new packages is checked against the
`AGENTS.md` guardrail; this design records that approval.

`laya-client` depends only on `ky` (catalogued, fetch-based) and `@sozai/schema`. It uses no
`node:*` builtins, so it runs on desktop, web and React Native today. Future ggml backends carry
native or WASM dependencies and are split per platform; they are out of scope here, enabled only by
the seam.

## Types and schemas

Schema-first. Every public type that describes a value crossing the wire -- questions, state,
answers, usage, models -- is defined as a `@sozai/schema` JSON schema `as const`, and its TypeScript
type is derived with `FromSchema<typeof schema>`. The schema is the single source of truth. The same
schemas back runtime validation of both inputs (the caller's `questions` and `state`, validated
before dispatch) and outputs (the sidecar response). Purely structural types with no wire value
(for example `PredictResult`, the mapped answer type) stay as hand-written `type` aliases over the
derived pieces.

The core mirrors the TypeSafe Question and Answer schemas. Both are discriminated unions on `type`.
The type blocks below show the derived shapes; the implementation declares the `@sozai/schema`
source and derives them, for example:

```ts
const choiceQuestionSchema = {
  type: 'object',
  properties: {
    type: { const: 'choice' },
    instructions: {},
    criteria: { type: 'object', additionalProperties: { type: 'string' } },
  },
  required: ['type', 'criteria'],
  additionalProperties: false,
} as const satisfies Schema
type ChoiceQuestion = FromSchema<typeof choiceQuestionSchema>
```

Derived shapes:

```ts
type Instructions = string | Record<string, unknown> | Array<unknown> | null

type ChoiceQuestion = { type: 'choice'; instructions?: Instructions; criteria: Record<string, string> }
type ScoreQuestion = { type: 'score'; instructions?: Instructions; criteria: Array<string> }
type NoulQuestion = { type: 'noul'; instructions?: Instructions; criteria?: Record<string, unknown> | null }
type Question = ChoiceQuestion | ScoreQuestion | NoulQuestion
type QuestionMap = Record<string, Question>

type State = string | Record<string, unknown> | Array<unknown>

type ChoiceAnswer = {
  type: 'choice'
  choice: string
  confidence: number
  probabilities: Record<string, number>
}
type ScoreAnswer = {
  type: 'score'
  score: number
  confidence: number
  legend: Record<string, unknown>
  probabilities: Record<string, number>
}
type NoulAnswer = { type: 'noul'; noul: number }

type Usage = { inputTokens: number; outputTokens: number }

type LayaModel = { name: string; description?: string; releaseDate?: string }
```

`criteria` keys on a `choice` question are labels, values are descriptions. A `score` question's
`criteria` array lists ordinal rubric levels. A `noul` question is binary.

`predict` infers each answer's shape from its question `type` through a mapped type, so callers get
typed access such as `result.answers.department.choice`.

```ts
type AnswerFor<TQuestion> = TQuestion extends ChoiceQuestion
  ? ChoiceAnswer
  : TQuestion extends ScoreQuestion
    ? ScoreAnswer
    : NoulAnswer

type PredictResult<TQuestions extends QuestionMap> = {
  model: string
  answers: { [K in keyof TQuestions]: AnswerFor<TQuestions[K]> }
  usage: Usage
  /** laya.cpp response extras (family, route, latency_ms). Absent from the hosted API. */
  extras?: Record<string, unknown>
}
```

The wire `usage` is `{ input_tokens, output_tokens }`; validation maps it to the camelCase `Usage`.
The wire `/v1/models` returns `{ models: [{ name, description, release_date }] }`; validation maps
each entry to `LayaModel`. Runtime validation uses `@sozai/schema` validators. Preset question sets
are provided as typed `QuestionMap` factories: `routerQuestions`, `guardQuestions`,
`moderationQuestions`, `triageQuestions`.

## Client and backend seam

Every parameter object, option object, and result shape on the public API is a named, exported
type. Consumers never re-declare an inline object shape. Naming rule: backend method params are
`LayaBackend*Params`, client method params are `Laya*Params`, factory options are `*Options`, and
shared results carry a descriptive name. There is no `route` method: the TypeSafe contract has no
routing endpoint, and `laya.cpp` routing surfaces only as response `extras`.

```ts
type LayaResult = {
  model: string
  answers: Record<string, unknown>
  usage: Usage
  extras?: Record<string, unknown>
}

type LayaBackendPredictParams = {
  state: State
  questions: QuestionMap
  model: string
  signal?: AbortSignal
}
type LayaBackendBatchParams = {
  states: Array<State>
  questions: QuestionMap
  model: string
  signal?: AbortSignal
}
type LayaBackendListModelsParams = { signal?: AbortSignal }

type LayaBackend = {
  predict: (params: LayaBackendPredictParams) => Promise<LayaResult>
  batch?: (params: LayaBackendBatchParams) => Promise<Array<LayaResult>>
  listModels?: (params?: LayaBackendListModelsParams) => Promise<Array<LayaModel>>
  close?: () => Promise<void>
}
```

The backend `model` is required because the client resolves it before dispatch. `LayaClient`
validates responses, resolves the model from the per-call value or `defaultModel`, and forwards
`signal`. Every public method takes a single parameters object.

```ts
type LayaPredictParams<TQuestions extends QuestionMap> = {
  state: State
  questions: TQuestions
  model?: string
  signal?: AbortSignal
}
type LayaPredictBatchParams<TQuestions extends QuestionMap> = {
  states: Array<State>
  questions: TQuestions
  model?: string
  signal?: AbortSignal
}
type LayaListModelsParams = { signal?: AbortSignal }

class LayaClient {
  predict<TQuestions extends QuestionMap>(
    params: LayaPredictParams<TQuestions>,
  ): Promise<PredictResult<TQuestions>>

  predictBatch<TQuestions extends QuestionMap>(
    params: LayaPredictBatchParams<TQuestions>,
  ): Promise<Array<PredictResult<TQuestions>>>

  listModels(params?: LayaListModelsParams): Promise<Array<LayaModel>>
}
```

`predict` and `predictBatch` first validate `questions` (and each `state`) against the
`@sozai/schema` question/state schemas, throwing `LayaInputError` on a malformed question map before
any request is sent. `predict` throws `LayaError` when no model is resolved. `predictBatch` returns
`[]` for an empty `states` array, uses the backend's `batch` when present, otherwise issues
sequential `predict` requests.

Two factory forms build the client, each with a named options type.

```ts
type LayaHTTPClientOptions = {
  url: string
  apiKey?: string
  headers?: Record<string, string>
  fetch?: typeof fetch
  timeout?: number
  defaultModel?: string
}
type LayaBackendClientOptions = { backend: LayaBackend; defaultModel?: string }
type CreateLayaClientOptions = LayaHTTPClientOptions | LayaBackendClientOptions

createLayaClient(options: CreateLayaClientOptions): LayaClient
```

The `LayaHTTPClientOptions` form builds an `HttpLayaBackend`. When `apiKey` is set, the backend
sends `Authorization: Bearer <apiKey>`. The `LayaBackendClientOptions` form accepts a custom or
future ggml backend. `HttpLayaBackend` also takes a named `HttpLayaBackendParams`, shaped like
`LayaHTTPClientOptions` without `defaultModel`.

## HTTP wire contract

Mokei targets the TypeSafe System One contract, served by both `laya serve` and the hosted API.

```
POST /v1/systemone      { state, model, questions }              -> { model, answers, usage }
GET  /v1/models                                                  -> { models: Array<{ name, description, release_date }> }
POST /v1/decide/batch   { states: Array<State>, model, questions } -> { results: Array<{ model, answers, usage }> }
```

`/v1/decide/batch` is a `laya.cpp` extension (up to 256 states) and is absent from the hosted spec.
`HttpLayaBackend` advertises `batch`, and `LayaClient.predictBatch` falls back to sequential
`/v1/systemone` when a backend has no `batch`.

`HttpLayaBackend` uses `ky`, sends `Authorization: Bearer <apiKey>` when configured, validates each
response against a `@sozai/schema` validator, and maps HTTP status to a typed error: 401/403 to
`LayaAuthError`, 404 to `LayaModelError`, other non-2xx and network failures to
`LayaConnectionError`.

A reference doc lives in `docs/reference/laya-sidecar.md`. It documents running `laya serve` from a
ggmlc release binary, compiling a GGUF, pointing the client at the local port, and using the hosted
`api.typesafe.ai` with a Bearer key. It is documentation only.

## MCP server

`mcp-servers/laya` exposes classification to any MCP client. It reuses `laya-client` and adds no
inference logic. Configuration comes from environment variables: `LAYA_URL` (default
`http://localhost:8000`), `LAYA_API_KEY` (optional Bearer key), `LAYA_MODEL` (the default model).

Tools:

- `predict` -- `{ state, questions, model? }` returning answers. The general surface.
- `route`, `guard`, `moderate`, `triage` -- preset question sets, each taking `{ state, model? }`
  and returning answers.

Tools are built with `createTool` and `@sozai/schema` schemas. The server ships a `manifest.json`
and is registered in `mcp-servers/config.json`, matching `@mokei/mcp-fetch` and `@mokei/mcp-sqlite`.

## Agent-loop intent routing

Intent routing is a helper, not a change to `ModelProvider` or `Session`.

```ts
type IntentRoute = { label: string; confidence: number; model: string }

routeIntent(params: {
  client: LayaClient
  state: State
  question: ChoiceQuestion
  model?: string
  signal?: AbortSignal
}): Promise<IntentRoute>
```

`routeIntent` wraps `predict` with a single `choice` question keyed `intent` and returns the top
label, calibrated confidence, and the model used. Session integration is a documented pattern: call
`routeIntent` before `streamChat`, then branch on `label` and `confidence` to select tools or a
model, or to escalate when confidence is low.

## Errors

- `LayaError` -- base class.
- `LayaInputError` -- caller-supplied `questions` or `state` failed schema validation; wraps
  `@sozai/schema` issues. Thrown before any request.
- `LayaConnectionError` -- sidecar unreachable, network failure, or unmapped non-2xx status.
- `LayaAuthError` -- 401 or 403; a missing or rejected Bearer key.
- `LayaResponseError` -- malformed or schema-invalid response; wraps `@sozai/schema` issues.
- `LayaModelError` -- 404, or an unknown or unavailable model.

Abort and timeout are surfaced through `signal` and `ky`.

## Testing

- Unit tests use an in-memory `LayaBackend` mock to cover `LayaClient` typing, response validation,
  input validation (`LayaInputError` on a malformed question map, thrown before any request), the
  model-required throw, and `predictBatch` fallback.
- `HttpLayaBackend` wire behaviour is tested with a mocked `fetch`: request body shape, Bearer
  header, `usage` mapping, and status-to-error mapping.
- Type tests under `tsconfig.test.json` assert `PredictResult<TQuestions>` inference across the
  three primitives.
- Integration tests are gated behind `LAYA_URL` and skip when it is unset, matching the
  repository's integration-tests pattern.

## Out of scope

- In-process ggml / `laya.cpp` inference and the per-platform backends. The seam is defined; the
  backends are a follow-up.
- GGUF compilation tooling. Documented as a prerequisite (`uv pip install laya`,
  `compile_laya.py`), not owned by this repo.
- A shipped or lifecycle-managed sidecar process. The contract and setup are documented; the user
  runs `laya serve` or the hosted service.
- ONNX export. Superseded by the ggml / GGUF runtime.

# Laya classification support -- design

Date: 2026-09-21
Branch: `feat/laya-classification`
Status: design approved, pending spec review

## Purpose

Add TypeScript client and runtime support for [Laya](https://github.com/NandhaKishorM/laya)
classification to the mokei stack. Laya is a non-autoregressive "System 1" decision engine built
on BERT encoders (ModernBERT-large, mmBERT-base). It evaluates typed questions over text in a
single forward pass, returning calibrated probabilities instead of generated text.

The primary use case is user-intent classification and routing inside mokei sessions. The design
keeps the core generic so other classification use cases -- guardrails, moderation, ticket triage --
are served by the same contract. Four consumption shapes are supported through one reused client:
a direct TypeScript client, an MCP server exposing classification tools, an agent-loop intent
router, and standalone use.

## Constraints and context

- Laya ships PyTorch weights only. No ONNX export exists. Upstream issue #7 requests JS/TS
  bindings but is open with no maintainer response and no ONNX plan, so mokei cannot depend on
  either landing.
- ModernBERT uses operations (unpadding, rotary and flash-attention paths) whose clean ONNX export
  and `onnxruntime-web` / `onnxruntime-react-native` compatibility are unproven. In-process ONNX
  inference is therefore deferred, not attempted now.
- The mokei stack is cross-platform. Most packages run on desktop, web and React Native. Only
  `-node` suffixed packages carry Node-specific dependencies. The Laya core client must stay
  platform-neutral.
- Target platforms for the future ONNX backend are React Native (via `onnxruntime-react-native`)
  and desktop/web, with `@huggingface/transformers` considered for tokenisation and backend
  selection.

## Chosen approach

A platform-neutral client with a pluggable backend seam. One backend is implemented now: an HTTP
client to a Laya sidecar. The sidecar itself is run by the user; mokei defines and documents the
wire contract and ships a reference snippet only. When ONNX export lands upstream, an in-process
ONNX backend slots behind the same seam with no change to client consumers.

Rejected alternatives:

- HTTP client with no backend seam. Cheaper now, but adding ONNX later would break the public
  surface. The seam is low cost and the user explicitly wants an ONNX future.
- Folding classification into `ModelProvider`. Laya's typed-question shape -- state plus questions
  producing typed answers, routing metadata and calibration -- does not fit the chat and embed
  provider contract. Wrong abstraction.

## Package layout

```
packages/laya-client/            neutral. Types, LayaClient, LayaBackend seam, HttpLayaBackend, routeIntent, presets
mcp-servers/laya/                MCP server exposing predict + preset tools, consumes laya-client
docs/reference/laya-sidecar.md   HTTP wire contract + reference FastAPI sidecar snippet
(future) packages/laya-onnx-*    ONNX backends per platform (node / web / react-native), same LayaBackend
```

Both new packages are published and join the `versioning.fixed` lockstep in `pnpm-workspace.yaml`,
matching `@mokei/mcp-fetch` and `@mokei/mcp-sqlite`. Adding new packages is checked against the
repository guardrail in `AGENTS.md`; this design records that approval.

`laya-client` depends only on `ky` (catalogued, fetch-based) and `@sozai/schema`. It uses no
`node:*` builtins, so it runs on desktop, web and React Native today. The future ONNX backends
carry the `onnxruntime-*` native dependencies and are split per platform; they are out of scope for
this design and are enabled only by the seam.

## Types and schemas

The core mirrors Laya's three decision primitives. Questions are a discriminated union on `type`.

```ts
type ChoiceQuestion = { type: 'choice'; instructions: string; criteria: Record<string, string> }
type ScoreQuestion = { type: 'score'; instructions: string; criteria: Array<string> }
type NoulQuestion = { type: 'noul'; instructions: string }
type Question = ChoiceQuestion | ScoreQuestion | NoulQuestion
type QuestionMap = Record<string, Question>

type State = string | Record<string, unknown>

type ChoiceAnswer = { choice: string; confidence: number; distribution?: Record<string, number> }
type ScoreAnswer = { score: number; confidence: number; distribution?: Array<number> }
type NoulAnswer = { noul: number }
type RoutingInfo = { model: string; reason: string }
```

For a `choice` question the `criteria` map keys are labels and values are descriptions. For a
`score` question the `criteria` array lists ordinal rubric levels. A `noul` question is binary and
needs no criteria.

`predict` infers each answer's shape from its question `type` through a mapped type, so callers get
typed access such as `result.answers.department.choice`.

```ts
type AnswerFor<TQuestion> = TQuestion extends ChoiceQuestion
  ? ChoiceAnswer
  : TQuestion extends ScoreQuestion
    ? ScoreAnswer
    : NoulAnswer

type PredictResult<TQuestions extends QuestionMap> = {
  answers: { [K in keyof TQuestions]: AnswerFor<TQuestions[K]> }
  routing?: RoutingInfo
}
```

Runtime validation of sidecar responses uses `@sozai/schema` validators. Preset question sets are
provided as typed `QuestionMap` factories for full parity with Laya: `routerQuestions`,
`guardQuestions`, `moderationQuestions`, `triageQuestions`.

## Client and backend seam

Every parameter object, option object, and result shape on the public API is a named, exported
type. Consumers never have to re-declare an inline object shape. The naming rule: backend method
params are `LayaBackend*Params`, client method params are `Laya*Params`, factory options are
`*Options`, and shared results carry a descriptive name. Anonymous inline object types in a public
signature are not allowed.

```ts
type LayaResult = { answers: Record<string, unknown>; routing?: RoutingInfo }

type LayaBackendPredictParams = {
  state: State
  questions: QuestionMap
  model?: string
  signal?: AbortSignal
}
type LayaBackendRouteParams = { state: State; questions: QuestionMap; signal?: AbortSignal }
type LayaBackendBatchParams = {
  states: Array<State>
  questions: QuestionMap
  model?: string
  signal?: AbortSignal
}
type LayaBackendListModelsParams = { signal?: AbortSignal }

type LayaBackend = {
  predict: (params: LayaBackendPredictParams) => Promise<LayaResult>
  route?: (params: LayaBackendRouteParams) => Promise<RoutingInfo>
  batch?: (params: LayaBackendBatchParams) => Promise<Array<LayaResult>>
  listModels?: (params?: LayaBackendListModelsParams) => Promise<Array<string>>
  close?: () => Promise<void>
}
```

`LayaClient` is a thin typed wrapper. It validates backend responses, applies `defaultModel`, and
forwards `signal`. Every public method takes a single parameters object, per the stack convention.
The client params are generic over the question map so answers stay typed.

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
type LayaRouteParams = { state: State; questions: QuestionMap; signal?: AbortSignal }
type LayaListModelsParams = { signal?: AbortSignal }

class LayaClient {
  predict<TQuestions extends QuestionMap>(
    params: LayaPredictParams<TQuestions>,
  ): Promise<PredictResult<TQuestions>>

  predictBatch<TQuestions extends QuestionMap>(
    params: LayaPredictBatchParams<TQuestions>,
  ): Promise<Array<PredictResult<TQuestions>>>

  route(params: LayaRouteParams): Promise<RoutingInfo>

  listModels(params?: LayaListModelsParams): Promise<Array<string>>
}
```

`predictBatch` calls the backend's `batch` when present, otherwise issues sequential `predict`
requests. Two factory forms build the client, each with a named options type.

```ts
type LayaHTTPClientOptions = {
  url: string
  headers?: Record<string, string>
  fetch?: typeof fetch
  timeout?: number
  defaultModel?: string
}
type LayaBackendClientOptions = { backend: LayaBackend; defaultModel?: string }
type CreateLayaClientOptions = LayaHTTPClientOptions | LayaBackendClientOptions

createLayaClient(options: CreateLayaClientOptions): LayaClient
```

The `LayaHTTPClientOptions` form builds an `HttpLayaBackend`. The `LayaBackendClientOptions` form
accepts a custom or future ONNX backend. `HttpLayaBackend` also takes a named
`HttpLayaBackendParams` shaped like `LayaHTTPClientOptions` without `defaultModel`.

## HTTP wire contract

Mokei defines the contract because no Laya HTTP server exists upstream. All bodies are JSON.

```
POST /predict   { state, questions, model? }                    -> { answers, routing? }
POST /route     { state, questions }                            -> { model, reason }
GET  /models                                                    -> { models: Array<string> }
POST /batch     { items: Array<{ state }>, questions, model? }  -> { results: Array<{ answers, routing? }> }
```

`/route` returns a routing preview without running a forward pass, matching Laya's `router.route`.
`/batch` is optional; `HttpLayaBackend` advertises it and `LayaClient.predictBatch` falls back to
sequential `/predict` when it is absent.

`HttpLayaBackend` uses `ky`, posts JSON, validates each response against a `@sozai/schema`
validator, and maps HTTP status to a typed error.

A reference sidecar lives in `docs/reference/laya-sidecar.md`. It is a short FastAPI snippet that
wraps `laya.Router` and serves these endpoints. It is documentation only. It is not a package, is
not built, and is not released, so Python stays out of the toolchain.

## MCP server

`mcp-servers/laya` exposes classification to any MCP client. It reuses `laya-client` pointed at the
`LAYA_URL` environment variable and adds no inference logic.

Tools:

- `predict` -- `{ state, questions }` returning answers. The general surface.
- `route`, `guard`, `moderate`, `triage` -- preset question sets, each taking `{ state }` and
  returning answers.

Tools are built with `createTool` and `@sozai/schema` schemas. The server ships a `manifest.json`
and is registered in `mcp-servers/config.json`, matching `@mokei/mcp-fetch` and `@mokei/mcp-sqlite`.

## Agent-loop intent routing

Intent routing is a helper, not a change to `ModelProvider` or `Session`. This keeps the agent loop
uncoupled and composable.

```ts
type IntentRoute = { label: string; confidence: number; routing?: RoutingInfo }
type RouteIntentParams = {
  client: LayaClient
  state: State
  question: ChoiceQuestion
  signal?: AbortSignal
}

routeIntent(params: RouteIntentParams): Promise<IntentRoute>
```

`routeIntent` wraps `predict` with a single `choice` question and returns the top label plus
calibrated confidence. Session integration is a documented pattern: call `routeIntent` before
`streamChat`, then branch on `label` and `confidence` to select tools or a model, or to escalate
when confidence is low. Confidence gating follows Laya's calibration design.

## Errors

- `LayaError` -- base class.
- `LayaConnectionError` -- sidecar unreachable or network failure.
- `LayaResponseError` -- malformed or schema-invalid response; wraps `@sozai/schema` issues.
- `LayaModelError` -- unknown or unavailable model.

Abort and timeout are surfaced through `signal` and `ky`.

## Testing

- Unit tests use an in-memory `LayaBackend` mock to cover `LayaClient` typing, validation, and
  `predictBatch` fallback.
- `HttpLayaBackend` wire behaviour is tested with a mocked `fetch`.
- Type tests under `tsconfig.test.json` assert `PredictResult<TQuestions>` inference across the
  three primitives.
- Integration tests are gated behind the `LAYA_URL` environment variable and skip when it is unset,
  matching the repository's integration-tests pattern.

## Out of scope

- ONNX export of Laya checkpoints and custom heads. Tracked upstream via issue #7 and any ONNX work.
- In-process ONNX inference and the `onnxruntime-*` platform backends. The seam is defined; the
  backends are a follow-up once exports exist.
- A shipped or lifecycle-managed sidecar process. The contract and a reference snippet are provided;
  the user runs the sidecar.

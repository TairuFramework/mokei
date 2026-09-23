# Local Laya backend for System One

Date: 2026-09-23
Status: superseded
Branch: `feat/laya-backend`

## Goal

Give `@mokei/system-one-client` a supported local backend running the Laya checkpoints, with
integration tests against a real server, as the follow-up to the System One classification work
(`docs/agents/plans/completed/2026-09-22-system-one-classification.complete.md`).

## Why superseded

The original plan added `@mokei/laya-backend`, a `SystemOneBackend` that spawned `laya daemon`
(laya.cpp) and spoke its line-delimited JSON protocol over stdio. It was built, then dropped before
release: laya PR #31 merged `laya-serve`, a Python FastAPI server that speaks the System One HTTP
API directly and runs on CUDA, Apple Silicon (MPS) and CPU. With an HTTP server available, the
existing `HTTPSystemOneBackend` covers local and hosted use alike, and a process-wrapping package
added maintenance for no capability. The package was deleted along with its lockstep entry.

## What was built

- **laya-serve is the canonical local backend.** It was evaluated on macOS (MPS): about 2 s for the
  first request, about 50 ms warm. `docs/reference/system-one-sidecar.md` documents the install
  with `uv`, the `LAYA_*` environment variables, and model routing: `model` is honoured only for
  `english`, `multilingual` or `typed-decisions`; any other value auto-routes. The top-level
  `routing` field it adds lands in `result.extras`.
- **The client is limited to the published System One API.** `predict` (`POST /v1/systemone`) is
  the only operation. `predictBatch`, the backend `batch` option, `listModels` and model metadata
  were removed because the TypeSafe API has no batch or model-listing endpoint.
  `SystemOneBackend` is `{ predict, close? }`.
- **The question schemas follow the published API.** `instructions` is required on every question
  and may be a string, object or array. Choice criteria take 1 to 255 options, each a description
  or `null`. Score criteria take 2 to 10 levels. Noul criteria are an optional `{ true, false }`.
  Answers accept Laya's optional `action.act_probability` and a noul `confidence`.
- **HTTP errors map to typed classes:**

  | Status | Error |
  |---|---|
  | 401, 403 | `SystemOneAuthError` |
  | 404 | `SystemOneModelError` |
  | 422 | `SystemOneInputError`, with `issues` parsed from FastAPI `detail` and other common body shapes |
  | 429 | `SystemOneRateLimitError` |
  | 529 | `SystemOneOverloadedError` |
  | anything else | `SystemOneConnectionError` |

  The rate-limit and overloaded errors extend `SystemOneConnectionError` and carry `retryAfterMs`
  from `Retry-After`. Connection errors raised from a response carry `status`. The body reason is
  appended to the message, cut to 300 characters.
- **Integration suite.** `integration-tests/suites/laya.test.ts` is gated on
  `MOKEI_LAYA_SERVE_BIN`. It spawns laya-serve on a free port (`get-port`) and fails fast with the
  server's stderr if the server exits early. It warms the model up in `beforeAll` and covers:
  - predict and routing extras
  - structured instructions and criteria
  - the auth error
  - a server-side 422
- **The MCP server manifest now starts `lib/serve.js`.** The MCP server is documented against
  laya-serve with `SYSTEM_ONE_MODEL=english`; the preset tools need a model.

## Key design decisions

- **Match the published contract, not one runtime.** Anything laya-serve accepts beyond the
  TypeSafe API stays out of the client. The laya-specific extras (`routing`, `action`) are
  tolerated, not relied on.
- **Server validation failures and client validation failures use one error class:**
  `SystemOneInputError`.
- **The retryable statuses get their own classes.** Callers can back off on 429 and 529 without
  inspecting ky's `HTTPError`, and a catch on `SystemOneConnectionError` still sees them.
- **No new packages.** Everything lives in `@mokei/system-one-client`, the MCP server and the
  integration tests.

## Follow-on

- `docs/agents/plans/backlog/2026-09-22-laya-in-process-ggml-backend.md` covers an in-process
  runtime behind the same `SystemOneBackend` interface.
- `docs/agents/plans/backlog/2026-09-23-system-one-answer-field-tolerance.md` covers relaxing the
  strict per-answer schemas.

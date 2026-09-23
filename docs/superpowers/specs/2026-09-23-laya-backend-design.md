# Laya daemon backend design

> **Superseded 2026-09-23.** `@mokei/laya-backend` was dropped before release. `laya-serve` (the
> Python HTTP server from https://github.com/NandhaKishorM/laya) is the canonical local backend; see
> `docs/reference/system-one-sidecar.md`.

Date: 2026-09-23
Branch: `feat/laya-backend`
Status: approved design, pending plan

## Goal

Run Laya models locally from mokei without a separately managed `laya serve` process, by adding a
`SystemOneBackend` that drives the `laya daemon` stdio mode of the `laya.cpp` binary. Add
integration tests that exercise every `laya.cpp` path mokei supports, against the real binary and a
real GGUF, gated so they skip when either is missing.

Success means:

- `createSystemOneClient({ backend: new LayaDaemonBackend({ model }) })` predicts against a real
  Laya GGUF with no HTTP server and no port.
- The integration suite passes locally with `MOKEI_LAYA_GGUF` set and skips cleanly without it.
- `@mokei/system-one-client` stays platform-neutral (no `node:*` imports, no new dependencies).

## Context

`@mokei/system-one-client` defines the `SystemOneBackend` seam and ships `HTTPSystemOneBackend`,
which reaches `laya serve` or the hosted TypeSafe API. `laya.cpp` (from
[ggmlc `examples/laya`](https://github.com/monatis/ggmlc/tree/main/examples/laya)) is a single
executable: there is no library target, C API, or Node/WASM binding. It exposes `decide`
(one-shot), `serve` (HTTP) and `daemon` (stdio).

This is a separate-process backend, not the true in-process binding the backlog item describes.
That binding (N-API or WASM) stays in the backlog.

### `laya daemon` protocol (from `examples/laya/src/main.cpp`)

- Launch: `laya daemon [<model.gguf>] [--models-dir <DIR>] [--family <NAME>] [--device <NAME>]
  [--threads <N>] [--cuda-graph]`. Load failures print to stderr and exit 1.
- On ready, prints one line: `{"status":"ready","model":"laya"}`.
- Then reads one JSON object per stdin line and writes one JSON object per stdout line. Requests are
  processed serially, so responses come back in request order.
- Request: `{"id": <any JSON>, "state": <object|string>, "questions": {...}}`. A `preset`/`text`
  form also exists; the backend does not use it. A `model` field is ignored: the router picks the
  family from the loaded GGUF(s).
- Success response: the same object `POST /v1/systemone` returns (`model`, `family`, `route`,
  `answers`, `usage: { input_tokens, output_tokens, latency_ms }`) plus the echoed `id`.
- Error responses: an unparseable line yields `{"error": "..."}` with **no** `id`; empty questions
  yield `{"id": ..., "error": "missing questions"}`.
- An exception inside `router.decide` is not caught in daemon mode: the process terminates.
- There is no batch or model-listing request.

### Client answer schemas

Real `laya.cpp` answers (`answer_to_json` in `examples/laya/src/questions.cpp`) carry
`action: { act_probability }` on every answer and `confidence` on noul answers. The client's answer
schemas are closed (`additionalProperties: false`), so `validateResult` rejects every real
`laya serve` or daemon response today. The client schemas gain both as optional fields, staying
closed to anything else.

## Package

New package `packages/laya-backend`, published as `@mokei/laya-backend`, joining the
`versioning.fixed` lockstep in `pnpm-workspace.yaml`. Laya-named because it is `laya.cpp`-specific,
per the System One naming rule. Keywords include `laya`, `system-one`, `gguf`.

- Dependencies: `@mokei/system-one-client` (`workspace:^`) for `SystemOneBackend`, its param and
  result types, and the error classes; `nano-spawn` (`catalog:`), matching `@mokei/host-node`.
- No `node:child_process` import. Type-only `node:*` imports are acceptable, as in host-node.

Files:

- `src/backend.ts` — `LayaDaemonBackend` and `LayaDaemonBackendParams`.
- `src/protocol.ts` — response-line parsing, request/response correlation, daemon error mapping.
- `src/index.ts` — public exports.

## `LayaDaemonBackend`

```ts
type LayaDaemonBackendParams = {
  model?: string          // path to a Laya GGUF
  modelsDir?: string      // directory of Laya GGUFs (the daemon routes english/multilingual)
  binary?: string         // default 'laya', resolved on PATH
  family?: string         // --family
  device?: string         // --device
  threads?: number        // --threads
  startupTimeoutMs?: number
}

class LayaDaemonBackend implements SystemOneBackend {
  predict(params: SystemOneBackendPredictParams): Promise<SystemOneResult>
  listModels(params?: SystemOneBackendListModelsParams): Promise<Array<SystemOneModel>>
  close(): Promise<void>
}
```

The constructor throws `SystemOneError` when neither `model` nor `modelsDir` is set. It does not
start the process.

### Lifecycle

- **Lazy start.** The first `predict` spawns
  `spawn(binary, ['daemon', ...modelArgs, ...flags], { stdio: ['pipe', 'pipe', 'pipe'] })` via
  nano-spawn. Concurrent first calls share one start promise.
- The subprocess promise gets a `.catch(() => {})` guard, as in host-node's `spawnContextServer`,
  so a spawn failure or abnormal exit is never an unhandled rejection.
- Startup reads `subprocess.stdout` lines (nano-spawn splits lines) until `{"status":"ready"}`.
  If the process exits first, or `startupTimeoutMs` elapses, the start rejects with
  `SystemOneConnectionError` whose message includes the stderr tail (from the `SubprocessError`,
  or from a stderr buffer on timeout). A failed start leaves the backend able to retry on the next
  call.
- **Crash.** When the subprocess settles while running, every pending call rejects with
  `SystemOneConnectionError` (exit code or signal, plus stderr tail). The next `predict` starts a
  fresh process.
- **`close()`.** Ends stdin, waits for the subprocess to settle, and sends `SIGTERM` after a grace
  period if it has not. A `SIGTERM`/`SIGINT` exit counts as clean (as in host-node's
  `isSubprocessExit`). The daemon drains stdin before exiting, so calls already written are normally
  answered; any still unanswered at exit reject with `SystemOneConnectionError`. `close()` on a backend
  that never started resolves immediately. A `predict` after `close()` starts a new process.

### Requests and responses

- Each `predict` assigns an incrementing string `id`, writes
  `JSON.stringify({ id, state, questions }) + '\n'` to stdin (via `await subprocess.nodeChildProcess`),
  and waits for the response with that `id`.
- `model` from the params is not forwarded: the daemon ignores it. The client still requires one,
  so callers set `defaultModel` (any string, for example `'laya'`).
- The resolved value is the response object without `id`. The client's `validateResult` validates
  it and maps extra top-level keys (`family`, `route`) into `extras`; `usage.latency_ms` is ignored
  as on the HTTP path.
- A response with an `id` routes to that pending call. An error response with no `id` routes to the
  oldest pending call, which is correct because the daemon answers in order.
- A response carrying `error` rejects its call with `SystemOneResponseError(error)`.
- A stdout line that is not JSON rejects the oldest pending call with `SystemOneResponseError`.

### Abort

A call whose `signal` aborts rejects at once with the signal's reason. Its `id` stays registered as
discarded, so the late response is consumed and dropped rather than misrouted. The inference itself
cannot be cancelled.

### `listModels`

Returns one entry naming the loaded model (the GGUF basename, or the models directory), with no
release date. The daemon has no model-listing request.

### Batch

No `batch` method. The client's bounded-concurrency fallback pipelines `predict` calls over the one
process, which the daemon serves in order.

## Testing

### Unit tests (`packages/laya-backend/test`)

A fake daemon, `test/fixtures/fake-laya.mjs`, is an executable Node script passed as `binary`. It
prints the ready line, then answers each request with a valid result that echoes `id`. Environment
flags switch it into failure modes: error response, error without `id`, non-JSON line, crash on
request, never ready, exit before ready with stderr text, and delayed responses.

Cases:

- `predict` returns the result without `id`; the process starts once for concurrent first calls.
- Two in-flight calls each receive their own response.
- A daemon `error` response rejects with `SystemOneResponseError`; an `id`-less error rejects the
  oldest pending call.
- An aborted call rejects immediately, and the next call still receives its own response.
- A crash rejects pending calls with `SystemOneConnectionError`, and the next call restarts.
- Exit before ready rejects with `SystemOneConnectionError` including the stderr text.
- The startup timeout rejects with `SystemOneConnectionError`.
- `close()` stops the process; `close()` before start resolves; `predict` after `close()` restarts.
- The constructor rejects missing `model`/`modelsDir`.
- `createSystemOneClient({ backend })` end to end, including `predictBatch`.

### Integration tests (`integration-tests/suites/laya.test.ts`)

Gated on `MOKEI_LAYA_GGUF` (path to a Laya GGUF) and on the binary resolving from `MOKEI_LAYA_BIN`
(default `laya` on `PATH`). Without either, both blocks skip, like `llama-provider.test.ts`.

- `LayaDaemonBackend (real GGUF)`:
  - `predict` with `choice`, `score` and `noul` questions.
  - `predictBatch` over several states.
  - `listModels` returns the loaded model.
  - `close()`, then a fresh `predict` succeeds.
- `HTTPSystemOneBackend against laya serve`:
  - `beforeAll` spawns `laya serve <gguf> --port <free port>` via nano-spawn and polls `/health`
    until it answers; `afterAll` stops it.
  - `predict`, `predictBatch` with `batch: true` (hits `/v1/decide/batch`), and `listModels`.

Assertions stay structural, because model outputs vary: the client's schema validation passes, each
`choice` is one of the question's criteria keys, choice probabilities sum to about 1, `noul` lies in
[0, 1]. No assertions on which answer the model picks.

`integration-tests/package.json` gains `@mokei/laya-backend`, `@mokei/system-one-client` and
`nano-spawn`.

## Documentation

- `integration-tests/README.md`: a requirements row for the `laya` suite (`MOKEI_LAYA_GGUF`,
  optional `MOKEI_LAYA_BIN`), with the GGUF download source (`huggingface.co/mys/laya-GGUF`).
- `docs/reference/system-one-sidecar.md`: a "Daemon backend (laya.cpp)" section with usage.
- `docs/agents/plans/backlog/2026-09-22-laya-in-process-ggml-backend.md`: narrowed to the true
  in-process (N-API / WASM) binding, noting that the daemon backend now covers the no-sidecar case.
- `docs/agents/architecture.md`: the new package.

## Not in scope

- The `preset`/`text` daemon request form, and preset listing.
- An in-process N-API or WASM binding.
- Wiring the daemon backend into `@mokei/mcp-system-one`.
- Downloading or compiling GGUF files.
- Semantic assertions on model decisions.

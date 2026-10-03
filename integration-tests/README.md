# Integration tests

End-to-end suites that drive real processes: MCP servers over stdio and Streamable HTTP,
the official SDK v2 as an interop peer, the `mokei chat` TUI over a PTY, and the model
providers against a local inference server.

The root `pnpm test` runs these after the package suites, via `pnpm test:integration`. To run
them alone, from this directory:

```sh
pnpm test                    # every suite the environment supports
pnpm exec vitest run suites/interop-sdk-client.test.ts
```

Suites whose requirements are missing **skip** rather than fail, so a partial environment
still gives a meaningful result. That is what makes them safe to run in CI: no runner has a
chat backend or a GGUF file, so the model-facing suites skip themselves and the rest — the
protocol, transport and CLI suites — still gate the merge. Keep new suites on that footing:
gate anything needing a backend on `hasChatBackend` (`support/requirements.ts`), never on an
assumption that the environment has one.

## Requirements

| Suites | Needs |
|---|---|
| `interop-sdk-*`, `interop-2026-07-28-stdio`, `interop-2026-07-28-http`, `version-detection-stdio`, `version-detection-http`, `http-transport`, `built-entries` | nothing beyond a build |
| `session`, `agent`, `host`, `cli-chat*` | a chat backend (below) |
| `cli-*` | the CLI built (`pnpm build` — the dev binary loads from `lib/`) and a working PTY |
| `llama-provider`, `cli-chat-llama` | `MOKEI_LLAMA_GGUF` |
| `system-one`, `system-one-decision-flow`, `system-one-decision-flow-server` | `MOKEI_LAYA_SERVE_BIN` and/or a llama.cpp decision server (`MOKEI_LLAMA_DECISION_*`) |

The `test:types` script also typechecks the published declarations as a consumer
(`dts-consumer/`), with `skipLibCheck: false`. Build the packages first.

## Chat backend

The model-facing suites resolve one backend, in `support/requirements.ts`. Both serve
OpenAI- (`/v1/chat/completions`) and Anthropic-compatible (`/v1/messages`) endpoints, so
the `session` suite exercises both providers either way.

Resolution order: `LLAMA_SERVER_URL` → `OLLAMA_HOST` → a llama-server on the default port
→ ollama. An explicitly configured backend is used as-is, reachable or not, so a typo or a
server that failed to start surfaces instead of silently falling through to the other one.

- **llama.cpp — the default.** Probed at `LLAMA_SERVER_URL`, or `http://127.0.0.1:8080`
  when unset. Suites reach it through `OpenAIProvider` / `AnthropicProvider`, the CLI
  through `--provider openai --api-url`:

  ```sh
  llama-server -hf LiquidAI/LFM2.5-1.2B-Thinking-GGUF --jinja
  pnpm test    # or: LLAMA_SERVER_URL=http://127.0.0.1:8100 pnpm test
  ```

  **`--jinja` is required.** Without it llama.cpp parses no tool calls, and every suite
  asserting one fails while the rest pass — an easy failure to misread as a mokei bug.

  The model is whichever `/v1/models` advertises, preferring an LFM2.5 entry when the
  server hosts several (`llama serve` routes to many), falling back to the first listed and
  then to `LiquidAI/LFM2.5-1.2B-Thinking-GGUF`.

  Two more gotchas. Use `127.0.0.1`, not `localhost`, if anything else holds `*:8080` — the
  wildcard bind wins the IPv6 lookup and the suites then probe the wrong server and skip.
  And llama.cpp does not split reasoning out of the answer for every template: with
  LFM2.5 it streams `<think>` tags inline in `content` whatever `--reasoning-format` says,
  so the CLI shows `streaming` rather than `thinking…`.

- **ollama — the alternative.** Used when `OLLAMA_HOST` is set, or when no llama-server
  answers on the default port. Adds its own native API on top of the two compatibility
  endpoints, so the `session` suite runs three providers against it. Model:
  `lfm2.5:latest`.

### Flaky tool calls

The assertions that depend on the model *choosing* to call the tool retry twice
(`TOOL_CALL_RETRY`), and the prompt names the tool outright. A 1.2B model still answers
from memory now and then; retrying keeps the tool path under test where loosening the
assertion would stop testing it. Applied per-test, not in the vitest config, so a
deterministic suite cannot quietly become flaky.

`MOKEI_LLAMA_GGUF` is separate: it points at a local GGUF **file** for `@mokei/llama-provider`,
which runs inference in-process via node-llama-cpp rather than over HTTP.

The `system-one*` suites run against every System One server the environment provides, one
`describe.each` entry per server, so each backend gets the same tests. They run in their own Vitest
project (`system-one`), whose global setup starts the servers (or connects to running ones) and
shares them. `system-one` drives them through `HTTPSystemOneBackend`; `system-one-decision-flow*`
runs decision flows against them. With no server configured the per-server suites have no entries
and only the static graph-checking tests run. Targeted runs of other suites, or
`vitest run --project default`, never start a server.

- **laya-serve** -- `MOKEI_LAYA_SERVE_BIN` points at the executable. The setup starts it on a free
  port with only the english checkpoint. Install it with
  `uv venv --python 3.12 && uv pip install "laya[serve]"`; it runs on CPU, CUDA and Apple Silicon
  (MPS). The first start downloads the checkpoint from Hugging Face, so allow a few minutes.
- **llama.cpp decision model** -- the `/v1/systemone` endpoint of `llama-server` loaded with a
  decision GGUF (for example `ggml-org/Clef-GGUF`). Either point `MOKEI_LLAMA_DECISION_URL` at a
  running server, or set `MOKEI_LLAMA_DECISION_BIN` (the `llama-server` executable) and
  `MOKEI_LLAMA_DECISION_MODEL` (a GGUF path, or a Hugging Face repo passed to `-hf`) and the setup
  starts it on a free port with an API key. Only a server the setup started, or one given
  `MOKEI_LLAMA_DECISION_API_KEY`, is assumed to enforce auth; the wrong-API-key tests skip otherwise.

## Environment variables

The server URLs are deliberately unprefixed: `OLLAMA_HOST` is ollama's own variable, and
`LLAMA_SERVER_URL` matches it in shape, so a machine already configured for either tool
needs no mokei-specific setup. `MOKEI_*` is reserved for things only mokei defines.

| Variable | Effect |
|---|---|
| `LLAMA_SERVER_URL` | llama.cpp `llama-server` URL (scheme optional). Unset, the default `http://127.0.0.1:8080` is probed |
| `OLLAMA_HOST` | Ollama base URL (scheme optional). Set it to use ollama instead; unset, ollama is the fallback at `http://127.0.0.1:11434` |
| `MOKEI_LLAMA_GGUF` | Local GGUF path enabling the in-process llama-provider suites |
| `MOKEI_LAYA_SERVE_BIN` | `laya-serve` executable adding laya to the `system-one*` suites |
| `MOKEI_LLAMA_DECISION_URL` | URL of a running llama.cpp decision server, adding it to the `system-one*` suites |
| `MOKEI_LLAMA_DECISION_BIN` / `MOKEI_LLAMA_DECISION_MODEL` | `llama-server` executable and decision model (GGUF path or `-hf` repo) the setup starts instead of a URL |
| `MOKEI_LLAMA_DECISION_API_KEY` | API key for `MOKEI_LLAMA_DECISION_URL`, if the server enforces one |
| `MOKEI_LLAMA_DECISION_REQUEST_MODEL` | Value sent as the request `model`; unset, it is omitted |

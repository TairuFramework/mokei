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
| `interop-sdk-*`, `interop-2026-07-28-stdio`, `version-detection-stdio`, `http-transport` | nothing beyond a build |
| `session`, `agent`, `host`, `cli-chat*` | a chat backend (below) |
| `cli-*` | the CLI `dist` built (`pnpm build` — the dev binary loads from `dist/`) and a working PTY |
| `llama-provider`, `cli-chat-llama` | `MOKEI_LLAMA_GGUF` |

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

## Environment variables

The server URLs are deliberately unprefixed: `OLLAMA_HOST` is ollama's own variable, and
`LLAMA_SERVER_URL` matches it in shape, so a machine already configured for either tool
needs no mokei-specific setup. `MOKEI_*` is reserved for things only mokei defines.

| Variable | Effect |
|---|---|
| `LLAMA_SERVER_URL` | llama.cpp `llama-server` URL (scheme optional). Unset, the default `http://127.0.0.1:8080` is probed |
| `OLLAMA_HOST` | Ollama base URL (scheme optional). Set it to use ollama instead; unset, ollama is the fallback at `http://127.0.0.1:11434` |
| `MOKEI_LLAMA_GGUF` | Local GGUF path enabling the in-process llama-provider suites |

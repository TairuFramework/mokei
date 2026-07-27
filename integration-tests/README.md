# Integration tests

End-to-end suites that drive real processes: MCP servers over stdio and Streamable HTTP,
the official SDK v2 as an interop peer, the `mokei chat` TUI over a PTY, and the model
providers against a local inference server. Not part of the root `pnpm test` — run them
from this directory:

```sh
pnpm test                    # every suite the environment supports
pnpm exec vitest run suites/interop-sdk-client.test.ts
```

Suites whose requirements are missing **skip** rather than fail, so a partial environment
still gives a meaningful result.

## Requirements

| Suites | Needs |
|---|---|
| `interop-sdk-*`, `http-transport`, `lifecycle`, `local-tools` | nothing beyond a build |
| `session`, `agent`, `host`, `cli-chat*` | a chat backend (below) |
| `cli-*` | the CLI `dist` built (`pnpm build` — the dev binary loads from `dist/`) and a working PTY |
| `llama-provider`, `cli-chat-llama` | `MOKEI_LLAMA_GGUF` |

## Chat backend

The model-facing suites resolve one backend, in `support/requirements.ts`:

- **llama.cpp** — set `LLAMA_SERVER_URL` to a running `llama-server`. Takes
  precedence when set. It serves an OpenAI-compatible API only, so the suites reach it
  through `OpenAIProvider` and the CLI through `--provider openai --api-url`. The model is
  whatever `/v1/models` advertises, defaulting to `LiquidAI/LFM2.5-1.2B-Thinking-GGUF`:

  ```sh
  llama-server -hf LiquidAI/LFM2.5-1.2B-Thinking-GGUF --jinja
  LLAMA_SERVER_URL=http://localhost:8080 pnpm test
  ```

  Two gotchas. Use `127.0.0.1`, not `localhost`, if anything else holds `*:8080` — the
  wildcard bind wins the IPv6 lookup and the suites then probe the wrong server and skip.
  And llama.cpp does not split reasoning out of the answer for every template: with
  LFM2.5 it streams `<think>` tags inline in `content` whatever `--reasoning-format` says,
  so the CLI shows `streaming` rather than `thinking…`.

- **ollama** — the default, probed at `OLLAMA_HOST` (`http://localhost:11434`). It also
  serves OpenAI- and Anthropic-compatible endpoints, so the `session` suite exercises all
  three providers against it. Model: `lfm2.5:latest`.

`MOKEI_LLAMA_GGUF` is separate: it points at a local GGUF **file** for `@mokei/llama-provider`,
which runs inference in-process via node-llama-cpp rather than over HTTP.

## Environment variables

The server URLs are deliberately unprefixed: `OLLAMA_HOST` is ollama's own variable, and
`LLAMA_SERVER_URL` matches it in shape, so a machine already configured for either tool
needs no mokei-specific setup. `MOKEI_*` is reserved for things only mokei defines.

| Variable | Effect |
|---|---|
| `LLAMA_SERVER_URL` | Use a llama.cpp `llama-server` as the chat backend |
| `OLLAMA_HOST` | Ollama base URL (scheme optional), default `http://localhost:11434` |
| `MOKEI_LLAMA_GGUF` | Local GGUF path enabling the in-process llama-provider suites |

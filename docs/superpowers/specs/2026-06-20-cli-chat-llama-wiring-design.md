# CLI `chat --provider llama` wiring + llama integration tests

**Date:** 2026-06-20
**Status:** design approved
**Closes backlog:**
- `docs/agents/plans/backlog/2026-06-08-cli-chat-llama-wiring.md` (CLI wiring)
- `docs/agents/plans/backlog/2026-02-03-llama-provider-follow-ups.md` (provider integration tests)

## Problem

`@mokei/llama-provider` (local GGUF via node-llama-cpp) ships as a library, but
the CLI `mokei chat` only exposes `ollama` / `openai` / `anthropic`. The local-model
path is unreachable from the CLI. Separately, the llama provider has no integration
tests against a real GGUF (unit tests mock node-llama-cpp).

Llama differs structurally from the other providers: it is constructed from a
registry of **local GGUF file paths** rather than a URL + API key, and its
`listModels()` returns only the pre-configured registry. So a model path must be
supplied before a session can be built or the interactive model picker can show
anything.

## Decisions

| Question | Decision |
|----------|----------|
| Model path source | Reuse `-m` flag as the GGUF path; interactive path-input card when omitted. |
| Model params | Path-only MVP. `gpu` / `contextSize` use node-llama-cpp defaults. |
| Test placement | Real-GGUF tests live in `integration-tests/`, not unit suites, not run in CI. |
| GGUF source / gating | Env var `MOKEI_LLAMA_GGUF`; integration tests skip when unset (`describe.skipIf`). No binary in git, no download. |
| Coverage | Both provider-level integration test and CLI e2e via `ChatDriver`. |

## Architecture

### Components changed / added (`packages/cli/src`)

- **`options.ts`** — `-p` help text adds `llama`; `-m` help notes "or GGUF path
  for llama". No new flag.
- **`chat/providers.ts`**
  - `PROVIDERS` += `'llama'`. `API_KEY_ENV` unchanged (llama is keyless, like ollama).
  - New `llama` branch in `buildChat`:
    1. Treat `opts.model` as the GGUF path.
    2. Throw a clear error if the path is missing.
    3. Derive a registry name from the path basename (strip `.gguf`).
    4. `new LlamaProvider({ models: { [name]: { path } } })`.
    5. `new Session<LlamaTypes>({ contextHost: host, providers: { llama: p } })`.
    6. Build ChatApp element with `initialModel = name` (the registry name, NOT the path).
  - `build()` helper gains an optional `initialModel` override, because llama's
    `initialModel` (registry name) differs from `opts.model` (the path).
- **`chat/components/ProviderSelectCard.tsx`** — add `{ label: 'llama', value: 'llama' }`.
- **`chat/components/LlamaPathCard.tsx`** (new) — TextInput card prompting for the
  GGUF path. Props mirror existing cards: `onSubmit(path)`, `onCancel()`.
- **`chat/ChatLauncher.tsx`** — add a `modelPath` state and an intermediate step
  for llama (see Flow below).

### Dependencies

- Add `@mokei/llama-provider` to `packages/cli/package.json`.
- Add `@mokei/llama-provider` to `integration-tests/package.json`.

## Launcher flow

ChatLauncher gains a `modelPath` state:

```
provider == null ───────────────► ProviderSelectCard ──select──► set provider
                                                                      │
provider set ─────────────────────────────────────────────────────► │
   ├─ provider != 'llama' ─────────────────────────► buildChat(provider, opts)
   └─ provider == 'llama'
        ├─ path known (opts.model ?? modelPath) ───► buildChat('llama', {…opts, model: path})
        └─ path unknown ──► LlamaPathCard ──submit──► setModelPath ──► (re-render → path known)
```

- **Path precedence:** `-m` flag wins; otherwise the interactive card value.
- **buildChat signature unchanged:** the path is passed via the `model` field.
  The llama branch maps path → registry and sets `initialModel` to the derived name.
- **Cancel (esc) on the path card** → `exit()`, matching ProviderSelectCard cancel.
- **Connecting spinner** unchanged (`connecting to llama…`).

## Data flow notes

- For URL providers, `-m` is a model name validated against `listModels()`.
- For llama, `-m` is a filesystem path. The provider is built with exactly one
  model registered from that path; `listModels()` returns that single entry, so
  the existing model picker / `/model` command continue to work unchanged.

## Tests

### Unit / component (`packages/cli/test`, run in CI, mock LlamaProvider)

- **ProviderSelectCard** — asserts `llama` option present.
- **`providers.test.ts`**
  - `buildChat('llama', { model: '/x/foo.gguf' })` builds a session; registry name
    is `foo`; `initialModel` is `foo` (not the path).
  - `buildChat('llama', {})` (no path) throws a clear error.
  - llama requires no API key (no env-var error path).
- **`LlamaPathCard`** (new test) — renders prompt; submit fires `onSubmit(path)`;
  esc fires `onCancel`.
- **ChatLauncher** — `provider='llama'` + no model renders the path card; after
  submit proceeds to `buildChat` (mocked).

### Integration (`integration-tests/suites`, NOT in CI, gated on `MOKEI_LLAMA_GGUF`)

Use `describe.skipIf(!process.env.MOKEI_LLAMA_GGUF)` so the suite no-ops when the
env var is unset.

- **`llama-provider.test.ts`** (provider-level — closes backlog #1): real GGUF →
  - `listModels()` returns the registered model.
  - `streamChat` yields streaming deltas.
  - function / tool calling produces a tool call.
  - assert the `promptWithMeta` return shape.
- **`cli-chat-llama.test.ts`** (CLI e2e via `ChatDriver`):
  - Extend `ChatDriver`: accept `provider: 'llama'`; add a `UI.llamaPath` marker
    and a helper to type the path into the card. (The driver already passes
    `--model`, so the flag path works as-is.)
  - **Test A** — `-p llama -m $MOKEI_LLAMA_GGUF` → ready prompt → submit → streams
    to idle + assistant marker.
  - **Test B** — interactive: `provider: null` → select llama → path card → type
    the GGUF path → ready prompt.

## Error handling

- Missing path (flag absent + non-interactive context) → thrown error surfaced by
  ChatLauncher's existing error path (red text, exit code 1).
- Bad / nonexistent GGUF → LlamaProvider load error → same error surface.

## Build / dev notes

- The dev binary (`bin/dev.js`) and integration tests load the CLI `dist/`, not
  `src/`. Rebuild the cli `dist` after src edits before running integration tests.

## Out of scope

- `gpu` / `contextSize` flags or interactive params (defaults only for MVP).
- Config-file model registry (no config-file mechanism exists in the CLI today).
- Bundling or auto-downloading a GGUF for tests.

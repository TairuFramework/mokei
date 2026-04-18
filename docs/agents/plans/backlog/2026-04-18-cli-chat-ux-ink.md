# CLI Chat UX — Research on term.ink (Ink ecosystem)

**Status:** research / backlog
**Origin:** exploratory — evaluate `term.ink` as a path to improve the `mokei chat …` experience.

## What is term.ink?

`term.ink` is the shortlink for the Ink ecosystem by Vadim Demedes. The domain
redirects to three related projects:

| URL | Project | Purpose |
|-----|---------|---------|
| `term.ink`     | [`vadimdemedes/ink`](https://github.com/vadimdemedes/ink)       | React renderer for interactive CLIs |
| `term.ink/ui`  | [`vadimdemedes/ink-ui`](https://github.com/vadimdemedes/ink-ui) | Prebuilt components (inputs, select, spinner, …) |
| `term.ink/pastel` | [`vadimdemedes/pastel`](https://github.com/vadimdemedes/pastel) | Next.js-style CLI framework built on Ink |

All three are TypeScript-first and used in production by Shopify, Cloudflare,
GitHub Copilot, Gatsby, Prisma, and the Claude Code CLI itself.

### Ink (core)

- React reconciler that renders to stdout instead of the DOM.
- Uses Yoga (Flexbox) for layout — `flexDirection`, `padding`, `margin`,
  `alignItems`, etc.
- Primitives: `<Box>`, `<Text>`, `<Static>`, `<Newline>`, `<Spacer>`,
  `<Transform>`.
- Hooks: `useInput`, `useApp`, `useFocus`, `useFocusManager`, `useStdin`,
  `useStdout`, `useStderr`.
- `<Static>` is designed for append-only transcripts — it paints lines once
  above the active render region, which is exactly the pattern for a
  streaming chat transcript.

### Ink UI (components)

Relevant for chat UX:

- `TextInput`, `PasswordInput`, `EmailInput` — single-line inputs with
  autocomplete hooks.
- `ConfirmInput` — Y/n prompt (tool-call approval).
- `Select`, `MultiSelect` — scrollable lists (model / context / tool
  selection).
- `Spinner`, `ProgressBar` — streaming / tool-call progress.
- `Alert`, `StatusMessage`, `Badge` — typed result banners.
- `UnorderedList`, `OrderedList` — structured output.
- `ThemeProvider` + `extendTheme` — centralised styling.

### Pastel (framework)

- File-based routing under a `commands/` folder (`commands/chat/openai.tsx`
  → `mokei chat openai`).
- Zod schemas for flags/args with automatic type inference and `--help`
  generation.
- Uses Commander under the hood — comparable to the oclif role today.

## Where mokei stands today

`packages/cli` currently stacks:

- `@oclif/core` for command routing (`packages/cli/src/commands/chat/*.ts`).
- `enquirer` for prompts (`packages/cli/src/prompt.ts`).
- `ora` for spinners + `ansi-colors` for styling.
- Direct `process.stdout` writes for streaming assistant tokens
  (`packages/cli/src/chat-session.ts:70`, `:223`).

The chat loop (`ChatSession.run`, `chat-session.ts:301`) is a sequential
state machine driven by `prompt`/`confirm`/`input`:

1. `user.action.select` — enquirer select of the next action.
2. `user.prompt.text` — enquirer input, then stream tokens straight to
   stdout while `ora` spins.
3. `user.tools.select`, `user.context.add/remove` — more enquirer prompts.
4. Tool-call approval via a blocking `confirm` prompt
   (`chat-session.ts:261`).

This works, but has known UX limits:

- **No persistent transcript region.** `ora.stop()` + raw `stdout.write`
  makes it hard to re-render history, show token counters, or keep a
  footer visible.
- **Prompt modality.** Every new message requires the user to pick
  "Send a message" from a menu first (`chat-session.ts:304`). There is no
  always-on input.
- **Tool approval interrupts the stream.** The `confirm` prompt at
  `chat-session.ts:261` blocks until answered and cannot show the tool's
  full arguments in a readable layout.
- **Single-line input only.** `enquirer`'s `input` type does not support
  multi-line composition for long prompts.
- **No simultaneous affordances.** Cannot show "streaming…", "press Esc to
  abort", and tool-call status at the same time.

## How Ink maps onto the chat UX

| Current pain point | Ink pattern |
|---|---|
| Transcript mixed with live spinner | `<Static items={messages}>` for history; live `<Box>` below for the current turn |
| Action menu before every message | Always-mounted `TextInput` in the footer; slash commands (`/context add`, `/tools`, `/quit`) parsed in `onSubmit` |
| Tool-approval `confirm` interrupts flow | Dedicated `<Alert variant="warning">` card with `<ConfirmInput>` rendered inline in the transcript; Esc cancels |
| `SIGINT` hack for abort (`chat-session.ts:72`) | `useInput` with `key.escape` → call existing `messageStream.abort()` |
| Model / tool selection via modal prompts | `<Select>` / `<MultiSelect>` rendered inline, no context-switch out of the chat view |
| No status surface | Persistent footer `<Box>` with `<Spinner>` + model name + token count + context badges (`<Badge>` per enabled context) |
| Streaming writes raw stdout | Accumulate delta into state, render within `<Text>`; Ink handles reconciliation and won't tear across resizes |

`ChatSession`'s existing logic (`#runChat`, `#runTools`, `#selectTools`,
message aggregation) is provider-agnostic and stays as-is — Ink only
replaces the I/O layer that today is `enquirer` + `ora` + stdout writes.

## Migration shapes

Three options, increasing in scope:

### Option A — Ink as a drop-in renderer, keep oclif

Lowest-risk. Each chat command's `run()` mounts an Ink `<App>` via
`render(<ChatApp provider={…} host={…} model={…} />)`. `ChatSession` is
refactored so its state (messages, request state, loader status) lives in
React state, but the methods (`#runChat`, `#runTools`, …) move into hooks
that call the same underlying provider / host APIs. oclif still owns
command routing, flags, and plugin help.

- **Pros:** no framework churn, no new build pipeline, keeps `@oclif/*`
  investments, ship incrementally (start with `chat anthropic`).
- **Cons:** two CLI frameworks coexist (oclif commands + Ink renderer).

### Option B — Replace enquirer/ora with Ink UI only

Even narrower: keep the current imperative flow but swap each
`enquirer.prompt` / `ora` call for a short-lived Ink render that resolves
a promise. This is roughly what `@inquirer/prompts` does, but via Ink UI.

- **Pros:** minimal code delta in `chat-session.ts`.
- **Cons:** does not unlock the "persistent transcript + live footer"
  gains — the big UX wins come from rendering the whole chat as one tree.

### Option C — Pastel rewrite of `packages/cli`

Replace oclif entirely: `commands/` folder, Zod flag schemas, Ink all the
way down.

- **Pros:** single framework, typed flags, modern defaults.
- **Cons:** biggest migration; rewrites `bin/run.js`, the `oclif.manifest`
  build step, and the `prepack` flow; affects published `mokei` package.
  Not justified unless we also want to reshape the command surface.

**Recommendation:** Option A. Migrate `chat-session.ts` to an Ink app
behind the existing oclif commands first, validate on one provider, then
consider B/C separately.

## Open questions

- **Node engine.** Ink v5 targets Node ≥18; mokei already requires
  Node ≥22 (`packages/cli/package.json:17`), so no conflict.
- **Build pipeline.** `packages/cli` builds with SWC (`swc.json`). Ink
  needs JSX — SWC supports this via `jsc.transform.react`; confirm the
  shared `swc.json` can be extended package-locally without breaking the
  other packages.
- **Bundle size.** Adding `react`, `ink`, `@inkjs/ui`, and `yoga-wasm-web`
  adds ~2–3 MB to the CLI install. Acceptable for a dev tool but worth
  measuring.
- **Testing.** `ink-testing-library` enables snapshot tests of the chat
  view; worth adding alongside any migration.
- **Pastel fit.** If we revisit command routing later (e.g. to add
  `mokei session …` or config subcommands), Pastel is the natural
  endpoint — but it's a follow-up, not a prerequisite.

## Next steps (if picked up)

1. Prototype `chat-session.tsx` rendering the Anthropic chat with `<Static>`
   transcript + footer input, reusing `ChatSession`'s provider logic via
   hooks.
2. Wire Esc → `messageStream.abort()`, replacing the `SIGINT` handler.
3. Replace the tool-approval `confirm` with an inline `<ConfirmInput>`
   card.
4. Port `chat ollama` and `chat openai` once the Anthropic path is stable.
5. Measure install size and startup time before vs after.

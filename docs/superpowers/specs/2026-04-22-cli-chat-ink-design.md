# CLI Chat UX on Ink — Design

**Date:** 2026-04-22
**Status:** design approved, ready for planning
**Origin:** `docs/agents/plans/next/2026-04-18-cli-chat-ux-ink.md` (research)
**Strategy:** Option A from the research doc — Ink renderer behind existing oclif commands.

## Goal

Replace the imperative `enquirer` + `ora` + raw `stdout` loop in
`packages/cli/src/chat-session.ts` with an Ink application that reuses the
orchestration logic already present in `@mokei/session`. Outcome: persistent
transcript, always-on input, inline tool approval, Esc-to-abort, and ~300
fewer lines of duplicated orchestration in the CLI package.

Ship Anthropic first, then Ollama and OpenAI.

## Architecture

Top-down layer stack:

```
┌─────────────────────────────────────────────┐
│ Ink App (packages/cli)                       │
│ <ChatApp> — transcript, input, footer        │
│ <ToolApprovalCard>, <Static>, <TextInput>    │
├─────────────────────────────────────────────┤
│ React hooks (packages/cli)                   │
│ useSession, useAgentTurn, useToolApproval    │
├─────────────────────────────────────────────┤
│ @mokei/session — Session + AgentSession      │
│ (extended for multi-turn history)            │
├─────────────────────────────────────────────┤
│ @mokei/host, providers (unchanged)           │
└─────────────────────────────────────────────┘
```

One `Session` per CLI invocation, held in `<ChatApp>` via `useRef` and
disposed on app unmount.

## Core changes — `@mokei/session`

`AgentSession` is currently one-shot: `stream(prompt)` builds
`messages = []` fresh each call and `AgentResult` does not return the
updated history. Multi-turn chat needs:

- `stream(prompt, opts?: { messages?: Array<Message<…>>; signal?: AbortSignal }): AsyncGenerator<AgentEvent>` — when `opts.messages` is supplied, it is prepended before the new user message; the system prompt is still injected first if present and not already in the supplied messages.
- `run(prompt, opts?: { messages?; signal? }): Promise<AgentResult>` — same addition.
- `AgentResult.messages: Array<Message<…>>` — full conversation history after the turn (input messages + new user message + assistant messages + tool messages across all iterations).

Both new parameters are optional. Existing one-shot callers continue to work
with `stream(prompt)` / `run(prompt)` and can ignore `result.messages`.

Unit tests in `packages/session/test/` cover a two-turn sequence: first
turn returns `result.messages`, second turn passes them via
`{ messages }` and extends them, asserting role/text order.

## CLI package layout

```
packages/cli/src/
├── chat/
│   ├── ChatApp.tsx                 # root Ink component
│   ├── components/
│   │   ├── UserMessage.tsx
│   │   ├── AssistantMessage.tsx
│   │   ├── ToolResultCard.tsx
│   │   ├── ToolApprovalCard.tsx
│   │   ├── ToolCallStatus.tsx
│   │   ├── AssistantStreamingText.tsx
│   │   ├── PendingTurn.tsx
│   │   ├── Footer.tsx
│   │   ├── StatusLine.tsx
│   │   ├── SystemNotice.tsx
│   │   ├── ModelSelectCard.tsx
│   │   ├── ToolSelectCard.tsx
│   │   └── HelpCard.tsx
│   ├── hooks/
│   │   ├── useSession.ts
│   │   ├── useAgentTurn.ts
│   │   ├── useToolApproval.ts
│   │   ├── useSlashCommand.ts
│   │   └── useAbort.ts
│   └── slash.ts                    # pure parser
├── commands/chat/
│   ├── anthropic.tsx               # mount <ChatApp provider={…} />
│   ├── ollama.tsx
│   └── openai.tsx
├── flags.ts                        # unchanged
├── fs.ts                           # unchanged
└── index.ts                        # unchanged
```

Deleted: `chat-session.ts`, `prompt.ts`.

## Component tree

```
<ChatApp provider model?>
├── <Static items={transcript}>       # append-only history
│     ├── <UserMessage text>
│     ├── <AssistantMessage text toolCalls?>
│     ├── <ToolResultCard name result|error>
│     └── <SystemNotice text variant>  # context-added/removed, errors
│
├── <PendingTurn>                      # shown while agent streaming
│     ├── <AssistantStreamingText text>   # current delta
│     ├── <ToolApprovalCard call onDecision>  # inline, blocking
│     └── <ToolCallStatus name phase>      # calling/done/failed
│
└── <Footer>
      ├── <StatusLine>                 # model · spinner · tokens · ctx badges
      └── <TextInput onSubmit>         # always-on, supports slash cmds
```

**`<Static>` rule:** only committed, immutable items go in `<Static>`.
Streaming delta and approval card live in `<PendingTurn>` which re-renders.
When a turn completes, `PendingTurn` contents flush into `<Static>` as
frozen entries, then `PendingTurn` clears.

## Hooks

| Hook | Returns | Responsibility |
|------|---------|----------------|
| `useSession(providers, localTools?)` | `{ session, contexts, providers, addContext, removeContext }` | Creates Session, subscribes to `context-added`/`context-removed`, exposes actions |
| `useAgentTurn({ session, provider, model, toolApproval })` | `{ state, messages, submit, abort }` | `submit(text)` spawns AgentSession, consumes `stream()`, pushes events into React state. `state = 'idle' \| 'streaming' \| 'awaiting-approval' \| 'calling-tool'`. `messages` accumulates across turns. |
| `useToolApproval()` | `{ pending, approve, deny, toolApprovalFn }` | Deferred-promise bridge. `toolApprovalFn(call, ctx)` returns a Promise held open; UI renders `<ToolApprovalCard>` from `pending`; user decision resolves the promise |
| `useSlashCommand(input, handlers)` | `{ parse }` | Parses `/cmd args` → dispatches to session action. Non-slash input → `submit(text)` |
| `useAbort(abort)` | — | `useInput((_, key) => key.escape && abort())` — Esc cancels stream at root |

### `useAgentTurn` state reducer

Event-driven. Maps `AgentEvent` types → state transitions:

- `start` → `{ state: 'streaming' }`
- `text-delta` → append to `currentText`
- `text-complete` → flush `currentText` into `messages`, clear buffer
- `tool-call-pending` → `{ state: 'awaiting-approval', pendingCall }`
- `tool-call-approved | denied` → `{ state: 'calling-tool' | 'streaming' }`
- `tool-call-complete | error` → append tool result message
- `iteration-start | iteration-complete` → optional counter
- `complete` → set final messages from `result.messages`, `{ state: 'idle' }`
- `error | timeout | max-iterations` → system notice, `{ state: 'idle' }`

### Tool approval bridge

```ts
// useToolApproval.ts
type Pending = {
  call: FunctionToolCall
  ctx: ToolApprovalContext
  resolve: (ok: boolean) => void
}

function useToolApproval() {
  const [pending, setPending] = useState<Pending | null>(null)

  const toolApprovalFn: ToolApprovalFn = useCallback((call, ctx) => {
    return new Promise<boolean>((resolve) => setPending({ call, ctx, resolve }))
  }, [])

  const approve = () => { pending?.resolve(true);  setPending(null) }
  const deny    = () => { pending?.resolve(false); setPending(null) }

  return { pending, approve, deny, toolApprovalFn }
}
```

`toolApprovalFn` is passed into `AgentSession` as `toolApproval`. When the
agent hits a tool call it awaits the promise; React renders
`<ToolApprovalCard>` from `pending`; the user's keypress (y/n via
`<ConfirmInput>`, or Esc to deny) resolves the promise; the agent resumes.

## Slash commands

| Command | Action |
|---------|--------|
| `/context` *(alias `/context list`)* | `<SystemNotice>` enumerating contexts + enabled tool counts |
| `/context add <key> <cmd> [args...]` | `session.addContext({ key, command, args })` |
| `/context remove <key>` | `session.removeContext(key)` |
| `/model` *(no args)* | Open `<ModelSelectCard>` — `<Select>` over `provider.listModels()`, sets active model |
| `/model <id>` | Direct switch (validates against `listModels`) |
| `/tools` | `<ToolSelectCard>` multi-select over enabled tools across all contexts |
| `/help` | `<HelpCard>` listing commands |
| `/quit`, `/exit` | Dispose session, unmount app |
| *(no leading `/`)* | User message → `submit(text)` |

Parser lives in `packages/cli/src/chat/slash.ts`. Pure function
`parse(input) → { kind: 'message', text } | { kind: 'command', name, args }`.
Unknown command → inline error notice; no submission.

## Abort flow

- `useAgentTurn` holds an `AbortController` for the active turn. `abort()` calls `controller.abort()` → AgentSession's `signal` propagates → stream ends with `finishReason: 'aborted'`.
- `useInput((_, key) => key.escape && state !== 'awaiting-approval' && abort())` — Esc at root aborts streaming or tool-calling. During an approval card, Esc is owned by the card (denies the call without aborting the turn).
- Existing `SIGINT` handler stays as a safety net — triggers `abort()` then `app.exit()`.

## Error surfacing

`AgentErrorEvent`, `AgentTimeoutEvent`, `AgentMaxIterationsEvent` render as
inline `<SystemNotice variant="error|warning">` in `<Static>`. The turn
returns to idle and input re-focuses.

## Build pipeline

- `packages/cli/swc.json` extended package-locally: add `jsc.transform.react = { runtime: 'automatic', importSource: 'react' }`. No bleed into other packages (they import no JSX).
- `packages/cli/tsconfig.json` gains `jsx: 'react-jsx'`, `jsxImportSource: 'react'`.
- New devDeps: `react`, `@types/react`, `ink`, `@inkjs/ui`.
- New runtime deps: `react`, `ink`, `@inkjs/ui`.
- Removed deps: `ora`, `enquirer`, `ansi-colors`.
- Components in `chat/components/*.tsx`; hooks in `chat/hooks/*.ts` (no JSX).

## Testing

- **`ink-testing-library`** snapshot tests for components: `<ChatApp>` initial render, transcript accumulation after a turn, tool-approval card rendering on pending event, approval promise resolution, Esc aborts streaming.
- **Unit** tests for `slash.ts` parser — pure function, covers every command + unknown-command path.
- **Unit** tests for the `useAgentTurn` reducer — exercise `AgentEvent` → state transitions with a mock AgentSession event stream.
- **`@mokei/session`** gains tests covering `AgentSession.stream({ messages })` carrying history across a two-turn sequence, and `AgentResult.messages` returning the expected role/text order.

## Migration order

1. **Core patch** — extend `AgentSession.stream/run` + `AgentResult.messages`, with tests. Independent commit. No CLI changes yet.
2. **CLI build prep** — swc/tsconfig JSX, deps swap, empty `chat/` scaffold. Old `ChatSession` still in use.
3. **Anthropic path** — rewire `commands/chat/anthropic.tsx` to mount `<ChatApp>`. Implement hooks, components, slash parser. Feature-parity with the old flow (message, tool approval, context add/remove, model/tool select).
4. **Ollama + OpenAI** — swap command files to the same `<ChatApp>`. No new code, just provider wiring.
5. **Delete dead code** — `chat-session.ts`, `prompt.ts`, removed deps.

## Risks and measurements

- **Bundle size**: measure `pnpm pack` before/after. Expected +2–3 MB (react + ink + yoga-wasm).
- **Startup latency**: time `mokei chat anthropic --help` before/after.
- **SWC JSX**: if `jsc.transform.react` trips the other packages' shared swc config, fall back to a fully package-local `swc.json` override.

## Non-goals

- Pastel migration (Option C from the research doc).
- `chat llama` command wiring.
- Persisting chat history across CLI invocations.
- Slash command autocomplete UI.
- Multi-line input composition — single-line `TextInput` is fine for v1; noted as a follow-up.

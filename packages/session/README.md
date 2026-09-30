# Mokei session

Portable chat and agent sessions for direct and HTTP MCP contexts.

```sh
pnpm add @mokei/session
```

```typescript
import { Session } from '@mokei/session'

const session = new Session()
await session.addHTTPContext({ key: 'remote', url: 'https://example.com/mcp' })
```

For spawned stdio contexts on Node, install `@mokei/session-node` and use `NodeSession`.

## Tool approval metadata

An agent's `toolApproval` callback may return `{ approved: true, meta }`. The session sends
that `meta` as `_meta` on the approved tool call only, including when a stream consumer resumes
after `tool-call-approved`. Returning a boolean keeps the existing approval behavior. This
allows [`@mokei/decision-flow-server`](../decision-flow-server/README.md) to send a single-use
flow grant with the run it approved.

## Server elicitation in agents

Enable elicitation when creating the session, then supply `onElicitation` to answer requests.
The callback receives the server context key, MCP request params, and an abort signal.

```typescript
import { AgentSession, Session } from '@mokei/session'

const session = new Session({ elicit: true })
const agent = new AgentSession({
  session,
  provider,
  model: 'your-model',
  onElicitation: async ({ key, params, signal }) => {
    return askUser({ key, params, signal })
  },
  onEvent: (event) => {
    if (event.type.startsWith('elicitation-')) console.log(event)
  },
})
```

An enabled host has one agent owner at a time. Dispose the agent to release ownership.
Passing `onElicitation` to an agent whose host was created without elicitation throws.
Without `onElicitation`, the agent uses the session's base `elicit` handler.
With `elicit: true` and no base handler, the fallback declines the request.

`onEvent` and `agent.events` receive `elicitation-request`, followed by exactly one
`elicitation-response` or `elicitation-error`. Match them using `requestID`, including when
requests overlap. Response events contain the action but omit answer content.
When a request is attributed to a tool call, `agent.stream()` yields the request and its terminal
event in order, between `tool-call-start` and the tool's terminal event. Both elicitation events
carry that `toolCall`. Unattributed requests reach `onEvent` and `agent.events` only.

Attribution requires exactly one active run with an in-flight context tool call whose context key
matches the requesting server. A context key alone cannot prove which call caused a request, so an
unrelated request from the same context can be attributed to that tool call.
Disposing an agent aborts its active runs and keeps its elicitation override until their tool calls
settle, so a request from those calls never reaches a later owner. Constructing another eliciting
agent on the same host throws until then. On `2025-11-25`, a server that keeps running a tool after
the client stops waiting for it can still send a request later; the protocol does not identify which
call it belongs to, so it reaches whichever owner is installed then.
URL-mode elicitation reaches the callback. When the server later sends
`notifications/elicitation/complete`, `onEvent` and `agent.events` receive an `elicitation-complete`
event with the context `key` and `elicitationId`, so a UI can close the URL prompt. It is not part of
run streams, since it may arrive after the run ended.

## [Documentation](https://mokei.dev)

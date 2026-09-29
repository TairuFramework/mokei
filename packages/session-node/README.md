# Mokei session Node

Node stdio support for `@mokei/session`.

```sh
pnpm add @mokei/session @mokei/session-node
```

```typescript
import { NodeSession } from '@mokei/session-node'

const session = new NodeSession()
await session.addContext({ key: 'tools', command: 'mcp-server' })
```

Use `Session` from `@mokei/session` for direct or HTTP contexts on any JavaScript runtime.

## Elicitation

Enable elicitation when the session creates its host by providing a handler. The handler receives
the requesting context key, the elicitation parameters and an abort signal.

```typescript
const session = new NodeSession({
  elicit: async ({ key, params, signal }) => {
    return await promptUser({ context: key, message: params.message, signal })
  },
})
```

Elicitation capability is fixed when the host is constructed. A session without `elicit` keeps the
capability disabled. Use `elicit: true` to enable the capability and decline requests until an
agent handles them. Do not pass both `contextHost` and `elicit`; this throws because the supplied
host owns its capability configuration.

```typescript
import { NodeContextHost } from '@mokei/host-node'

const host = new NodeContextHost({ elicit: true })
const session = new NodeSession({ contextHost: host })
```

Opt one stdio context out while keeping elicitation enabled for the others:

```typescript
await session.addContext({
  key: 'legacy-tools',
  command: 'legacy-mcp-server',
  elicit: false,
})
```

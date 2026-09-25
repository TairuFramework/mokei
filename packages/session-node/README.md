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

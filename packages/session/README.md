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

## [Documentation](https://mokei.dev)

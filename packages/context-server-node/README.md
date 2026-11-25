# Mokei MCP server for Node.js

## Installation

```sh
npm install @mokei/context-server-node
```

## Skills

`loadSkillCatalog` reads skills from a directory and builds a catalog for the `skills` option of
`ContextServer` (see `@mokei/context-server`). A skill is any directory containing a `SKILL.md`
file. Dotfiles and symlinks are skipped. `prefix` is prepended to every skill path.

```typescript
import { ContextServer } from '@mokei/context-server'
import { loadSkillCatalog } from '@mokei/context-server-node'

const skills = await loadSkillCatalog('./skills', { prefix: 'acme', directoryRead: true })

const server = new ContextServer({
  name: 'my-server',
  version: '1.0.0',
  protocolVersions: ['2026-07-28'],
  skills,
})
```

`loadSkillDefinitions` returns the plain definitions when you want to adjust them before calling
`createSkillCatalog`.

## [Documentation](https://mokei.dev)

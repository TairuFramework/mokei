# Mokei Skills extension Node loader

Loads Skills from disk for `@mokei/extension-skills-server`. A skill is any directory containing a
`SKILL.md` file. Dotfiles and symlinks are skipped, empty directories are recorded, and output is sorted.

## Installation

```sh
npm install @mokei/extension-skills-node
```

## Usage

```typescript
import { ContextServer } from '@mokei/context-server'
import { skillsServerExtension } from '@mokei/extension-skills-server'
import { loadSkillCatalog } from '@mokei/extension-skills-node'

const catalog = await loadSkillCatalog('./skills', { prefix: 'acme', directoryRead: true })

const server = new ContextServer({
  name: 'my-server',
  version: '1.0.0',
  protocolVersions: ['2026-07-28'],
  extensions: [skillsServerExtension(catalog)],
})
```

## API

- `loadSkillCatalog(root, options?)` - Read skills from `root` and build a served catalog. Options:
  `prefix` (path prefix such as `acme`), plus the catalog options `directoryRead`, `cache` and `scopes`.
- `loadSkillDefinitions(root, options?)` - Return the plain `SkillDefinition`s, sorted by path.

## [Documentation](https://mokei.dev)

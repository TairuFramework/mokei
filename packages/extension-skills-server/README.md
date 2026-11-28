# Mokei Skills extension server

Serves the Skills MCP extension (`io.modelcontextprotocol/skills`, revision `2026-07-28`) from a
`ContextServer`. The server answers `skills/list` and `skills/get`, and serves skill files through
`resources/read` under `skill://` URIs. Each entry lists every file with its SHA-256 digest and size.
The package is portable: it takes file contents from the caller and never touches the filesystem.

## Installation

```sh
npm install @mokei/extension-skills-server
```

## Usage

```typescript
import { ContextServer } from '@mokei/context-server'
import { createSkillCatalog, skillsServerExtension } from '@mokei/extension-skills-server'

const catalog = await createSkillCatalog(
  [
    {
      path: 'acme/greeter',
      files: {
        'SKILL.md': '---\nname: greeter\ndescription: Greets people.\n---\nSay hello.',
        'references/tone.md': 'Be friendly.',
      },
    },
  ],
  { directoryRead: true }, // optional: also serve resources/directory/read
)

const server = new ContextServer({
  name: 'my-server',
  version: '1.0.0',
  protocolVersions: ['2026-07-28'],
  extensions: [skillsServerExtension(catalog)],
})
```

The last path segment is the skill name and must match the `name` in the frontmatter. To load skills
from disk, use `loadSkillCatalog` from `@mokei/extension-skills-node`.

## API

- `createSkillCatalog(definitions, options?)` - Build a `SkillCatalog` from `SkillDefinition`s.
  Options: `directoryRead`, `cache`, `scopes`.
- `skillsServerExtension(catalog)` - The extension to pass in the `extensions` option of `ContextServer`.
  `resources/directory/read` is served only when the catalog enables `directoryRead`.

## [Documentation](https://mokei.dev)

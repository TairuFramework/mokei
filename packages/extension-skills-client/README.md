# Mokei Skills extension client

Uses the Skills MCP extension (`io.modelcontextprotocol/skills`, revision `2026-07-28`) from a
`ContextClient`. Skill content is untrusted: `readSkillFile` reads a file only if the entry lists it,
then checks size and SHA-256 digest (and the frontmatter for `SKILL.md`). It throws
`SkillVerificationError` and never returns content that fails a check. Nothing is read before it is
asked for.

## Installation

```sh
npm install @mokei/extension-skills-client
```

## Usage

```typescript
import { ContextClient } from '@mokei/context-client'
import { SKILLS } from '@mokei/context-protocol'
import { createSkillsClient } from '@mokei/extension-skills-client'

const client = new ContextClient({
  protocolVersion: '2026-07-28',
  transport,
  extensions: [SKILLS],
})
const skills = createSkillsClient(client)

const { skills: entries } = await skills.listSkills()
const entry = entries[0]
const file = await skills.readSkillFile(entry, entry.uri) // verified SKILL.md
```

## API

- `createSkillsClient(client)` - Wrap a `ContextClient` built with `extensions: [SKILLS]`. Without it,
  every method is refused locally before anything is sent.
- `listSkills()` - List the skills the server serves
- `getSkill(uri)` - Fetch one skill entry; reads no file
- `readSkillFile(entry, uri)` - Read a skill file and verify it against the entry
- `readResourceDirectory(params)` - List a directory resource (the server must declare `directoryRead`)
- `SkillVerificationError` - Thrown with a `reason` when a check fails

## [Documentation](https://mokei.dev)

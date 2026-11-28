# Mokei Skills extension helpers

Format helpers for the Skills MCP extension (`io.modelcontextprotocol/skills`, revision `2026-07-28`),
shared by `@mokei/extension-skills-server` and `@mokei/extension-skills-client`: skill names, `skill://`
URIs, SHA-256 digests and `SKILL.md` frontmatter validation.

## Installation

```sh
npm install @mokei/extension-skills
```

## Usage

```typescript
import {
  computeDigest,
  isValidSkillName,
  joinSkillURI,
  parseSkillFrontmatter,
} from '@mokei/extension-skills'

isValidSkillName('greeter') // true
const uri = joinSkillURI('acme/greeter', 'references/tone.md') // 'skill://acme/greeter/references/tone.md'
const digest = await computeDigest(new TextEncoder().encode('Be friendly.')) // 'sha256:...'
const frontmatter = parseSkillFrontmatter('---\nname: greeter\ndescription: Greets people.\n---\nHi')
```

## API

- `SKILL_LIMITS` - Per-skill limits: 512 files, 16,777,216 bytes (`SKILL.md` included)
- `computeDigest(bytes)`, `isValidDigest(digest)` - WebCrypto `sha256:` digests
- `isValidSkillName(name)`, `validatePathSegments(path)` - Name and path rules
- `skillRootURI`, `skillNameFromURI`, `joinSkillURI`, `isValidSkillURI`, `isWithinSkill` - `skill://` URI helpers
- `decodeExactUTF8(bytes)` - Strict UTF-8 decoding
- `parseSkillFrontmatter`, `validateSkillFrontmatter`, `frontmatterEquals` - `SKILL.md` frontmatter
- `SkillFormatError` - Thrown on invalid input

The wire schemas and the `SKILLS` registry entry live in `@mokei/context-protocol`.

## [Documentation](https://mokei.dev)

---
"@mokei/context-protocol": patch
"@mokei/context-server": patch
"@mokei/context-server-node": patch
"@mokei/context-client": patch
---

Add the Skills over MCP extension (`io.modelcontextprotocol/skills`, `2026-07-28`). `@mokei/context-protocol` exports the skill schemas, the `SKILLS` registry entry and the format helpers. `@mokei/context-server` exports `createSkillCatalog` and takes a `skills` option on `ContextServer`, serving `skills/list`, `skills/get`, `skill://` files and optional `resources/directory/read`. `@mokei/context-server-node` exports `loadSkillCatalog` and `loadSkillDefinitions`. `ContextClient` takes `skills: true` and adds `listSkills`, `getSkill`, `readResourceDirectory` and `readSkillFile`, which verifies listed URIs, sizes, digests and frontmatter and throws `SkillVerificationError` on a mismatch.

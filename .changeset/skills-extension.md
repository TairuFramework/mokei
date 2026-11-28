---
"@mokei/context-protocol": patch
"@mokei/context-server": patch
"@mokei/context-client": patch
"@mokei/extension-skills": patch
"@mokei/extension-skills-server": patch
"@mokei/extension-skills-client": patch
"@mokei/extension-skills-node": patch
---

Add the Skills over MCP extension (`io.modelcontextprotocol/skills`, `2026-07-28`) as the `@mokei/extension-skills`, `-server`, `-client` and `-node` packages. `@mokei/context-protocol` exports the skill schemas and the `SKILLS` registry entry. `@mokei/context-server` takes an `extensions` option on `ContextServer`, and `@mokei/context-client` an `extensions` option on `ContextClient`. `@mokei/extension-skills-server` exports `createSkillCatalog` and `skillsServerExtension`, serving `skills/list`, `skills/get`, `skill://` files and optional `resources/directory/read`. `@mokei/extension-skills-node` exports `loadSkillCatalog` and `loadSkillDefinitions`. `@mokei/extension-skills-client` exports `createSkillsClient` with `listSkills`, `getSkill`, `readResourceDirectory` and `readSkillFile`, which verifies listed URIs, sizes, digests and frontmatter and throws `SkillVerificationError` on a mismatch.

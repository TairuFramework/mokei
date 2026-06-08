# MCP Draft — Upstream (Enkaku) Findings

Companion to `2026-06-08-mcp-draft-migration-design.md`. Records the resolution of
upstream items U1–U3 before the breaking migration phase.

## U2 — `@enkaku/schema` JSON Schema draft level

**Confirmed: draft-07.** `@enkaku/schema@0.16.0` constructs a single module-level
`new Ajv({ allErrors: true, useDefaults: false })` (the default `ajv` import = JSON
Schema draft-07) and exposes no per-call draft option. 2020-12 keywords
(`prefixItems`, `$dynamicRef`, `unevaluatedProperties`, etc.) are silently ignored.

**Impact:** Spec item **G8** (loosen `inputSchema`/`outputSchema` to arbitrary JSON
Schema 2020-12 keywords + `$ref` resolution) **cannot be implemented in mokei alone**.

**Upstream ask (Enkaku `@enkaku/schema`):** switch the validator to `Ajv2020`
(`import Ajv2020 from 'ajv/dist/2020'`) or allow `createValidator` to select the
draft / accept an AJV instance. Until then G8 stays deferred.

_Probe note:_ the root-resolved probe failed with `ERR_MODULE_NOT_FOUND` (package
not hoisted to repo root). Inspecting `lib/validation.js` confirmed `import { Ajv }
from 'ajv'` + a single module-level `new Ajv({ allErrors: true, useDefaults: false })`,
no `Ajv2020`. Re-running the probe against the installed `lib/index.js` threw
`Error: strict mode: unknown keyword: "prefixItems"` (AJV draft-07 rejects the
2020-12 keyword as unknown), directly establishing the draft-07 finding.

## U3 — `@enkaku/otel` availability & `_meta` mapping
_(filled by Task 3)_

## U1 — Transport model vs stateless + MRTR
_(filled by Task 4)_

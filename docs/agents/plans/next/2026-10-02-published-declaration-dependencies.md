# Published declaration dependencies

**Priority:** high
**Origin:** [flow host Node storage and observability](../completed/2026-10-02-flow-host-node.complete.md)

## Problem

Strict dependency-isolated consumers of the full Node flow-host entry still encounter unresolved imports from existing package declarations.
Workspace development dependencies and hoisted installations conceal these gaps. The Node package's own flow-graph dependency was corrected.

The isolated production dependency graph exposed these imports:

- `@mokei/context-server`, `@mokei/context-client` and `@mokei/context-rpc` refer to undeclared `@enkaku/transport`.
- `@mokei/context-protocol` refers to development-only `@sozai/schema`. `@mokei/context-rpc` also refers to `@sozai/schema`.
- `@mokei/model-provider` refers to development-only `@mokei/context-protocol`.

## Work

Confirm each import against its current emitted declarations and production manifest.
Correct the dependency declarations or remove unnecessary public type imports.
Preserve public types and avoid unrelated runtime changes.

## Acceptance

A strict consumer imports the public flow-host-node entry using only copied production dependencies and declared required peers.
No dependency links resolve to workspace development dependencies or a hoisted fallback.
TypeScript passes with `skipLibCheck: false`, and returned flow IDs retain their string type.
Existing package and declaration-consumer checks continue to pass.

# Enkaku protocol schema rebasing release prerequisite

**Priority:** release blocking
**Scope:** upstream protocol repair and Mokei dependency adoption

## Problem and release gate

The flow daemon protocol carries recursive JSON values. `@enkaku/protocol@0.21.3` embeds
procedure schemas inside signed and unsigned RPC message envelopes without rebasing their
root-local definition references. AJV resolves those references against the envelope root,
where the definition is absent, and rejects otherwise valid recursive flow payloads.

Mokei currently carries `patches/@enkaku__protocol@0.21.3.patch` through pnpm's workspace
`patchedDependencies`. It repairs the local development/test installation only. Publishing
Mokei packages does not install this patch for their consumers.

**Do not publish the composed flow daemon release until an upstream Enkaku release contains
this repair and Mokei requires that fixed version.** A passing patched workspace suite is
insufficient release evidence. Recording release intent is allowed; it does not lift the gate.

## Work

- Land and release the narrow repair in the owning Enkaku repository through its release workflow.
- Rebase `#/definitions/...` and `#/$defs/...` references against their nearest definition scope
  while constructing both client and server message schemas. Preserve source schemas,
  external references and nested `$id` resource boundaries.
- Traverse schema locations only. Keep literal `$ref`-shaped objects in `const`, `enum`,
  defaults, examples, annotations and extension data unchanged.
- Add upstream regressions for recursive payloads in signed and unsigned envelopes,
  pointer-escaped definition names, nested scopes, resource boundaries and literal data.
  This repair does not promise support for arbitrary root-reference forms such as bare `#`
  or `#/properties/...`.
- Raise Mokei's catalog minimum and any resolved production Enkaku protocol dependency paths
  to the released fixed version. Regenerate the lockfile and remove the workspace patch
  registration and patch file after confirming the upstream artifact provides the repair.
- Run strict host-protocol and flow-handler regressions, the daemon process suite and the
  required repository checks against the unpatched published dependency.

## Acceptance

A fresh consumer installation of packed Mokei production packages receives the fixed published
Enkaku protocol without workspace patches or local links. A client and server exchange
recursive JSON flow inputs, results and validation snapshots with strict validation intact;
literal `$ref` data is unchanged and functions in JSON payloads remain rejected. Both signed
and unsigned schema paths pass the upstream regression suite. Record the released version
and consumer evidence here before lifting the Mokei publication gate.

This follow-on does not include the separate
[published declaration dependency work](2026-10-02-published-declaration-dependencies.md).

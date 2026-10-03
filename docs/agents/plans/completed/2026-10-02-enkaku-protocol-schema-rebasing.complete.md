# Enkaku protocol schema rebasing adoption

**Status:** complete
**Date:** 2026-10-02
**Branch:** `feat/flow-daemon`

## Outcome

Published `@enkaku/protocol@0.21.4` rebases local definition references when composing client and server message schemas.
It uses the published `@sozai/schema@0.1.5` implementation.
Mokei's catalog requires `^0.21.4`, and every resolved protocol dependency now uses that version.
The workspace patch and its registration were removed.
The Enkaku publication prerequisite is satisfied. No packages were published.

## Verification

Repository build, typechecks and lint passed with the unpatched published dependency.
The full suite passed 3,385 tests with 41 expected skips, including 14 daemon process scenarios.
Existing regressions cover signed, unsigned and combined envelopes, recursive JSON, strict rejection, schema resource boundaries and literal reference preservation.

A fresh temporary consumer installed all 29 packed production packages.
Temporary overrides resolved unpublished Mokei siblings to those tarballs. Enkaku and other external dependencies came from the registry.
The consumer lockfile contained only protocol 0.21.4, without patches or workspace links.
Its probe validated signed and unsigned recursive request/result schemas, rejected functions, and preserved literal reference data.
The packed CLI daemon served a real socket and completed an inline input flow with nested JSON input and output.
Validation snapshots, inbox settlement, run reads and trace reads succeeded.

The separate published declaration dependency work was folded into the flow CLI and MCP sub-project, which shipped
it with the `pnpm test:packed` check (see the [flow client follow-ons](../backlog/2026-10-03-flow-client-follow-ons.md)).

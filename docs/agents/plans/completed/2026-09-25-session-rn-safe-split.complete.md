# Split `@mokei/session` for React Native

**Status:** complete
**Origin:** `@mokei/session` imports `NodeContextHost` from `@mokei/host-node` and declares that
package as a dependency. `Session` and `AgentSession` therefore remain Node-only even when an app
uses only direct or HTTP contexts.

## Goal

Make the chat and agent-loop core Node-free so React Native and Metro can import it. Follow the
precedent in `completed/2026-08-25-host-rn-bundler-safe-entry.complete.md`: keep the portable host
in `@mokei/host` and isolate process spawning in `@mokei/host-node`.

## Scope and decision

- Move portable session and agent-loop behaviour onto `ContextHost`; retain direct and HTTP
  contexts and the provider interface in the portable entry.
- Isolate stdio spawning, file token stores and loopback OAuth in a Node entry. Preserve a clear
  route for existing Node callers of `Session.addContext`.
- Decide between a Node subpath export in `@mokei/session` and a new Node package. Check the
  Metro import graph and public API consequences first. **A new package requires user sign-off**;
  this backlog item does not authorise one.
- Verify a real Metro bundle from the Sakui mobile app as well as a static import-graph guard,
  then run the relevant session, host and integration suites.

## Outcome

`@mokei/session` now uses `ContextHost` and exposes portable `Session` and `AgentSession`.
The user chose a new `@mokei/session-node` package, leaving `@mokei/session` with only its main
export. `NodeSession.addContext` owns stdio
spawning and removes only the client registered by that call after setup failure or abort.
CLI and stdio integration callers use `NodeSession`; session tests cover the built import
graph and Node-only positive control. The host also reserves keys during async spawn, guards
child-exit cleanup by client identity, and rejects stale setup after key reuse. The new package
joins the fixed release group.

Verification: `pnpm build`; session, session-node, CLI, host and host-node tests; workspace
type tests; and Biome check. The targeted chat integration suites were skipped because no chat
backend was configured. Sakui's mobile Metro configuration bundled a temporary entry importing
the built portable `Session` and `AgentSession` for both iOS and Android, with no Node module
resolution errors. The temporary entry was removed after verification.

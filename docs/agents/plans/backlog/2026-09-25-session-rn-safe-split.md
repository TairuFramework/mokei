# Split `@mokei/session` for React Native

**Status:** backlog
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

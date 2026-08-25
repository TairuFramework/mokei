# Release note: RN-safe `@mokei/host` / `@mokei/context-server` split

For the eventual major version bump that ships this refactor.

## BREAKING CHANGE

`@mokei/host` and `@mokei/context-server` are now React Native / Metro (Hermes) bundler
safe. Their Node-only stdio and child-process code moved out into two new sibling
packages:

- Consumers importing `addLocalContext` (now a method on `NodeContextHost`, not
  `ContextHost`), `spawnHostedContext`, `createClient`, `runDaemon`, or `ProxyHost` from
  `@mokei/host` must switch those imports to `@mokei/host-node`.
- Consumers importing `serveProcess` from `@mokei/context-server` must switch that import
  to `@mokei/context-server-node`.

`@mokei/host` keeps the RN/browser-safe surface (`ContextHost`, `addDirectContext`,
`addHTTPContext`, local tools, http-client re-exports). `@mokei/context-server` keeps
its RN-safe surface (`ContextServer`, `createTool`, `createPrompt`, MRTR exports,
`types.ts`). No runtime behavior changed — all moved code was relocated verbatim.

## New packages

`@mokei/host-node` and `@mokei/context-server-node` join the fixed release group in
`pnpm-workspace.yaml` (`versioning.fixed`), so they version and release in lockstep with
the rest of the public Mokei packages starting with this bump.

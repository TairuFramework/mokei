## 0.13.0

### Minor Changes

- Split Node-only host and context-server code into new @mokei/host-node and @mokei/context-server-node packages, making @mokei/host and @mokei/context-server React Native / Metro-bundle-safe. BREAKING: addLocalContext (now a method on NodeContextHost), spawnHostedContext, createClient, runDaemon and ProxyHost move from @mokei/host to @mokei/host-node; serveProcess moves from @mokei/context-server to @mokei/context-server-node.

### Patch Changes

- Updated dependencies:
  - @mokei/context-client@0.13.0
  - @mokei/context-protocol@0.13.0
  - @mokei/context-rpc@0.13.0
  - @mokei/context-server@0.13.0
  - @mokei/http-client@0.13.0

---
"@mokei/host": minor
---

Split Node-only host and context-server code into new @mokei/host-node and @mokei/context-server-node packages, making @mokei/host and @mokei/context-server React Native / Metro-bundle-safe. BREAKING: addLocalContext (now a method on NodeContextHost), spawnHostedContext, createClient, runDaemon and ProxyHost move from @mokei/host to @mokei/host-node; serveProcess moves from @mokei/context-server to @mokei/context-server-node.

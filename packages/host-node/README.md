# @mokei/host-node

`@mokei/host-node` provides stdio and daemon-backed MCP contexts for Node.js.

## Daemon composition

`createClient(socketPath?)` connects to an existing daemon. `runDaemon({ socketPath?, entry? })`
ensures one is running, selecting an executable module through `entry`. The default entry is
the standalone host server: it serves proxy and monitor procedures and reports flow services
unavailable. The `mokei` CLI's proxy and monitor commands select its composed
`mokei/lib/daemon-entry.js`, which owns the shared flow service and desktop adapter.
Selecting an entry affects a newly started daemon; it does not replace an already running one.

Custom applications inject handlers, events, status and cleanup into the generic host:

```typescript
import { createFlowHandlers, createFlowService } from '@mokei/flow-host-node'
import { serveHostDaemon } from '@mokei/host-node'

const events = new EventTarget()
const service = createFlowService({
  onEvent: ({ type, ...detail }) => {
    events.dispatchEvent(new CustomEvent(type, { detail }))
  },
})
const daemon = await serveHostDaemon({
  events,
  handlers: createFlowHandlers(service),
  flowStatus: () => service.status(),
  onShutdown: () => service.dispose(),
})
await service.start()
// Later, await daemon.close() to run the injected cleanup and close serving.
```

Create the service once before serving so every connection shares its runtime and event source.
If binding fails, the application must dispose its service; the CLI entry handles that failure.
`serveHostDaemon` accepts socket and pid paths, an abort signal, signal-handler policy,
shutdown timeout and error callback. It owns shared proxy state, child cleanup and one
shutdown lifecycle. `composeHandlers(...sets)` combines additional handler sets and rejects
duplicate procedure names; base `events`, `info`, `shutdown` and `spawn` handlers cannot be
silently overridden. Missing flow handlers return `FLOW_UNAVAILABLE`.
The host package imports no flow or desktop implementation.

`info.flowService` is `starting`, `ready` or `failed` with a public error. Proxy serving and
status inspection stay available during startup and after a flow failure. Configuration
changes require a daemon restart. See the [flow service guide](../flow-host-node/README.md#composed-daemon)
for initial reconciliation, resource shutdown, desktop policy and public error codes.

The `events` stream includes context, flow service status, run and inbox changes with event IDs
and timestamps. Events are live and have no replay cursor. Subscribe before querying `info`,
run snapshots and the pending inbox; buffer incoming events during those queries, then re-read
affected identifiers to reconcile current state. Repeat on reconnect. Closing one stream
removes its listeners without affecting other clients or runtime transitions.

## Monitor handlers

`serveHostDaemon` can receive handlers for `monitor.attach` and `monitor.presence` alongside
flow handlers. The host package only composes and serves these procedures; the application
owns attachment tracking, tab liveness and inbox delivery policy. The default standalone daemon
does not register monitor presence handlers. The composed Mokei daemon connects them to its
monitor server and flow surfaces.

## Elicitation

Enable elicitation when constructing a host. The capability is fixed when each client is built,
so servers can send `elicitation/create` requests from the start. A function handles each request
with its context `key`; `elicit: true` enables the capability and declines requests by default.

```typescript
const host = new NodeContextHost({
  elicit: ({ key, params, signal }) => promptUser({ key, params, signal }),
})

await host.addLocalContext({
  key: 'files',
  command: 'node',
  args: ['file-server.mjs'],
})
```

Opt one stdio context out with `elicit: false`:

```typescript
await host.addLocalContext({
  key: 'batch',
  command: 'node',
  args: ['batch-server.mjs'],
  elicit: false,
})
```

For a standalone child, pass an `ElicitHandler` directly. It receives the protocol request and
signal without a host context key:

```typescript
const context = await spawnHostedContext({
  command: 'node',
  args: ['file-server.mjs'],
  elicit: ({ params, signal }) => promptUser({ params, signal }),
})
```

Daemon-backed hosts accept the same host-level option. `ProxyHost.spawn` also supports the
per-context opt-out:

```typescript
const host = await ProxyHost.forDaemon({
  socketPath: '/tmp/mokei.sock',
  elicit: ({ key, params, signal }) => promptUser({ key, params, signal }),
})

await host.spawn({ key: 'files', command: 'node', args: ['file-server.mjs'] })
await host.spawn({ key: 'batch', command: 'node', args: ['batch-server.mjs'], elicit: false })
```

The host-level handler can be temporarily overridden with `handleElicitation`. An override may
call its fallback to use the original handler or the default decline response. Install an
override only after enabling elicitation on the host.

`2025-11-25` URL-mode requests reach the handler, but completion notifications are not forwarded
to the application yet. A UI displaying a URL prompt cannot close it from a server completion.

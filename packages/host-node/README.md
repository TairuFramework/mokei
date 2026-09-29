# @mokei/host-node

`@mokei/host-node` provides stdio and daemon-backed MCP contexts for Node.js.

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

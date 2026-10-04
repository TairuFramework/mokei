# Flow monitor backlog

**Origin:** [flow monitor](../completed/2026-10-04-flow-monitor.complete.md), flow daemon milestone sub-project 5

## Performance

- The monitor bundle is about 650-770 kB and triggers Vite's chunk-size warning. Split routes or vendor chunks.
- A limited run list (`useRuns` with a limit) re-reads on every run state event, including runs outside its filter.
  Re-read only when the event can change the visible page.

## Test gaps

- Monitor surface: abort after delivery.
- `openURL` in `@mokei/host-desktop`: signal and timeout handling.

## Daemon shutdown order

The final review suggested disposing presence and monitor handlers before the flow service. This was declined for
now; revisit if shutdown races appear.

## Daemon commands ignore custom pid paths

`mokei daemon start/stop/status/restart` identify the daemon through the default pid file. A daemon started with a
custom `--pid-path` (for an isolated test setup) cannot be stopped or restarted through the CLI. Consider a
`--pid-path` option, or deriving the pid file from the selected socket.

## Upstream and small cleanups

- The monitor bridge has no `dispose()`. `startMonitor` wraps SSE bodies to close them on daemon reconnect. A bridge
  `dispose()` that ends its sessions is requested upstream; adopt it when available.
- `@mokei/flow-host`'s `watcher.ts` uses a local sleep; switch to `@sozai/async`.

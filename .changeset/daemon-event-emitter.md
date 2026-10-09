---
'@mokei/host-protocol': patch
'@mokei/host-node': patch
'mokei': patch
---

`serveHostDaemon` takes `events` as a typed `EventEmitter<HostEvents>` from `@sozai/event` instead of an `EventTarget` carrying `CustomEvent`s. `HostEvents` maps each `HostEvent` type to its payload without `type`. Producers call `events.fire(type, payload)`, and payload building is skipped through `events.listenerCount(type)` when nobody subscribes. Messages on the `events` stream are unchanged.

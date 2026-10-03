# Mokei Host protocol

`@mokei/host-protocol` defines the typed procedures and events used by Mokei hosts and clients.
Flow procedures cover flow definitions, runs, traces and pending inbox items.

## Installation

```sh
npm install @mokei/host-protocol
```

## Monitor procedures

The monitor procedure group contains `monitor.attach` and `monitor.presence`. An attachment
registers a monitor server with the daemon for the lifetime of its stream. The daemon validates
that the supplied URL is an HTTP loopback URL with a port and root path.

Each browser tab opens a presence channel using its attachment ID. It reports visibility,
notification permission and the item currently open. The daemon pings tabs before relying on
their state. Tabs acknowledge notification and prompt attempts, and can receive withdrawals
when a delivery is no longer needed. Ping and acknowledgement replies expire after five seconds.

The daemon reserves `monitor.attach` for the monitor process. Browser sessions cannot register
attachments.

See the [flow service guide](../flow-host-node/README.md#monitor-surface) for routing behaviour.

## [Documentation](https://mokei.dev)

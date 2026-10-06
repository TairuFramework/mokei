# Mokei Host monitor

`@mokei/host-monitor` serves the browser monitor for a Mokei flow daemon. The monitor provides
run and trace inspection, inbox actions, flow validation and run start/cancel controls.

## Installation

```sh
npm install @mokei/host-monitor
```

## Monitor server

`startMonitor()` serves the monitor UI over HTTP and connects it to the daemon. It returns the
monitor URL with a trailing slash. The daemon only registers a monitor URL that is a loopback root
URL (`http://127.0.0.1:<port>/`). Browser requests allow either `127.0.0.1` or `localhost` with the listening port and HTTP scheme.

The monitor process registers with the daemon for as long as its attachment stream remains open.
Each page receives a token. The bridge stamps presence requests with its current attachment ID.
A browser page can report its visibility and
notification permission, answer liveness checks, and receive inbox notifications or prompts.
Browser sessions cannot create daemon monitor attachments.

When the daemon restarts, the monitor server reconnects and attaches again. Open browser streams
close so pages can reconnect through the new bridge and its current attachment. A page that reconnects reads
the current flow and inbox state. Events are live and do not replay missed changes.

See the [flow service guide](../flow-host-node/README.md#monitor-surface) for delivery and
fallback behaviour.

## [Documentation](https://mokei.dev)

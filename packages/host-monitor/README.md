# Mokei Host monitor

`@mokei/host-monitor` serves the browser monitor for a Mokei flow daemon. The monitor provides
run and trace inspection, inbox actions, flow validation and run start/cancel controls.

## Installation

```sh
npm install @mokei/host-monitor
```

## Monitor server

`startMonitor()` serves the monitor UI over HTTP and connects it to the daemon. It returns the
monitor URL with a trailing slash. The daemon accepts monitor connections only from the local
loopback address. Browser requests include the monitor's allowed origin.

The monitor process registers with the daemon for as long as its attachment stream remains open.
Each page receives a token and attachment ID. A browser page can report its visibility and
notification permission, answer liveness checks, and receive inbox notifications or prompts.
Browser sessions cannot create daemon monitor attachments.

When the daemon restarts, the monitor server reconnects and attaches again. Open browser streams
close so pages can reconnect with the current page configuration. A page that reconnects reads
the current flow and inbox state; events are live and do not replay missed changes.

See the [flow service guide](../flow-host-node/README.md#monitor-surface) for delivery and
fallback behaviour.

## [Documentation](https://mokei.dev)

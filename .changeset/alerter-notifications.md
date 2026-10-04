---
'@mokei/host-desktop': patch
'@mokei/flow-host-node': patch
'mokei': patch
---

On macOS, desktop notifications now prefer `alerter`, falling back to `osascript`, whose notifications open Script Editor when clicked. `createDesktopNotifier().notify(message, { signal, group, onClick })` reports a click on an `alerter` notification, groups notifications, and removes a live one when `signal` aborts or the notifier is disposed. The flow daemon opens an inbox item's desktop prompt when its notification is clicked, and removes the notification once the item settles.

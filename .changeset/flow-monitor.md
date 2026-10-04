---
'@mokei/host-protocol': patch
'@mokei/flow-client': patch
'@mokei/host-node': patch
'@mokei/host-desktop': patch
'@mokei/flow-host-node': patch
'@mokei/host-monitor': patch
'mokei': patch
---

Add the browser flow monitor with run and inbox pages, tab presence, notification delivery and prompt routing with native fallback. Treat socket errors from a daemon restart (such as `EPIPE`) as a lost connection, so `--wait` keeps following the run.

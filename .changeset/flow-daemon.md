---
'@mokei/host-protocol': patch
'@mokei/host-node': patch
'@mokei/flow-host': patch
'@mokei/flow-host-node': patch
'@mokei/host-desktop': patch
'mokei': patch
---

Compose one durable flow service into the per-user daemon with flow, run and inbox procedures,
shared live events, startup recovery and safe resource shutdown. Add opt-in desktop notifications
and explicitly requested inbox dialogs while preserving proxy serving after flow startup failures.

Publication requires the upstream Enkaku protocol schema rebasing fix and adoption documented in
`docs/agents/plans/next/2026-10-02-enkaku-protocol-schema-rebasing.md`; the workspace patch is not
propagated to published consumers.

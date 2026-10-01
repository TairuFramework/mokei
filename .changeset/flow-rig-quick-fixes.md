---
'@mokei/host-desktop': patch
'@mokei/system-one-client': patch
'@mokei/mcp-system-one': patch
'@mokei/decision-flow-server': patch
---

`InputInbox.prompt` accepts an optional `{ signal }` and closes its dialogs when aborted. The System One request `model` is optional and omitted when unset. System One tool error results carry `_meta['dev.mokei/system-one-error']`, which the decision-flow predictor uses to rebuild the typed error. `run_flow` defaults a missing `input` to `{}`. Over MCP, predictor rate-limit and overloaded errors now keep their types, so they drive a decide node's retry policy and its `lastFailure.type`.

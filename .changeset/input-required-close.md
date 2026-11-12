---
"@mokei/context-client": patch
---

Settle input-required flows when the client closes. Disposing the client (including `ContextHost.remove`) or losing its transport now aborts the signal passed to a waiting `elicit`, `createMessage` or `listRoots` handler and rejects the pending request with `TransportClosedError`, even if the handler ignores its signal.

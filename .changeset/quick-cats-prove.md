---
"@mokei/context-client": patch
"@mokei/context-protocol": patch
"@mokei/context-server": patch
"@mokei/host": patch
---

Resolve MRTR (SEP-2322) follow-ups: type allowInputRequired on callTool/getPrompt/readResource so opting in widens the return to include InputRequiredResult; reject an empty inputRequests map on 2026-07-28; export a shared defaultMintRequestState; freeze requestState hooks at construction.

---
"@mokei/http-client": patch
---

`NetworkError` now redacts every URL form (`https:host/path`, `data:`) from its message and sanitized cause, and only keeps standard error names.

---
"@mokei/openai-provider": patch
---

Send streamed tool calls back with their full arguments. A server that streams a tool call's arguments in several chunks (llama.cpp with LFM3, for one) got only the first chunk back in the next request's history and rejected it; the aggregated call's `raw` now carries the accumulated arguments, and the streamed parts are no longer mutated.

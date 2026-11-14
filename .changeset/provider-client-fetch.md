---
"@mokei/openai-provider": patch
"@mokei/anthropic-provider": patch
"@mokei/ollama-provider": patch
---

Accept a `fetch` implementation in the OpenAI, Anthropic and Ollama client params, used for every request (for example one that rejects redirects). Defaults to the global fetch.

`AnthropicClient.listModels()` accepts `afterID` and `limit`, and `AnthropicProvider.listModels()` follows pagination to return every model.

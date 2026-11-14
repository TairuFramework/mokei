---
"@mokei/openai-provider": minor
"@mokei/anthropic-provider": minor
"@mokei/ollama-provider": minor
---

Accept a `fetch` implementation in the OpenAI, Anthropic and Ollama client params, used for every request (for example one that rejects redirects). Defaults to the global fetch.

`AnthropicClient.listModels()` accepts `afterID` and `limit`, and `AnthropicProvider.listModels()` follows pagination to return every model.

# 2026-02 Archive Summary

## Plans Completed

- **llama-provider** (2026-02-03, complete) -- Added `@mokei/llama-provider` package integrating node-llama-cpp as a ModelProvider for local GGUF model inference. Includes model registry, lazy loading, context management, streamChat with tool calling, embeddings, and model file management (download/delete/inspect).

- **streamable-http-transport** (2026-02-04, complete) -- Added `@mokei/http-client` and `@mokei/http-server` packages implementing MCP Streamable HTTP transport. Client: POST/SSE/GET with session ID lifecycle and auth options. Server: framework-agnostic handler with session management, SSE streaming, and resumability. Replaced the old `packages/host/src/http-transport.ts` with the new `@mokei/http-client` dependency.

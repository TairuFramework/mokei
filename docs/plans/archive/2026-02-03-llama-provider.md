# node-llama-cpp Provider

**Status:** complete

## Summary

Added `@mokei/llama-provider` package integrating [node-llama-cpp](https://node-llama-cpp.withcat.ai/) as a `ModelProvider` for local GGUF model inference.

### What was built

- **Package**: `@mokei/llama-provider` with `node-llama-cpp` as a peer dependency
- **Model registry**: Name-to-path mapping provided at construction, drives `listModels()`
- **Lazy loading**: `getLlama()` → `loadModel()` → `createContext()` chain, each cached
- **Context management**: Shared context per model by default, with `createContext()`/`disposeContext()` for manual control and `streamChat` overrides (`context`, `newContext`)
- **streamChat**: Streams text deltas via `onTextChunk`, adapts tool calling to Mokei's `tool-call` message part pattern rather than using node-llama-cpp's native function execution
- **Embeddings**: Lazy `LlamaEmbeddingContext` per model, unified registry for chat and embedding models
- **Model file management**: `downloadModel()` (HuggingFace URIs via `createModelDownloader`), `deleteModel()` (full cleanup chain), `inspectRemoteModel()` (metadata via `readGgufFileInfo`)
- **Resource lifecycle**: Extends `Disposer` from `@enkaku/async`, `dispose()` frees all contexts → models → llama engine

### Electron considerations (documented, no code)

- Main process only (not renderer)
- Native binaries outside asar archive
- No cross-compilation
- Worker offloading is consumer responsibility

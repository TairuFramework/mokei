# node-llama-cpp Provider Design

Add a `llama-provider` package that integrates [node-llama-cpp](https://node-llama-cpp.withcat.ai/) as a `ModelProvider`, enabling local GGUF model inference alongside the existing OpenAI, Anthropic, and Ollama providers.

## Package Structure

```
packages/llama-provider/
├── src/
│   ├── provider.ts    # LlamaProvider implementing ModelProvider
│   ├── types.ts       # LlamaTypes, message parts, tool calls
│   └── config.ts      # Configuration schema and validation
├── package.json
└── tsconfig.json
```

`node-llama-cpp` is a **peer dependency** -- users install it and their own GGUF models.

## Configuration & Model Registry

```typescript
type LlamaModelConfig = {
  path: string              // Path to .gguf file
  contextSize?: number      // Default context size (defaults to model's trained size)
  gpu?: boolean | 'auto'    // GPU offloading preference
}

type LlamaConfiguration = {
  models: Record<string, LlamaModelConfig>
}
```

Usage:

```typescript
const provider = LlamaProvider.fromConfig({
  models: {
    'llama-3.2': { path: '/models/llama-3.2-3b-Q4_K_M.gguf' },
    'qwen-coder': { path: '/models/qwen-2.5-coder-7b.gguf', contextSize: 8192 },
    'nomic-embed': { path: '/models/nomic-embed-text-v1.5.gguf' },
  }
})
```

`listModels()` returns the registry keys as model IDs. Models and contexts are loaded lazily on first use -- constructing the provider is cheap.

The `fromConfig` factory validates with the same `assertType` pattern used by the other providers.

## Context Management & Resource Lifecycle

`LlamaProvider` extends `Disposer` and manages native resources (GPU memory, model weights).

```typescript
class LlamaProvider extends Disposer implements ModelProvider<LlamaTypes> {
  #llama: Llama | null
  #models: Map<string, LlamaModel>
  #defaultContexts: Map<string, LlamaContext>
  #managedContexts: Set<LlamaContext>

  // Get or lazily create the shared context for a model
  async getContext(model: string): Promise<LlamaContext>

  // Create a new independent context for a model
  async createContext(model: string, options?: { contextSize?: number }): Promise<LlamaContext>

  // Dispose a specific context and remove from tracking
  async disposeContext(context: LlamaContext): Promise<void>

  // Dispose everything: all contexts, all models, the llama engine
  async dispose(): Promise<void>
}
```

The lazy loading chain is: `getLlama()` → `loadModel()` → `createContext()`, each cached at its level. `dispose()` walks the chain in reverse, freeing contexts first, then models, then the engine.

All contexts created via `createContext()` are tracked in `#managedContexts` so `dispose()` can clean up everything, including contexts the user created but forgot to dispose.

The default is **one shared context per model**. `streamChat` accepts optional overrides:

- `context` -- use a specific pre-created context
- `newContext` -- create a fresh context for this call

## streamChat & Message Transformation

```typescript
streamChat(params: StreamChatParams<Message, ToolCall, Tool> & {
  context?: LlamaContext
  newContext?: boolean
}) {
  // 1. Resolve context: params.context > newContext > getContext(model)
  // 2. Create LlamaChatSession from context
  // 3. Convert Mokei messages to node-llama-cpp format
  // 4. Call session.prompt() with streaming enabled
  // 5. Pipe through TransformStream emitting unified MessagePart types:
  //    - 'text-delta' for text chunks
  //    - 'tool-call' when model requests a tool
  //    - 'done' with token counts on completion
  // 6. Return AbortController & Promise<ReadableStream>
}
```

Tool calling is adapted to Mokei's pattern: rather than letting node-llama-cpp execute tools internally, the provider uses grammar/JSON schema constraints to detect tool-call intent, emits `tool-call` message parts, and lets the Session/AgentSession layer handle execution and result feeding.

`toolFromMCP()` converts MCP tools to the OpenAI-style function format (same as Ollama provider).

`aggregateMessage()` follows the same accumulation pattern as the other providers -- concatenate text deltas, collect tool calls, sum token counts.

## Embeddings

```typescript
async embed(params: EmbedParams): Promise<EmbedResponse> {
  // 1. Load model lazily (same as chat)
  // 2. Create or reuse a LlamaEmbeddingContext for the model
  // 3. Call embeddingContext.getEmbeddingFor(params.input)
  // 4. Return { embeddings: [...] }
}
```

Embedding contexts (`LlamaEmbeddingContext`) are tracked separately from chat contexts since they're a different type in node-llama-cpp. They follow the same lazy-create-and-cache pattern and are cleaned up by `dispose()`.

The model registry is unified -- chat and embedding models live in the same `models` config. The user is responsible for passing the right model name to the right method.

## Model File Management

```typescript
class LlamaProvider {
  // Download a model from HuggingFace (or any supported URI)
  // Registers it in the model registry under the given name
  async downloadModel(
    name: string,
    uri: string,  // e.g. "hf:meta-llama/Llama-3.2-3B-GGUF:Q4_K_M"
    options?: {
      contextSize?: number
      gpu?: boolean | 'auto'
      onProgress?: (progress: {
        downloaded: number
        total: number
        percent: number
      }) => void
    }
  ): Promise<LlamaModelConfig>

  // Delete model file(s) from disk and remove from registry
  // Disposes any loaded contexts/model first
  async deleteModel(name: string): Promise<void>

  // Inspect a remote model's metadata without downloading
  async inspectRemoteModel(uri: string): Promise<GgufFileInfo>
}
```

Uses node-llama-cpp's `createModelDownloader` for download with progress callbacks, and `readGgufFileInfo` for remote inspection. `deleteModel` handles the full cleanup chain: dispose contexts → unload model → delete file(s) → remove from registry.

## Electron Notes

The provider itself has no Electron-specific code. The following constraints apply at the application level:

- **Main process only** -- node-llama-cpp cannot run in Electron's renderer process.
- **Asar packaging** -- Native binaries must remain outside the asar archive.
- **No cross-compilation** -- Packaging must happen on the target platform/architecture.
- **Worker offloading** -- If blocking the main process is a concern, the consumer is responsible for running the provider in a worker thread and proxying calls.

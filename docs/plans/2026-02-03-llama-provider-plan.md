# node-llama-cpp Provider Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a `@mokei/llama-provider` package that wraps node-llama-cpp as a `ModelProvider`, enabling local GGUF model inference with model registry, context management, and model file management.

**Architecture:** The provider follows the same pattern as `@mokei/ollama-provider` -- a `LlamaProvider` class implementing `ModelProvider<LlamaTypes>` with a `fromConfig` factory. Unlike other providers (which wrap HTTP APIs), this one wraps node-llama-cpp's in-process native bindings. Models are registered by name in a config registry, loaded lazily, and contexts are shared by default. The provider extends `Disposer` (from `@enkaku/async`) to manage native resource cleanup.

**Tech Stack:** TypeScript, node-llama-cpp (peer dep), `@enkaku/schema` (validation), `@enkaku/async` (Disposer), Vitest (testing), SWC (compilation)

**Design doc:** `docs/plans/2026-02-03-llama-provider-design.md`

---

### Task 1: Package Scaffolding

**Files:**
- Create: `packages/llama-provider/package.json`
- Create: `packages/llama-provider/tsconfig.json`
- Create: `packages/llama-provider/src/index.ts`

**Step 1: Create package.json**

Create `packages/llama-provider/package.json`:

```json
{
  "name": "@mokei/llama-provider",
  "version": "0.5.0",
  "license": "MIT",
  "homepage": "https://mokei.dev",
  "description": "Mokei node-llama-cpp provider",
  "keywords": [
    "model",
    "context",
    "protocol",
    "mcp",
    "llm",
    "ai",
    "llama",
    "gguf"
  ],
  "repository": {
    "type": "git",
    "url": "https://github.com/TairuFramework/mokei",
    "directory": "packages/llama-provider"
  },
  "type": "module",
  "main": "lib/index.js",
  "types": "lib/index.d.ts",
  "exports": {
    ".": "./lib/index.js"
  },
  "files": [
    "lib/*"
  ],
  "sideEffects": false,
  "scripts": {
    "build:clean": "del lib",
    "build:js": "swc src -d ./lib --config-file ../../swc.json --strip-leading-paths",
    "build:types": "tsc --emitDeclarationOnly --skipLibCheck",
    "build:types:ci": "tsc --emitDeclarationOnly --skipLibCheck --declarationMap false",
    "build": "pnpm run build:clean && pnpm run build:js && pnpm run build:types",
    "test:types": "tsc --noEmit --skipLibCheck",
    "test:unit": "vitest run",
    "test": "pnpm run test:types && pnpm run test:unit",
    "prepublishOnly": "pnpm run build"
  },
  "dependencies": {
    "@enkaku/async": "catalog:",
    "@enkaku/schema": "catalog:"
  },
  "devDependencies": {
    "@mokei/context-protocol": "workspace:^",
    "@mokei/model-provider": "workspace:^"
  },
  "peerDependencies": {
    "node-llama-cpp": ">=3.0.0"
  },
  "peerDependenciesMeta": {
    "node-llama-cpp": {
      "optional": false
    }
  }
}
```

**Step 2: Create tsconfig.json**

Create `packages/llama-provider/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.build.json",
  "compilerOptions": {
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "./lib"
  },
  "include": ["./src/**/*"]
}
```

**Step 3: Create barrel export**

Create `packages/llama-provider/src/index.ts`:

```typescript
/**
 * Mokei node-llama-cpp provider.
 *
 * ## Installation
 *
 * ```sh
 * npm install @mokei/llama-provider node-llama-cpp
 * ```
 *
 * @module llama-provider
 */

export { type LlamaConfiguration, type LlamaModelConfig } from './config.js'
export { LlamaProvider, type LlamaProviderParams, type LlamaTypes } from './provider.js'
export type * from './types.js'
```

Note: this file will be updated as we add exports. For now the imports will have errors -- that's expected.

**Step 4: Install dependencies and verify workspace**

Run: `cd /Users/paul/dev/yulsi/mokei && pnpm install`
Expected: Successful install, `@mokei/llama-provider` appears in workspace

**Step 5: Commit**

```bash
git add packages/llama-provider/
git commit -m "feat(llama-provider): scaffold package"
```

---

### Task 2: Configuration & Types

**Files:**
- Create: `packages/llama-provider/src/config.ts`
- Create: `packages/llama-provider/src/types.ts`
- Create: `packages/llama-provider/test/config.test.ts`

**Step 1: Write the config test**

Create `packages/llama-provider/test/config.test.ts`:

```typescript
import { describe, expect, test } from 'vitest'

import { validateConfiguration, type LlamaConfiguration } from '../src/config.js'

describe('validateConfiguration', () => {
  test('accepts valid config with models', () => {
    const config: LlamaConfiguration = {
      models: {
        'llama-3.2': { path: '/models/llama-3.2-3b.gguf' },
      },
    }
    const result = validateConfiguration(config)
    expect(result.issues).toBeUndefined()
  })

  test('accepts model with all options', () => {
    const config: LlamaConfiguration = {
      models: {
        'llama-3.2': {
          path: '/models/llama-3.2-3b.gguf',
          contextSize: 4096,
          gpu: 'auto',
        },
      },
    }
    const result = validateConfiguration(config)
    expect(result.issues).toBeUndefined()
  })

  test('accepts gpu as boolean', () => {
    const config: LlamaConfiguration = {
      models: {
        test: { path: '/models/test.gguf', gpu: true },
      },
    }
    const result = validateConfiguration(config)
    expect(result.issues).toBeUndefined()
  })

  test('accepts empty models', () => {
    const config: LlamaConfiguration = { models: {} }
    const result = validateConfiguration(config)
    expect(result.issues).toBeUndefined()
  })

  test('rejects config without models', () => {
    const result = validateConfiguration({})
    expect(result.issues).toBeDefined()
  })

  test('rejects model without path', () => {
    const result = validateConfiguration({ models: { test: {} } })
    expect(result.issues).toBeDefined()
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/paul/dev/yulsi/mokei && pnpm vitest run packages/llama-provider/test/config.test.ts`
Expected: FAIL -- module not found

**Step 3: Write config.ts**

Create `packages/llama-provider/src/config.ts`:

```typescript
import { createValidator, type FromSchema, type Schema } from '@enkaku/schema'

const llamaModelConfigSchema = {
  type: 'object',
  properties: {
    path: { type: 'string', description: 'Path to .gguf model file' },
    contextSize: { type: 'integer', minimum: 1, description: 'Default context size' },
    gpu: {
      anyOf: [
        { type: 'boolean' },
        { type: 'string', const: 'auto' },
      ],
      description: 'GPU offloading preference',
    },
  },
  required: ['path'],
  additionalProperties: false,
} as const satisfies Schema

export type LlamaModelConfig = FromSchema<typeof llamaModelConfigSchema>

export const configurationSchema = {
  type: 'object',
  properties: {
    models: {
      type: 'object',
      additionalProperties: llamaModelConfigSchema,
      description: 'Model name to configuration mapping',
    },
  },
  required: ['models'],
  additionalProperties: false,
} as const satisfies Schema

export type LlamaConfiguration = FromSchema<typeof configurationSchema>

export const validateConfiguration = createValidator(configurationSchema)
```

**Step 4: Write types.ts**

Create `packages/llama-provider/src/types.ts`:

```typescript
export type ToolCallFunction = {
  name: string
  arguments: Record<string, unknown>
}

export type ToolCall = {
  function: ToolCallFunction
}

export type Message = {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content?: string
  tool_calls?: Array<ToolCall>
}

export type ToolFunction = {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export type Tool = {
  type: string
  function: ToolFunction
}

export type ModelInfo = {
  name: string
  path: string
}

export type ChatResponseChunk = {
  text?: string
  toolCalls?: Array<ToolCall>
  done: boolean
  inputTokens?: number
  outputTokens?: number
}
```

**Step 5: Run test to verify it passes**

Run: `cd /Users/paul/dev/yulsi/mokei && pnpm vitest run packages/llama-provider/test/config.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add packages/llama-provider/src/config.ts packages/llama-provider/src/types.ts packages/llama-provider/test/config.test.ts
git commit -m "feat(llama-provider): add configuration schema and types"
```

---

### Task 3: Provider Core -- Construction, listModels, toolFromMCP, aggregateMessage

**Files:**
- Create: `packages/llama-provider/src/provider.ts`
- Create: `packages/llama-provider/test/provider.test.ts`

These are the methods that don't require a running node-llama-cpp instance and can be tested with mocks.

**Step 1: Write the provider test**

Create `packages/llama-provider/test/provider.test.ts`:

```typescript
import type { Tool as ContextTool } from '@mokei/context-protocol'
import type { ServerMessage } from '@mokei/model-provider'
import { describe, expect, test } from 'vitest'

import { LlamaProvider } from '../src/provider.js'
import type { ChatResponseChunk, ToolCall } from '../src/types.js'

describe('LlamaProvider', () => {
  describe('fromConfig', () => {
    test('creates provider from valid config', () => {
      const provider = LlamaProvider.fromConfig({
        models: {
          'test-model': { path: '/models/test.gguf' },
        },
      })
      expect(provider).toBeInstanceOf(LlamaProvider)
    })

    test('creates provider with full model options', () => {
      const provider = LlamaProvider.fromConfig({
        models: {
          'test-model': { path: '/models/test.gguf', contextSize: 4096, gpu: 'auto' },
        },
      })
      expect(provider).toBeInstanceOf(LlamaProvider)
    })
  })

  describe('constructor', () => {
    test('accepts model registry', () => {
      const provider = new LlamaProvider({
        models: {
          'test-model': { path: '/models/test.gguf' },
        },
      })
      expect(provider).toBeInstanceOf(LlamaProvider)
    })

    test('defaults to empty model registry', () => {
      const provider = new LlamaProvider()
      expect(provider).toBeInstanceOf(LlamaProvider)
    })
  })

  describe('listModels', () => {
    test('returns registered models', async () => {
      const provider = new LlamaProvider({
        models: {
          'llama-3.2': { path: '/models/llama.gguf' },
          'qwen-coder': { path: '/models/qwen.gguf' },
        },
      })
      const models = await provider.listModels()
      expect(models).toHaveLength(2)
      expect(models.map((m) => m.id)).toEqual(['llama-3.2', 'qwen-coder'])
    })

    test('returns empty list when no models registered', async () => {
      const provider = new LlamaProvider()
      const models = await provider.listModels()
      expect(models).toHaveLength(0)
    })

    test('includes model info as raw', async () => {
      const provider = new LlamaProvider({
        models: {
          'test-model': { path: '/models/test.gguf' },
        },
      })
      const models = await provider.listModels()
      expect(models[0].raw).toEqual({ name: 'test-model', path: '/models/test.gguf' })
    })
  })

  describe('toolFromMCP', () => {
    test('converts MCP tool to function tool format', () => {
      const provider = new LlamaProvider()

      const mcpTool: ContextTool = {
        name: 'query_database',
        description: 'Query the database',
        inputSchema: {
          type: 'object',
          properties: {
            sql: { type: 'string', description: 'SQL query' },
          },
          required: ['sql'],
        },
      }

      const tool = provider.toolFromMCP(mcpTool)

      expect(tool).toEqual({
        type: 'function',
        function: {
          name: 'query_database',
          description: 'Query the database',
          parameters: {
            type: 'object',
            properties: {
              sql: { type: 'string', description: 'SQL query' },
            },
            required: ['sql'],
          },
        },
      })
    })

    test('handles tool without description', () => {
      const provider = new LlamaProvider()

      const mcpTool: ContextTool = {
        name: 'simple_tool',
        inputSchema: { type: 'object' },
      }

      const tool = provider.toolFromMCP(mcpTool)
      expect(tool.function.description).toBe('')
    })
  })

  describe('aggregateMessage', () => {
    test('aggregates text parts', () => {
      const provider = new LlamaProvider()

      const parts: Array<ServerMessage<ChatResponseChunk, ToolCall>> = [
        { source: 'server', role: 'assistant', text: 'Hello', raw: {} as ChatResponseChunk },
        { source: 'server', role: 'assistant', text: ' World', raw: {} as ChatResponseChunk },
        {
          source: 'server',
          role: 'assistant',
          inputTokens: 10,
          outputTokens: 5,
          raw: {} as ChatResponseChunk,
        },
      ]

      const result = provider.aggregateMessage(parts)

      expect(result.text).toBe('Hello World')
      expect(result.role).toBe('assistant')
      expect(result.source).toBe('aggregated')
      expect(result.inputTokens).toBe(10)
      expect(result.outputTokens).toBe(5)
    })

    test('aggregates tool calls', () => {
      const provider = new LlamaProvider()

      const toolCall: ToolCall = { function: { name: 'get_weather', arguments: { city: 'London' } } }

      const parts: Array<ServerMessage<ChatResponseChunk, ToolCall>> = [
        { source: 'server', role: 'assistant', text: 'Let me check', raw: {} as ChatResponseChunk },
        {
          source: 'server',
          role: 'assistant',
          toolCalls: [
            { id: 'call-1', name: 'get_weather', arguments: '{"city":"London"}', raw: toolCall },
          ],
          raw: {} as ChatResponseChunk,
        },
      ]

      const result = provider.aggregateMessage(parts)

      expect(result.text).toBe('Let me check')
      expect(result.toolCalls).toHaveLength(1)
      expect(result.toolCalls[0].name).toBe('get_weather')
    })

    test('handles done reason', () => {
      const provider = new LlamaProvider()

      const parts: Array<ServerMessage<ChatResponseChunk, ToolCall>> = [
        { source: 'server', role: 'assistant', text: 'Done', raw: {} as ChatResponseChunk },
        {
          source: 'server',
          role: 'assistant',
          doneReason: 'stop',
          raw: {} as ChatResponseChunk,
        },
      ]

      const result = provider.aggregateMessage(parts)
      expect(result.doneReason).toBe('stop')
    })
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/paul/dev/yulsi/mokei && pnpm vitest run packages/llama-provider/test/provider.test.ts`
Expected: FAIL -- module not found

**Step 3: Write provider.ts (core methods only)**

Create `packages/llama-provider/src/provider.ts`:

```typescript
import { Disposer } from '@enkaku/async'
import { assertType } from '@enkaku/schema'
import type { Tool as ContextTool } from '@mokei/context-protocol'
import type {
  AggregatedMessage,
  EmbedParams,
  EmbedResponse,
  FunctionToolCall,
  MessagePart,
  Model,
  ModelProvider,
  RequestParams,
  ServerMessage,
  StreamChatParams,
  StreamChatRequest,
} from '@mokei/model-provider'

import {
  type LlamaConfiguration,
  type LlamaModelConfig,
  validateConfiguration,
} from './config.js'
import type { ChatResponseChunk, Message, ModelInfo, Tool, ToolCall } from './types.js'

export type LlamaTypes = {
  Message: Message
  MessagePart: ChatResponseChunk
  Model: ModelInfo
  Tool: Tool
  ToolCall: ToolCall
}

export type LlamaProviderParams = {
  models?: Record<string, LlamaModelConfig>
}

export class LlamaProvider extends Disposer implements ModelProvider<LlamaTypes> {
  static fromConfig(config: LlamaConfiguration): LlamaProvider {
    assertType(validateConfiguration, config)
    return new LlamaProvider({ models: config.models })
  }

  #registry: Map<string, LlamaModelConfig>

  constructor(params: LlamaProviderParams = {}) {
    super({
      dispose: async () => {
        await this.#disposeAll()
      },
    })
    this.#registry = new Map(Object.entries(params.models ?? {}))
  }

  async #disposeAll(): Promise<void> {
    // Will be implemented in Task 4 (context management)
  }

  async listModels(_params?: RequestParams): Promise<Array<Model<ModelInfo>>> {
    return Array.from(this.#registry.entries()).map(([name, config]) => ({
      id: name,
      raw: { name, path: config.path },
    }))
  }

  async embed(_params: EmbedParams): Promise<EmbedResponse> {
    // Will be implemented in Task 6 (embeddings)
    throw new Error('Not implemented')
  }

  streamChat(
    _params: StreamChatParams<Message, ToolCall, Tool>,
  ): StreamChatRequest<ChatResponseChunk, ToolCall> {
    // Will be implemented in Task 5 (streamChat)
    throw new Error('Not implemented')
  }

  aggregateMessage(
    parts: Array<ServerMessage<ChatResponseChunk, ToolCall>>,
  ): AggregatedMessage<ToolCall> {
    let text = ''
    let reasoning = ''
    let toolCalls: Array<FunctionToolCall<ToolCall>> = []
    let inputTokens = 0
    let outputTokens = 0
    let doneReason: string | undefined
    for (const part of parts) {
      if (part.text != null) {
        text += part.text
      }
      if (part.reasoning != null) {
        reasoning += part.reasoning
      }
      if (part.toolCalls != null) {
        toolCalls = toolCalls.concat(part.toolCalls)
      }
      if (part.doneReason != null) {
        doneReason = part.doneReason
      }
      if (part.inputTokens != null) {
        inputTokens += part.inputTokens
      }
      if (part.outputTokens != null) {
        outputTokens += part.outputTokens
      }
    }
    return {
      source: 'aggregated',
      role: 'assistant',
      text,
      reasoning,
      toolCalls,
      doneReason,
      inputTokens,
      outputTokens,
    }
  }

  toolFromMCP(tool: ContextTool): Tool {
    return {
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description ?? '',
        parameters: tool.inputSchema,
      },
    } as Tool
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/paul/dev/yulsi/mokei && pnpm vitest run packages/llama-provider/test/provider.test.ts`
Expected: PASS

**Step 5: Verify types compile**

Run: `cd /Users/paul/dev/yulsi/mokei/packages/llama-provider && pnpm run test:types`
Expected: PASS (no type errors)

**Step 6: Commit**

```bash
git add packages/llama-provider/src/provider.ts packages/llama-provider/src/index.ts packages/llama-provider/test/provider.test.ts
git commit -m "feat(llama-provider): add provider core with listModels, toolFromMCP, aggregateMessage"
```

---

### Task 4: Context Management (Lazy Loading, Shared Contexts, Disposal)

**Files:**
- Modify: `packages/llama-provider/src/provider.ts`
- Create: `packages/llama-provider/test/context.test.ts`

This task adds the lazy loading chain (`getLlama()` → `loadModel()` → `createContext()`) and disposal. Tests mock `node-llama-cpp` since we can't load real models in unit tests.

**Step 1: Write the context management test**

Create `packages/llama-provider/test/context.test.ts`:

```typescript
import { describe, expect, test, vi } from 'vitest'

import { LlamaProvider } from '../src/provider.js'

// Mock node-llama-cpp
const mockDispose = vi.fn().mockResolvedValue(undefined)
const mockCreateContext = vi.fn().mockResolvedValue({
  dispose: mockDispose,
  disposed: false,
  contextSize: 4096,
  getSequence: vi.fn(),
  sequencesLeft: 1,
})
const mockCreateEmbeddingContext = vi.fn().mockResolvedValue({
  dispose: mockDispose,
  disposed: false,
  getEmbeddingFor: vi.fn(),
})
const mockModelDispose = vi.fn().mockResolvedValue(undefined)
const mockLoadModel = vi.fn().mockResolvedValue({
  dispose: mockModelDispose,
  disposed: false,
  createContext: mockCreateContext,
  createEmbeddingContext: mockCreateEmbeddingContext,
  trainContextSize: 4096,
})
const mockLlamaDispose = vi.fn().mockResolvedValue(undefined)

vi.mock('node-llama-cpp', () => ({
  getLlama: vi.fn().mockResolvedValue({
    loadModel: mockLoadModel,
    dispose: mockLlamaDispose,
  }),
}))

describe('LlamaProvider context management', () => {
  test('getContext lazily loads model and creates context', async () => {
    const provider = new LlamaProvider({
      models: { 'test-model': { path: '/models/test.gguf' } },
    })

    const context = await provider.getContext('test-model')
    expect(context).toBeDefined()
    expect(mockLoadModel).toHaveBeenCalledTimes(1)
    expect(mockCreateContext).toHaveBeenCalledTimes(1)
  })

  test('getContext returns same context on second call', async () => {
    const provider = new LlamaProvider({
      models: { 'test-model': { path: '/models/test.gguf' } },
    })

    const ctx1 = await provider.getContext('test-model')
    const ctx2 = await provider.getContext('test-model')
    expect(ctx1).toBe(ctx2)
    expect(mockCreateContext).toHaveBeenCalledTimes(1)
  })

  test('getContext throws for unknown model', async () => {
    const provider = new LlamaProvider({
      models: { 'test-model': { path: '/models/test.gguf' } },
    })

    await expect(provider.getContext('unknown')).rejects.toThrow(
      'Model "unknown" is not registered',
    )
  })

  test('createContext creates a new independent context', async () => {
    const provider = new LlamaProvider({
      models: { 'test-model': { path: '/models/test.gguf' } },
    })

    const ctx1 = await provider.createContext('test-model')
    const ctx2 = await provider.createContext('test-model')
    // Two separate createContext calls
    expect(mockCreateContext).toHaveBeenCalledTimes(2)
  })

  test('disposeContext disposes and untracks context', async () => {
    const disposeFn = vi.fn().mockResolvedValue(undefined)
    mockCreateContext.mockResolvedValueOnce({
      dispose: disposeFn,
      disposed: false,
      contextSize: 4096,
      getSequence: vi.fn(),
      sequencesLeft: 1,
    })

    const provider = new LlamaProvider({
      models: { 'test-model': { path: '/models/test.gguf' } },
    })

    const ctx = await provider.createContext('test-model')
    await provider.disposeContext(ctx)
    expect(disposeFn).toHaveBeenCalledTimes(1)
  })

  test('dispose cleans up all resources', async () => {
    const provider = new LlamaProvider({
      models: { 'test-model': { path: '/models/test.gguf' } },
    })

    // Load a context to populate caches
    await provider.getContext('test-model')

    // Dispose the provider
    await provider.dispose()

    expect(mockDispose).toHaveBeenCalled()
    expect(mockModelDispose).toHaveBeenCalled()
    expect(mockLlamaDispose).toHaveBeenCalled()
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/paul/dev/yulsi/mokei && pnpm vitest run packages/llama-provider/test/context.test.ts`
Expected: FAIL -- getContext/createContext/disposeContext not defined

**Step 3: Implement context management in provider.ts**

Modify `packages/llama-provider/src/provider.ts` -- add these private fields and methods to the `LlamaProvider` class:

Add imports at the top:
```typescript
import type {
  Llama,
  LlamaContext,
  LlamaEmbeddingContext,
  LlamaModel,
} from 'node-llama-cpp'
```

Add private fields after `#registry`:
```typescript
  #llama: Llama | null = null
  #loadedModels: Map<string, LlamaModel> = new Map()
  #defaultContexts: Map<string, LlamaContext> = new Map()
  #embeddingContexts: Map<string, LlamaEmbeddingContext> = new Map()
  #managedContexts: Set<LlamaContext | LlamaEmbeddingContext> = new Set()
```

Add lazy loading methods:
```typescript
  async #getLlama(): Promise<Llama> {
    if (this.#llama == null) {
      const { getLlama } = await import('node-llama-cpp')
      this.#llama = await getLlama()
    }
    return this.#llama
  }

  async #loadModel(name: string): Promise<LlamaModel> {
    const existing = this.#loadedModels.get(name)
    if (existing != null) {
      return existing
    }
    const config = this.#registry.get(name)
    if (config == null) {
      throw new Error(`Model "${name}" is not registered`)
    }
    const llama = await this.#getLlama()
    const model = await llama.loadModel({ modelPath: config.path })
    this.#loadedModels.set(name, model)
    return model
  }
```

Add public context methods:
```typescript
  async getContext(model: string): Promise<LlamaContext> {
    const existing = this.#defaultContexts.get(model)
    if (existing != null) {
      return existing
    }
    const config = this.#registry.get(model)
    if (config == null) {
      throw new Error(`Model "${model}" is not registered`)
    }
    const loadedModel = await this.#loadModel(model)
    const context = await loadedModel.createContext({
      contextSize: config.contextSize,
    })
    this.#defaultContexts.set(model, context)
    this.#managedContexts.add(context)
    return context
  }

  async createContext(
    model: string,
    options?: { contextSize?: number },
  ): Promise<LlamaContext> {
    const loadedModel = await this.#loadModel(model)
    const context = await loadedModel.createContext({
      contextSize: options?.contextSize,
    })
    this.#managedContexts.add(context)
    return context
  }

  async disposeContext(context: LlamaContext | LlamaEmbeddingContext): Promise<void> {
    this.#managedContexts.delete(context)
    // Remove from default contexts if it was one
    for (const [name, ctx] of this.#defaultContexts) {
      if (ctx === context) {
        this.#defaultContexts.delete(name)
        break
      }
    }
    // Remove from embedding contexts if it was one
    for (const [name, ctx] of this.#embeddingContexts) {
      if (ctx === context) {
        this.#embeddingContexts.delete(name)
        break
      }
    }
    await context.dispose()
  }
```

Replace the `#disposeAll` stub:
```typescript
  async #disposeAll(): Promise<void> {
    // Dispose all managed contexts
    for (const context of this.#managedContexts) {
      await context.dispose()
    }
    this.#managedContexts.clear()
    this.#defaultContexts.clear()
    this.#embeddingContexts.clear()

    // Dispose all loaded models
    for (const model of this.#loadedModels.values()) {
      await model.dispose()
    }
    this.#loadedModels.clear()

    // Dispose llama engine
    if (this.#llama != null) {
      await this.#llama.dispose()
      this.#llama = null
    }
  }
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/paul/dev/yulsi/mokei && pnpm vitest run packages/llama-provider/test/context.test.ts`
Expected: PASS

**Step 5: Verify types compile**

Run: `cd /Users/paul/dev/yulsi/mokei/packages/llama-provider && pnpm run test:types`
Expected: PASS

**Step 6: Commit**

```bash
git add packages/llama-provider/src/provider.ts packages/llama-provider/test/context.test.ts
git commit -m "feat(llama-provider): add context management with lazy loading and disposal"
```

---

### Task 5: streamChat Implementation

**Files:**
- Modify: `packages/llama-provider/src/provider.ts`
- Create: `packages/llama-provider/test/stream-chat.test.ts`

**Step 1: Write the streamChat test**

Create `packages/llama-provider/test/stream-chat.test.ts`:

```typescript
import type { MessagePart } from '@mokei/model-provider'
import { describe, expect, test, vi } from 'vitest'

import { LlamaProvider } from '../src/provider.js'
import type { ChatResponseChunk, ToolCall } from '../src/types.js'

// Mock node-llama-cpp
const mockPromptWithMeta = vi.fn()
const mockChatSession = vi.fn().mockImplementation(() => ({
  promptWithMeta: mockPromptWithMeta,
  dispose: vi.fn(),
}))

const mockGetSequence = vi.fn().mockReturnValue({})
const mockCreateContext = vi.fn().mockResolvedValue({
  dispose: vi.fn().mockResolvedValue(undefined),
  disposed: false,
  contextSize: 4096,
  getSequence: mockGetSequence,
  sequencesLeft: 1,
})
const mockLoadModel = vi.fn().mockResolvedValue({
  dispose: vi.fn().mockResolvedValue(undefined),
  disposed: false,
  createContext: mockCreateContext,
  createEmbeddingContext: vi.fn(),
  trainContextSize: 4096,
})

vi.mock('node-llama-cpp', () => ({
  getLlama: vi.fn().mockResolvedValue({
    loadModel: mockLoadModel,
    dispose: vi.fn().mockResolvedValue(undefined),
  }),
  LlamaChatSession: mockChatSession,
}))

describe('LlamaProvider streamChat', () => {
  test('returns a stream with text deltas and done', async () => {
    // Mock promptWithMeta to call onTextChunk callback and resolve
    mockPromptWithMeta.mockImplementation(async (_prompt: string, options: Record<string, unknown>) => {
      const onTextChunk = options.onTextChunk as (chunk: string) => void
      onTextChunk('Hello')
      onTextChunk(' World')
      return { responseText: 'Hello World' }
    })

    const provider = new LlamaProvider({
      models: { 'test-model': { path: '/models/test.gguf' } },
    })

    const request = provider.streamChat({
      model: 'test-model',
      messages: [{ source: 'client', role: 'user', text: 'Hi' }],
    })

    const stream = await request
    const reader = stream.getReader()
    const parts: Array<MessagePart<ChatResponseChunk, ToolCall>> = []
    let reading = true
    while (reading) {
      const { done, value } = await reader.read()
      if (done) {
        reading = false
      } else {
        parts.push(value)
      }
    }

    expect(parts.some((p) => p.type === 'text-delta')).toBe(true)
    expect(parts.some((p) => p.type === 'done')).toBe(true)

    const textParts = parts.filter((p) => p.type === 'text-delta')
    expect(textParts.map((p) => (p as { text: string }).text).join('')).toBe('Hello World')
  })

  test('supports abort signal', async () => {
    const provider = new LlamaProvider({
      models: { 'test-model': { path: '/models/test.gguf' } },
    })

    const request = provider.streamChat({
      model: 'test-model',
      messages: [{ source: 'client', role: 'user', text: 'Hi' }],
    })

    expect(request.signal).toBeDefined()
    expect(typeof request.abort).toBe('function')
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/paul/dev/yulsi/mokei && pnpm vitest run packages/llama-provider/test/stream-chat.test.ts`
Expected: FAIL -- streamChat throws "Not implemented"

**Step 3: Implement streamChat in provider.ts**

Replace the `streamChat` stub in `packages/llama-provider/src/provider.ts`.

Add import at top:
```typescript
import type { LlamaChatSession as LlamaChatSessionType } from 'node-llama-cpp'
```

Replace `streamChat`:
```typescript
  streamChat(
    params: StreamChatParams<Message, ToolCall, Tool> & {
      context?: LlamaContext
      newContext?: boolean
    },
  ): StreamChatRequest<ChatResponseChunk, ToolCall> {
    const controller = new AbortController()
    const signal = params.signal
      ? AbortSignal.any([params.signal, controller.signal])
      : controller.signal

    const response = (async (): Promise<
      ReadableStream<MessagePart<ChatResponseChunk, ToolCall>>
    > => {
      // Resolve context
      let context: LlamaContext
      if (params.context != null) {
        context = params.context
      } else if (params.newContext === true) {
        context = await this.createContext(params.model)
      } else {
        context = await this.getContext(params.model)
      }

      // Build user prompt from messages
      const lastMessage = params.messages.at(-1)
      const prompt =
        lastMessage != null && lastMessage.source === 'client' && lastMessage.role === 'user'
          ? lastMessage.text
          : ''

      // Create chat session
      const { LlamaChatSession } = await import('node-llama-cpp')
      const sequence = context.getSequence()
      const session = new LlamaChatSession({ contextSequence: sequence })

      // Build function definitions for tool calling if tools provided
      const functions = this.#buildFunctions(params.tools)

      return new ReadableStream<MessagePart<ChatResponseChunk, ToolCall>>({
        start: async (streamController) => {
          try {
            const result = await session.promptWithMeta(prompt, {
              signal,
              stopOnAbortSignal: true,
              functions,
              onTextChunk: (chunk: string) => {
                streamController.enqueue({
                  type: 'text-delta',
                  text: chunk,
                  raw: { text: chunk, done: false } as ChatResponseChunk,
                })
              },
            })

            // Emit tool calls if any
            if (result.functionCalls != null && result.functionCalls.length > 0) {
              streamController.enqueue({
                type: 'tool-call',
                toolCalls: result.functionCalls.map(
                  (call: { functionName: string; params: Record<string, unknown> }) => ({
                    name: call.functionName,
                    arguments: JSON.stringify(call.params),
                    id: globalThis.crypto.randomUUID(),
                    raw: {
                      function: {
                        name: call.functionName,
                        arguments: call.params,
                      },
                    } as ToolCall,
                  }),
                ),
                raw: { done: false } as ChatResponseChunk,
              })
            }

            // Done
            streamController.enqueue({
              type: 'done',
              reason: 'stop',
              inputTokens: 0,
              outputTokens: 0,
            })
            streamController.close()
          } catch (err) {
            if (signal.aborted) {
              streamController.enqueue({
                type: 'done',
                reason: 'abort',
                inputTokens: 0,
                outputTokens: 0,
              })
              streamController.close()
            } else {
              streamController.enqueue({
                type: 'error',
                error: err,
              })
              streamController.close()
            }
          }
        },
      })
    })()

    return Object.assign(response, {
      abort: () => controller.abort(),
      signal: controller.signal,
    })
  }

  #buildFunctions(
    tools?: Array<Tool>,
  ): Record<string, unknown> | undefined {
    if (tools == null || tools.length === 0) {
      return undefined
    }
    const functions: Record<string, unknown> = {}
    for (const tool of tools) {
      functions[tool.function.name] = {
        description: tool.function.description,
        params: tool.function.parameters,
        handler: async (params: Record<string, unknown>) => {
          return JSON.stringify(params)
        },
      }
    }
    return functions
  }
```

**Note:** The exact `promptWithMeta` return shape and function calling API will need to be verified against the actual node-llama-cpp runtime. The mock tests validate the provider's output contract (text deltas, done signals) rather than the node-llama-cpp internals. The `#buildFunctions` method and tool call emission logic may need adjustment during integration testing with a real model.

**Step 4: Run test to verify it passes**

Run: `cd /Users/paul/dev/yulsi/mokei && pnpm vitest run packages/llama-provider/test/stream-chat.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/llama-provider/src/provider.ts packages/llama-provider/test/stream-chat.test.ts
git commit -m "feat(llama-provider): implement streamChat with streaming text and tool calls"
```

---

### Task 6: Embeddings

**Files:**
- Modify: `packages/llama-provider/src/provider.ts`
- Create: `packages/llama-provider/test/embed.test.ts`

**Step 1: Write the embed test**

Create `packages/llama-provider/test/embed.test.ts`:

```typescript
import { describe, expect, test, vi } from 'vitest'

import { LlamaProvider } from '../src/provider.js'

// Mock node-llama-cpp
const mockVector = [0.1, 0.2, 0.3, 0.4, 0.5]
const mockGetEmbeddingFor = vi.fn().mockResolvedValue({ vector: mockVector })
const mockEmbedDispose = vi.fn().mockResolvedValue(undefined)
const mockCreateEmbeddingContext = vi.fn().mockResolvedValue({
  dispose: mockEmbedDispose,
  disposed: false,
  getEmbeddingFor: mockGetEmbeddingFor,
})
const mockCreateContext = vi.fn().mockResolvedValue({
  dispose: vi.fn().mockResolvedValue(undefined),
  disposed: false,
  contextSize: 4096,
  getSequence: vi.fn(),
  sequencesLeft: 1,
})
const mockLoadModel = vi.fn().mockResolvedValue({
  dispose: vi.fn().mockResolvedValue(undefined),
  disposed: false,
  createContext: mockCreateContext,
  createEmbeddingContext: mockCreateEmbeddingContext,
  trainContextSize: 4096,
})

vi.mock('node-llama-cpp', () => ({
  getLlama: vi.fn().mockResolvedValue({
    loadModel: mockLoadModel,
    dispose: vi.fn().mockResolvedValue(undefined),
  }),
}))

describe('LlamaProvider embed', () => {
  test('returns embedding for single string input', async () => {
    const provider = new LlamaProvider({
      models: { 'embed-model': { path: '/models/embed.gguf' } },
    })

    const result = await provider.embed({
      model: 'embed-model',
      input: 'Hello world',
    })

    expect(result.embeddings).toHaveLength(1)
    expect(result.embeddings[0]).toEqual(mockVector)
    expect(mockGetEmbeddingFor).toHaveBeenCalledWith('Hello world')
  })

  test('returns embeddings for array input', async () => {
    const provider = new LlamaProvider({
      models: { 'embed-model': { path: '/models/embed.gguf' } },
    })

    const result = await provider.embed({
      model: 'embed-model',
      input: ['Hello', 'World'],
    })

    expect(result.embeddings).toHaveLength(2)
    expect(mockGetEmbeddingFor).toHaveBeenCalledTimes(2)
  })

  test('reuses embedding context for same model', async () => {
    const provider = new LlamaProvider({
      models: { 'embed-model': { path: '/models/embed.gguf' } },
    })

    await provider.embed({ model: 'embed-model', input: 'First' })
    await provider.embed({ model: 'embed-model', input: 'Second' })

    // createEmbeddingContext should only be called once
    expect(mockCreateEmbeddingContext).toHaveBeenCalledTimes(1)
  })

  test('throws for unknown model', async () => {
    const provider = new LlamaProvider({
      models: { 'embed-model': { path: '/models/embed.gguf' } },
    })

    await expect(provider.embed({ model: 'unknown', input: 'test' })).rejects.toThrow(
      'Model "unknown" is not registered',
    )
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/paul/dev/yulsi/mokei && pnpm vitest run packages/llama-provider/test/embed.test.ts`
Expected: FAIL -- embed throws "Not implemented"

**Step 3: Implement embed in provider.ts**

Replace the `embed` stub:

```typescript
  async embed(params: EmbedParams): Promise<EmbedResponse> {
    const config = this.#registry.get(params.model)
    if (config == null) {
      throw new Error(`Model "${params.model}" is not registered`)
    }

    // Get or create embedding context
    let embeddingContext = this.#embeddingContexts.get(params.model)
    if (embeddingContext == null) {
      const model = await this.#loadModel(params.model)
      embeddingContext = await model.createEmbeddingContext()
      this.#embeddingContexts.set(params.model, embeddingContext)
      this.#managedContexts.add(embeddingContext)
    }

    const inputs = Array.isArray(params.input) ? params.input : [params.input]
    const embeddings: Array<Array<number>> = []

    for (const input of inputs) {
      const embedding = await embeddingContext.getEmbeddingFor(input)
      embeddings.push(Array.from(embedding.vector))
    }

    return { embeddings }
  }
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/paul/dev/yulsi/mokei && pnpm vitest run packages/llama-provider/test/embed.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/llama-provider/src/provider.ts packages/llama-provider/test/embed.test.ts
git commit -m "feat(llama-provider): implement embed with lazy embedding context"
```

---

### Task 7: Model File Management (download, delete, inspect)

**Files:**
- Modify: `packages/llama-provider/src/provider.ts`
- Create: `packages/llama-provider/test/model-management.test.ts`

**Step 1: Write the model management test**

Create `packages/llama-provider/test/model-management.test.ts`:

```typescript
import { describe, expect, test, vi } from 'vitest'

import { LlamaProvider } from '../src/provider.js'

// Mock node-llama-cpp
const mockDownload = vi.fn().mockResolvedValue('/models/downloaded.gguf')
const mockCreateModelDownloader = vi.fn().mockResolvedValue({
  download: mockDownload,
})
const mockReadGgufFileInfo = vi.fn().mockResolvedValue({
  version: 3,
  tensorCount: 100,
  metadata: { 'general.architecture': 'llama' },
})

vi.mock('node-llama-cpp', () => ({
  getLlama: vi.fn().mockResolvedValue({
    loadModel: vi.fn().mockResolvedValue({
      dispose: vi.fn().mockResolvedValue(undefined),
      disposed: false,
      createContext: vi.fn(),
      createEmbeddingContext: vi.fn(),
    }),
    dispose: vi.fn().mockResolvedValue(undefined),
  }),
  createModelDownloader: mockCreateModelDownloader,
  readGgufFileInfo: mockReadGgufFileInfo,
}))

// Mock fs/promises for deleteModel
const mockUnlink = vi.fn().mockResolvedValue(undefined)
vi.mock('node:fs/promises', () => ({
  unlink: (...args: Array<unknown>) => mockUnlink(...args),
}))

describe('LlamaProvider model management', () => {
  describe('downloadModel', () => {
    test('downloads model and registers it', async () => {
      const provider = new LlamaProvider()

      const config = await provider.downloadModel(
        'my-llama',
        'hf:meta-llama/Llama-3.2-3B-GGUF:Q4_K_M',
      )

      expect(config.path).toBe('/models/downloaded.gguf')
      expect(mockCreateModelDownloader).toHaveBeenCalled()
      expect(mockDownload).toHaveBeenCalled()

      // Model should now be listed
      const models = await provider.listModels()
      expect(models.map((m) => m.id)).toContain('my-llama')
    })

    test('passes progress callback', async () => {
      const provider = new LlamaProvider()
      const onProgress = vi.fn()

      await provider.downloadModel(
        'my-llama',
        'hf:meta-llama/Llama-3.2-3B-GGUF:Q4_K_M',
        { onProgress },
      )

      expect(mockCreateModelDownloader).toHaveBeenCalledWith(
        expect.objectContaining({
          modelUri: 'hf:meta-llama/Llama-3.2-3B-GGUF:Q4_K_M',
        }),
      )
    })

    test('stores optional config values', async () => {
      const provider = new LlamaProvider()

      const config = await provider.downloadModel(
        'my-llama',
        'hf:meta-llama/Llama-3.2-3B-GGUF:Q4_K_M',
        { contextSize: 8192, gpu: true },
      )

      expect(config.contextSize).toBe(8192)
      expect(config.gpu).toBe(true)
    })
  })

  describe('deleteModel', () => {
    test('removes model from registry and deletes file', async () => {
      const provider = new LlamaProvider({
        models: { 'test-model': { path: '/models/test.gguf' } },
      })

      await provider.deleteModel('test-model')

      const models = await provider.listModels()
      expect(models.map((m) => m.id)).not.toContain('test-model')
      expect(mockUnlink).toHaveBeenCalledWith('/models/test.gguf')
    })

    test('throws for unknown model', async () => {
      const provider = new LlamaProvider()
      await expect(provider.deleteModel('unknown')).rejects.toThrow(
        'Model "unknown" is not registered',
      )
    })
  })

  describe('inspectRemoteModel', () => {
    test('returns GGUF file info', async () => {
      const provider = new LlamaProvider()

      const info = await provider.inspectRemoteModel(
        'hf:meta-llama/Llama-3.2-3B-GGUF:Q4_K_M',
      )

      expect(info).toBeDefined()
      expect(mockReadGgufFileInfo).toHaveBeenCalledWith(
        'hf:meta-llama/Llama-3.2-3B-GGUF:Q4_K_M',
      )
    })
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/paul/dev/yulsi/mokei && pnpm vitest run packages/llama-provider/test/model-management.test.ts`
Expected: FAIL -- methods not defined

**Step 3: Implement model management in provider.ts**

Add import at top of `packages/llama-provider/src/provider.ts`:
```typescript
import { unlink } from 'node:fs/promises'
```

Add these methods to the `LlamaProvider` class:

```typescript
  async downloadModel(
    name: string,
    uri: string,
    options?: {
      contextSize?: number
      gpu?: boolean | 'auto'
      onProgress?: (progress: { downloaded: number; total: number; percent: number }) => void
    },
  ): Promise<LlamaModelConfig> {
    const { createModelDownloader } = await import('node-llama-cpp')
    const downloader = await createModelDownloader({
      modelUri: uri,
    })
    const modelPath = await downloader.download()

    const config: LlamaModelConfig = {
      path: modelPath,
      ...(options?.contextSize != null ? { contextSize: options.contextSize } : {}),
      ...(options?.gpu != null ? { gpu: options.gpu } : {}),
    }
    this.#registry.set(name, config)
    return config
  }

  async deleteModel(name: string): Promise<void> {
    const config = this.#registry.get(name)
    if (config == null) {
      throw new Error(`Model "${name}" is not registered`)
    }

    // Dispose any loaded contexts for this model
    const defaultCtx = this.#defaultContexts.get(name)
    if (defaultCtx != null) {
      await this.disposeContext(defaultCtx)
    }
    const embedCtx = this.#embeddingContexts.get(name)
    if (embedCtx != null) {
      await this.disposeContext(embedCtx)
    }

    // Dispose the loaded model
    const model = this.#loadedModels.get(name)
    if (model != null) {
      await model.dispose()
      this.#loadedModels.delete(name)
    }

    // Delete file and remove from registry
    await unlink(config.path)
    this.#registry.delete(name)
  }

  async inspectRemoteModel(uri: string): Promise<unknown> {
    const { readGgufFileInfo } = await import('node-llama-cpp')
    return await readGgufFileInfo(uri)
  }
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/paul/dev/yulsi/mokei && pnpm vitest run packages/llama-provider/test/model-management.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/llama-provider/src/provider.ts packages/llama-provider/test/model-management.test.ts
git commit -m "feat(llama-provider): add model file management (download, delete, inspect)"
```

---

### Task 8: Final Verification & Build

**Files:**
- Modify: `packages/llama-provider/src/index.ts` (if needed)

**Step 1: Verify barrel exports are complete**

Check that `packages/llama-provider/src/index.ts` exports everything needed. It should already be correct from Task 1, but verify.

**Step 2: Run all tests**

Run: `cd /Users/paul/dev/yulsi/mokei && pnpm vitest run packages/llama-provider/`
Expected: All tests PASS

**Step 3: Verify types compile**

Run: `cd /Users/paul/dev/yulsi/mokei/packages/llama-provider && pnpm run test:types`
Expected: PASS

**Step 4: Verify build**

Run: `cd /Users/paul/dev/yulsi/mokei/packages/llama-provider && pnpm run build`
Expected: Successful build, `lib/` directory created

**Step 5: Run lint**

Run: `cd /Users/paul/dev/yulsi/mokei && pnpm run lint`
Expected: PASS (or fix any issues)

**Step 6: Commit**

```bash
git add packages/llama-provider/
git commit -m "feat(llama-provider): finalize exports and verify build"
```

---

### Task 9: Archive Documentation

**Files:**
- Delete: `docs/plans/2026-02-03-llama-provider-design.md`
- Delete: `docs/plans/2026-02-03-llama-provider-plan.md`
- Create: `docs/plans/archive/2026-02-03-llama-provider.md`
- Create: `docs/plans/backlog/llama-provider-follow-ups.md` (if follow-ups exist)

**Step 1: Create merged archive document**

Create `docs/plans/archive/2026-02-03-llama-provider.md` that merges and summarizes the design and implementation plan:

```markdown
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
```

**Step 2: Create backlog for follow-ups (if any)**

Create `docs/plans/backlog/llama-provider-follow-ups.md`:

```markdown
# Llama Provider Follow-ups

## Integration testing with real models

Unit tests mock node-llama-cpp. Integration tests with actual GGUF models would validate the `promptWithMeta` return shape, function calling flow, and streaming behavior end-to-end.

## Token counting

`streamChat` currently emits `inputTokens: 0` and `outputTokens: 0` in the `done` event. node-llama-cpp may expose token counts that could be plumbed through.

## Structured output

The `output` parameter in `StreamChatParams` (JSON schema for structured output) is not yet wired to node-llama-cpp's `LlamaJsonSchemaGrammar`. This would use the `grammar` option in `promptWithMeta`.

## Conversation history in streamChat

Currently `streamChat` only extracts the last user message as the prompt. Full conversation history should be converted to node-llama-cpp's chat history format for multi-turn context.
```

**Step 3: Remove original plan files**

```bash
git rm docs/plans/2026-02-03-llama-provider-design.md
git rm docs/plans/2026-02-03-llama-provider-plan.md
```

**Step 4: Commit**

```bash
git add docs/plans/archive/2026-02-03-llama-provider.md docs/plans/backlog/llama-provider-follow-ups.md
git commit -m "docs: archive llama-provider plan and extract follow-ups to backlog"
```

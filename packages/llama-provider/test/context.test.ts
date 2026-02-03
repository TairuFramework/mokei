import { beforeEach, describe, expect, test, vi } from 'vitest'

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
  beforeEach(() => {
    vi.clearAllMocks()
  })

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

    const _ctx1 = await provider.createContext('test-model')
    const _ctx2 = await provider.createContext('test-model')
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

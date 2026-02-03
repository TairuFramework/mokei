import { beforeEach, describe, expect, test, vi } from 'vitest'

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
  beforeEach(() => {
    vi.clearAllMocks()
  })

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

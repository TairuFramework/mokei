import { beforeEach, describe, expect, test, vi } from 'vitest'

const mockCreateContext = vi.fn().mockResolvedValue({ getSequence: vi.fn() })
const mockLoadModel = vi.fn()

vi.mock('node-llama-cpp', () => ({
  getLlama: vi.fn().mockResolvedValue({
    loadModel: (...args: Array<unknown>) => mockLoadModel(...args),
    dispose: vi.fn().mockResolvedValue(undefined),
  }),
}))

beforeEach(() => {
  vi.clearAllMocks()
})

describe('LlamaProvider load caching', () => {
  test('a failed model load is not cached — the next call retries', async () => {
    const { LlamaProvider } = await import('../src/provider.js')
    const provider = new LlamaProvider({ models: { m: { path: '/m.gguf' } } })

    mockLoadModel.mockRejectedValueOnce(new Error('load failed'))
    mockLoadModel.mockResolvedValueOnce({
      createContext: mockCreateContext,
      dispose: vi.fn().mockResolvedValue(undefined),
      disposed: false,
    })

    await expect(provider.getContext('m')).rejects.toThrow('load failed')
    // Second call must re-invoke loadModel (entry cleared), not return the cached rejection.
    await expect(provider.getContext('m')).resolves.toBeDefined()
    expect(mockLoadModel).toHaveBeenCalledTimes(2)
  })
})

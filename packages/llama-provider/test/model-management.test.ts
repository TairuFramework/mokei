import { beforeEach, describe, expect, test, vi } from 'vitest'

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

beforeEach(() => {
  vi.clearAllMocks()
})

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

      const models = await provider.listModels()
      expect(models.map((m) => m.id)).toContain('my-llama')
    })

    test('passes model URI to downloader', async () => {
      const provider = new LlamaProvider()

      await provider.downloadModel('my-llama', 'hf:meta-llama/Llama-3.2-3B-GGUF:Q4_K_M')

      expect(mockCreateModelDownloader).toHaveBeenCalledWith(
        expect.objectContaining({
          modelUri: 'hf:meta-llama/Llama-3.2-3B-GGUF:Q4_K_M',
        }),
      )
    })

    test('passes onProgress callback to downloader with adapted format', async () => {
      mockCreateModelDownloader.mockImplementation(async (opts: Record<string, unknown>) => {
        const onProgress = opts.onProgress as
          | ((status: { totalSize: number; downloadedSize: number }) => void)
          | undefined
        if (onProgress) {
          onProgress({ totalSize: 1000, downloadedSize: 500 })
          onProgress({ totalSize: 1000, downloadedSize: 1000 })
        }
        return { download: mockDownload }
      })

      const provider = new LlamaProvider()
      const updates: Array<{ downloaded: number; total: number; percent: number }> = []

      await provider.downloadModel('my-llama', 'hf:meta-llama/Llama-3.2-3B-GGUF:Q4_K_M', {
        onProgress: (progress) => updates.push(progress),
      })

      expect(updates).toHaveLength(2)
      expect(updates[0]).toEqual({ downloaded: 500, total: 1000, percent: 0.5 })
      expect(updates[1]).toEqual({ downloaded: 1000, total: 1000, percent: 1 })
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

      const info = await provider.inspectRemoteModel('hf:meta-llama/Llama-3.2-3B-GGUF:Q4_K_M')

      expect(info).toBeDefined()
      expect(mockReadGgufFileInfo).toHaveBeenCalledWith('hf:meta-llama/Llama-3.2-3B-GGUF:Q4_K_M')
    })
  })
})

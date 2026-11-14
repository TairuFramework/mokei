import { expect, test, vi } from 'vitest'

import { AnthropicClient } from '../src/client.js'

test('uses the injected fetch for requests', async () => {
  const globalFetch = vi.fn()
  vi.stubGlobal('fetch', globalFetch)
  const fetch = vi.fn(async (_input: Request | string | URL) =>
    Response.json({ data: [], has_more: false }),
  )
  const client = new AnthropicClient({ baseURL: 'http://127.0.0.1:1/v1', fetch })
  await client.listModels()
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(globalFetch).not.toHaveBeenCalled()
  vi.unstubAllGlobals()
})

test('provider lists every page of models', async () => {
  const { AnthropicProvider } = await import('../src/provider.js')
  const urls: Array<string> = []
  const pages = [
    { data: [{ id: 'a' }], first_id: 'a', has_more: true, last_id: 'a' },
    { data: [{ id: 'b' }], first_id: 'b', has_more: false, last_id: 'b' },
  ]
  const fetch = vi.fn(async (input: Request | string | URL) => {
    urls.push(input instanceof Request ? input.url : String(input))
    return Response.json(pages[urls.length - 1])
  })
  const provider = new AnthropicProvider({
    client: new AnthropicClient({ baseURL: 'http://127.0.0.1:1/v1', fetch }),
  })
  const models = await provider.listModels()
  expect(models.map((model) => model.id)).toEqual(['a', 'b'])
  expect(new URL(urls[0]).searchParams.get('after_id')).toBeNull()
  expect(new URL(urls[1]).searchParams.get('after_id')).toBe('a')
  expect(new URL(urls[1]).searchParams.get('limit')).toBe('1000')
})

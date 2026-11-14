import { expect, test, vi } from 'vitest'

import { OpenAIClient } from '../src/client.js'

test('uses the injected fetch for requests', async () => {
  const globalFetch = vi.fn()
  vi.stubGlobal('fetch', globalFetch)
  const fetch = vi.fn(async (_input: Request | string | URL) => Response.json({ data: [] }))
  const client = new OpenAIClient({ baseURL: 'http://127.0.0.1:1/v1', fetch })
  await client.listModels()
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(globalFetch).not.toHaveBeenCalled()
  vi.unstubAllGlobals()
})

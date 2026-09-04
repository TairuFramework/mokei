import type { FetchLike } from '@mokei/http-client'
import { expect, test } from 'vitest'

import { ContextHost } from '../src/index.js'

test('addHTTPContext forwards fetchMiddleware to the transport', async () => {
  let wrapped = false
  const middleware = (next: FetchLike): FetchLike => {
    wrapped = true
    return next
  }

  const host = new ContextHost()
  await host.addHTTPContext({
    key: 'k',
    url: 'https://mcp.example/mcp',
    fetchMiddleware: middleware,
  })

  expect(wrapped).toBe(true)
})

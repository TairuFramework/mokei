import { expect, test } from 'vitest'

import { createMemoryTokenStore } from '../src/oauth/store.js'

test('memory store round-trips and deletes', async () => {
  const store = createMemoryTokenStore()
  await store.set('k', { accessToken: 'a', tokenType: 'Bearer' })
  expect((await store.get('k'))?.accessToken).toBe('a')
  await store.delete('k')
  expect(await store.get('k')).toBeUndefined()
})

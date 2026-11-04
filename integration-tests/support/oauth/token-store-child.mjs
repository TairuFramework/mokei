// Child process for `suites/oauth-token-coordination.test.ts`: each mode exercises the shared
// JSON file store (or the OAuth middleware on top of it) from a separate process.
import { createJSONFileStore, createNodeOAuthMiddleware } from '@mokei/host-node'

const [mode, file, ...rest] = process.argv.slice(2)

if (mode === 'count') {
  const store = createJSONFileStore(file)
  const times = Number(rest[0])
  for (let i = 0; i < times; i++) {
    await store.update('n', (current) => (current ?? 0) + 1)
  }
} else if (mode === 'hold') {
  // Holds the lock well past `staleLockMs`; the heartbeat must keep it from being taken over.
  const store = createJSONFileStore(file, { staleLockMs: 300 })
  await store.update('trace', async (current) => {
    await new Promise((resolve) => setTimeout(resolve, Number(rest[0])))
    return `${current ?? ''}${rest[1]}`
  })
} else if (mode === 'append') {
  const store = createJSONFileStore(file, { staleLockMs: 300 })
  await store.update('trace', (current) => `${current ?? ''}${rest[0]}`)
} else if (mode === 'refresh') {
  const [resource] = rest
  const middleware = createNodeOAuthMiddleware({
    clientID: 'c',
    resource,
    tokensPath: file,
    handler: {
      async authorize() {
        throw new Error('signed in again')
      },
    },
  })
  const response = await middleware(fetch)(resource, { method: 'POST', body: '{}' })
  process.stdout.write(`${response.status}\n`)
} else {
  throw new Error(`unknown mode ${mode}`)
}

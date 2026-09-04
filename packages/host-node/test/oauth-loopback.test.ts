import { expect, test } from 'vitest'

import { createLoopbackAuthorizationHandler } from '../src/oauth/loopback.js'

test('captures code+state from the loopback redirect', async () => {
  const handler = createLoopbackAuthorizationHandler({
    // Instead of opening a real browser, immediately GET the redirect URI with a fake code.
    openBrowser: async (authUrl) => {
      const url = new URL(authUrl)
      const redirect = new URL(url.searchParams.get('redirect_uri') as string)
      redirect.searchParams.set('code', 'the-code')
      redirect.searchParams.set('state', url.searchParams.get('state') as string)
      await fetch(redirect.toString())
    },
  })

  const state = 'st-123'
  const result = await handler.authorize({
    state,
    buildAuthorizationUrl: (redirectUri) => {
      const u = new URL('https://as.example.com/authorize')
      u.searchParams.set('redirect_uri', redirectUri)
      u.searchParams.set('state', state)
      return u.toString()
    },
  })
  expect(result.code).toBe('the-code')
  expect(result.state).toBe(state)
  expect(result.redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\//)
})

test('rejects on OAuth error response', async () => {
  const handler = createLoopbackAuthorizationHandler({
    openBrowser: async (authUrl) => {
      const redirect = new URL(new URL(authUrl).searchParams.get('redirect_uri') as string)
      redirect.searchParams.set('error', 'access_denied')
      await fetch(redirect.toString())
    },
  })
  await expect(
    handler.authorize({
      state: 's',
      buildAuthorizationUrl: (r) =>
        `https://as.example.com/authorize?redirect_uri=${encodeURIComponent(r)}`,
    }),
  ).rejects.toThrow(/access_denied/)
})

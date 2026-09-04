import { expect, test } from 'vitest'

import { browserOpenCommand, createLoopbackAuthorizationHandler } from '../src/oauth/loopback.js'

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

// J1: an already-aborted signal must reject the flow immediately -- without ever opening a
// browser -- and leave no loopback server behind (settle() closes it idempotently).
test('J1: an already-aborted signal rejects immediately without opening the browser', async () => {
  let openBrowserCalls = 0
  const handler = createLoopbackAuthorizationHandler({
    openBrowser: async () => {
      openBrowserCalls += 1
    },
  })
  // Count listening loopback servers so we can prove none is leaked. A pre-aborted flow must not
  // bind a socket at all: settle()'s server.close() is a no-op while the server is not yet
  // listening, so if the code fell through to server.listen() the socket would stay open forever
  // (the timer is already cleared) -- exactly the leak this guards against.
  const listeningServers = (): number =>
    (process as unknown as { _getActiveHandles(): Array<unknown> })
      ._getActiveHandles()
      .filter(
        (h): h is { listening?: boolean } => (h as { listening?: boolean }).listening === true,
      ).length
  const before = listeningServers()
  const controller = new AbortController()
  controller.abort(new Error('cancelled by caller'))
  await expect(
    handler.authorize({
      state: 's',
      signal: controller.signal,
      buildAuthorizationUrl: (r) =>
        `https://as.example.com/authorize?redirect_uri=${encodeURIComponent(r)}`,
    }),
  ).rejects.toThrow(/cancelled by caller/)
  // Give the (already-settled) flow's listen callback a turn to run, if it was going to.
  await new Promise((resolve) => setTimeout(resolve, 10))
  expect(openBrowserCalls).toBe(0)
  expect(listeningServers()).toBe(before)
})

// J1: a signal that aborts mid-flight (after the loopback server is already listening and
// waiting on the redirect) must also reject, rather than hanging until `timeoutMs`.
test('J1: a signal aborted mid-flight rejects the in-progress authorization', async () => {
  const controller = new AbortController()
  const handler = createLoopbackAuthorizationHandler({
    openBrowser: async () => {
      // Simulate the user cancelling instead of completing the browser flow: abort once the
      // server is listening (buildAuthorizationUrl was already called to get here).
      controller.abort(new Error('user cancelled'))
    },
  })
  await expect(
    handler.authorize({
      state: 's',
      signal: controller.signal,
      buildAuthorizationUrl: (r) =>
        `https://as.example.com/authorize?redirect_uri=${encodeURIComponent(r)}`,
    }),
  ).rejects.toThrow(/user cancelled/)
})

// C1: the win32 browser opener must never route through cmd.exe -- `cmd.exe /c start` is a
// shell builtin that re-parses metacharacters (&, |, ^, %) in the command line, and OAuth
// authorization URLs always contain `&` (query-param separators). Assert rundll32 receives the
// full URL, `&`s intact, as a single discrete argv element.
test('browserOpenCommand: win32 uses rundll32 FileProtocolHandler with the URL as one arg (not cmd.exe)', () => {
  const url = 'https://as.example/auth?a=1&b=2&state=x'
  expect(browserOpenCommand('win32', url)).toEqual({
    command: 'rundll32.exe',
    args: ['url.dll,FileProtocolHandler', url],
  })
})

test('browserOpenCommand: darwin uses open', () => {
  const url = 'https://as.example/auth?a=1&b=2'
  expect(browserOpenCommand('darwin', url)).toEqual({ command: 'open', args: [url] })
})

test('browserOpenCommand: linux (and other platforms) use xdg-open', () => {
  const url = 'https://as.example/auth?a=1&b=2'
  expect(browserOpenCommand('linux', url)).toEqual({ command: 'xdg-open', args: [url] })
})

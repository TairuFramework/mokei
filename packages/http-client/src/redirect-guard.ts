import type { FetchLike } from './transport.js'

/**
 * Wraps `fetch` so a request carrying a credential never follows a redirect. A request is
 * credentialed when it sends `Authorization` or any header named in `credentialHeaders`
 * (the transport's static `headers` and `auth`). Such a request goes out with
 * `redirect: 'manual'` (a caller's `'error'` is kept), and a `3xx` or `opaqueredirect` response
 * to it is refused: the Fetch standard strips only `Authorization` on a cross-origin redirect,
 * so a custom header would otherwise reach the new origin.
 *
 * Limits: a credential header a `fetchMiddleware` adds under another name is not detected, and a
 * fetch implementation that ignores `redirect: 'manual'` sends the credential before this guard
 * sees the response (it then fails on `response.redirected`). Check your platform's fetch.
 */
export function withCredentialRedirectGuard(
  fetch: FetchLike,
  credentialHeaders: Iterable<string>,
): FetchLike {
  const names = new Set(['authorization'])
  for (const name of credentialHeaders) names.add(name.toLowerCase())
  return async (url, init) => {
    const headers = new Headers(init?.headers)
    let credentialed = false
    for (const name of names) {
      if (headers.has(name)) {
        credentialed = true
        break
      }
    }
    if (!credentialed) return fetch(url, init)
    const redirect: RequestRedirect = init?.redirect === 'error' ? 'error' : 'manual'
    const response = await fetch(url, { ...init, redirect })
    if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
      await response.body?.cancel().catch(() => {})
      throw new Error(`refused to follow a redirect with credentials (status ${response.status})`)
    }
    // A fetch that ignores `redirect: 'manual'` (some React Native implementations follow
    // natively) has already sent the credential; failing here at least stops the response being used.
    if (response.redirected) {
      await response.body?.cancel().catch(() => {})
      throw new Error('refused a response reached through a redirect with credentials')
    }
    return response
  }
}

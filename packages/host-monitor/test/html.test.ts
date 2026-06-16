import { describe, expect, test } from 'vitest'

import { injectToken } from '../src/html.js'

describe('injectToken', () => {
  test('inserts the token script before </head>', () => {
    const out = injectToken('<html><head></head><body></body></html>', 'abc123')
    expect(out).toContain('window.__MOKEI_TOKEN__="abc123"')
    expect(out.indexOf('window.__MOKEI_TOKEN__')).toBeLessThan(out.indexOf('</head>'))
  })

  test('escapes the token as JSON to avoid breaking out of the script', () => {
    const out = injectToken('<head></head>', '</script><x>')
    // The raw injection vector must not appear literally in the output
    expect(out).not.toContain('</script><x>"')
    // The token must be present in a JSON-safe unicode-escaped form
    expect(out).toContain('"\\u003c/script\\u003e\\u003cx\\u003e"')
  })

  test('prepends the script when there is no head', () => {
    const out = injectToken('<body>hi</body>', 'tok')
    expect(out.startsWith('<script>')).toBe(true)
  })
})

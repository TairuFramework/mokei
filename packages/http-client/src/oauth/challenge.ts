/**
 * Parses the auth-params of the first `Bearer` challenge in a `WWW-Authenticate` header
 * (RFC 9110 §11.6.1, RFC 6750 §3), or returns `null` when there is none. Parameter names are
 * lower-cased. Quoted values are unescaped. A repeated parameter keeps its first value. A
 * challenge for another scheme ends the `Bearer` one, so its parameters are never mixed in.
 */
export function parseBearerChallenge(header: string | null): Record<string, string> | null {
  if (header == null) return null
  let index = 0
  const length = header.length

  const skipSpace = (): void => {
    while (index < length && /[ \t]/.test(header[index] as string)) index += 1
  }
  const readToken = (): string => {
    const start = index
    while (index < length && /[!#$%&'*+\-.^_`|~0-9A-Za-z]/.test(header[index] as string)) {
      index += 1
    }
    return header.slice(start, index)
  }
  const readQuoted = (): string | null => {
    // At the opening quote.
    index += 1
    let value = ''
    while (index < length) {
      const char = header[index] as string
      if (char === '\\' && index + 1 < length) {
        value += header[index + 1]
        index += 2
      } else if (char === '"') {
        index += 1
        return value
      } else {
        value += char
        index += 1
      }
    }
    return null
  }

  let params: Record<string, string> | null = null
  while (index < length) {
    skipSpace()
    if (header[index] === ',') {
      index += 1
      continue
    }
    const scheme = readToken()
    if (scheme === '') {
      // A stray character (or token68 padding): skip it so the loop always advances.
      index += 1
      continue
    }
    // The Bearer challenge ended where this next challenge begins.
    if (params != null) return params
    const isBearer = scheme.toLowerCase() === 'bearer'
    const current: Record<string, string> = {}
    // auth-params: `name = value` pairs separated by commas, until the next scheme.
    while (index < length) {
      skipSpace()
      const mark = index
      const name = readToken()
      skipSpace()
      if (name === '' || header[index] !== '=') {
        // Not an auth-param: the start of the next challenge (or token68, which is skipped).
        index = mark
        break
      }
      index += 1
      skipSpace()
      let value: string | null
      if (header[index] === '"') {
        value = readQuoted()
        // Unterminated quote: the header ends here.
        if (value == null) return isBearer ? current : null
      } else {
        value = readToken()
      }
      const key = name.toLowerCase()
      if (!(key in current)) current[key] = value
      skipSpace()
      if (header[index] === ',') index += 1
    }
    if (isBearer) params = current
  }
  return params
}

/** Splits an OAuth `scope` string (space-delimited, RFC 6749 §3.3) into its scopes. */
export function splitScopes(scope: string | undefined): Array<string> {
  return scope == null ? [] : scope.split(' ').filter((entry) => entry !== '')
}

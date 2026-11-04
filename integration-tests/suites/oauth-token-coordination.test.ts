import { access, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tokenStoreKey } from '@mokei/http-client'
import spawn from 'nano-spawn'
import { afterEach, describe, expect, test } from 'vitest'

const CHILD = fileURLToPath(new URL('../support/oauth/token-store-child.mjs', import.meta.url))

function runChild(...args: Array<string>) {
  return spawn(process.execPath, [CHILD, ...args])
}

function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  )
}

async function tempFile(): Promise<string> {
  return join(await mkdtemp(join(tmpdir(), 'mokei-oauth-coord-')), 'tokens.json')
}

let server: Server | undefined

afterEach(async () => {
  await new Promise<void>((resolve) => (server == null ? resolve() : server.close(() => resolve())))
  server = undefined
})

/** A protected resource and authorisation server in one: each refresh token is valid once. */
async function startRotatingServer(): Promise<{ base: string; refreshes: () => number }> {
  let generation = 1
  const valid = new Set(['r1'])
  let refreshes = 0
  server = createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => {
      body += chunk
    })
    req.on('end', () => {
      if (req.url === '/token') {
        refreshes++
        const presented = new URLSearchParams(body).get('refresh_token') ?? ''
        const ok = valid.delete(presented)
        // Slow enough that every child finds the token expired before any refresh lands.
        setTimeout(() => {
          res.setHeader('Content-Type', 'application/json')
          if (!ok) {
            res.statusCode = 400
            res.end(JSON.stringify({ error: 'invalid_grant' }))
            return
          }
          generation++
          valid.add(`r${generation}`)
          res.end(
            JSON.stringify({
              access_token: `a${generation}`,
              token_type: 'Bearer',
              refresh_token: `r${generation}`,
              expires_in: 3600,
            }),
          )
        }, 300)
        return
      }
      res.statusCode = req.headers.authorization === `Bearer a${generation}` ? 200 : 401
      res.end()
    })
  })
  await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return { base: `http://127.0.0.1:${port}`, refreshes: () => refreshes }
}

describe('token store coordination across processes', () => {
  test('update is atomic across processes', async () => {
    const file = await tempFile()
    await Promise.all(Array.from({ length: 4 }, () => runChild('count', file, '25')))
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ n: 100 })
  })

  test('a lock held past staleLockMs is not taken over while its holder is alive', async () => {
    const file = await tempFile()
    const holder = runChild('hold', file, '4000', 'A')
    // Start the contender only once the holder owns the lock file.
    const deadline = Date.now() + 5_000
    while (!(await exists(`${file}.lock`))) {
      if (Date.now() > deadline) throw new Error('holder never took the lock')
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    await runChild('append', file, 'B')
    await holder
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ trace: 'AB' })
  }, 20_000)

  test('processes sharing a tokens file redeem a rotating refresh token once', async () => {
    const { base, refreshes } = await startRotatingServer()
    const resource = `${base}/mcp`
    const file = await tempFile()
    await writeFile(
      file,
      JSON.stringify({
        [tokenStoreKey({ resource, clientID: 'c' })]: {
          accessToken: 'a1',
          tokenType: 'Bearer',
          refreshToken: 'r1',
          expiresAt: 1,
          tokenEndpoint: `${base}/token`,
          issuer: base,
        },
      }),
      { mode: 0o600 },
    )

    const results = await Promise.all(
      Array.from({ length: 3 }, () => runChild('refresh', file, resource)),
    )

    expect(results.map((result) => result.stdout)).toEqual(['200', '200', '200'])
    expect(refreshes()).toBe(1)
    const stored = Object.values(JSON.parse(await readFile(file, 'utf8'))) as Array<{
      refreshToken: string
    }>
    expect(stored.map((tokens) => tokens.refreshToken)).toEqual(['r2'])
  })
})

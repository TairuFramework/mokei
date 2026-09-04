import { randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import type { AuthorizationHandler } from '@mokei/http-client'
import spawn from 'nano-spawn'

/**
 * Picks the OS-appropriate command/args to open `url` in a browser, as a pure function so the
 * choice is unit-testable without actually spawning anything.
 *
 * The win32 case deliberately avoids `cmd.exe /c start`: `start` is a cmd.exe builtin, and cmd
 * re-parses metacharacters (`&`, `|`, `^`, `%`, `<`, `>`) in the command line regardless of
 * nano-spawn's array args. OAuth authorization URLs always contain `&` (query-param separators),
 * so that form both breaks legitimate URLs and lets a malicious `authorization_endpoint`
 * (returned from AS discovery) inject shell commands. `rundll32`'s `FileProtocolHandler` takes
 * the URL as a single, non-shell-interpreted argv element instead.
 */
export function browserOpenCommand(
  platform: NodeJS.Platform,
  url: string,
): { command: string; args: Array<string> } {
  if (platform === 'darwin') {
    return { command: 'open', args: [url] }
  }
  if (platform === 'win32') {
    return { command: 'rundll32.exe', args: ['url.dll,FileProtocolHandler', url] }
  }
  return { command: 'xdg-open', args: [url] }
}

async function defaultOpenBrowser(url: string): Promise<void> {
  const { command, args } = browserOpenCommand(process.platform, url)
  await spawn(command, args)
}

export type LoopbackAuthorizationHandlerOptions = {
  /** How long to wait for the browser redirect before rejecting. Defaults to 5 minutes. */
  timeoutMs?: number
  /** Opens the given authorization URL in a browser. Defaults to the OS-appropriate opener. */
  openBrowser?: (url: string) => Promise<void>
}

/**
 * Creates an {@link AuthorizationHandler} that completes the OAuth authorization-code flow via a
 * local loopback HTTP server, per RFC 8252 (OAuth for native apps).
 */
export function createLoopbackAuthorizationHandler(
  options: LoopbackAuthorizationHandlerOptions = {},
): AuthorizationHandler {
  const timeoutMs = options.timeoutMs ?? 300_000
  const openBrowser = options.openBrowser ?? defaultOpenBrowser

  return {
    authorize({ buildAuthorizationUrl, state }) {
      return new Promise((resolve, reject) => {
        const path = `/cb/${randomBytes(8).toString('hex')}`
        let redirectUri = ''
        let settled = false

        const server = createServer((req, res) => {
          const url = new URL(req.url ?? '/', 'http://127.0.0.1')
          if (url.pathname !== path) {
            res.writeHead(404).end()
            return
          }

          const error = url.searchParams.get('error')
          const code = url.searchParams.get('code')
          const returnedState = url.searchParams.get('state')

          res.writeHead(error ? 400 : 200, { 'Content-Type': 'text/html' })
          res.end(
            `<html><body>${
              error
                ? 'Authorization failed. You may close this window.'
                : 'Authorization complete. You may close this window.'
            }</body></html>`,
          )

          if (error) {
            settle(() => reject(new Error(`OAuth error: ${error}`)))
          } else if (code && returnedState != null && returnedState === state) {
            settle(() => resolve({ code, state: returnedState, redirectUri }))
          } else if (returnedState != null && returnedState !== state) {
            settle(() => reject(new Error('Loopback callback state mismatch')))
          } else {
            settle(() => reject(new Error('Loopback callback missing code or state')))
          }
        })

        const timer = setTimeout(() => {
          settle(() => reject(new Error('Authorization timed out')))
        }, timeoutMs)

        function settle(run: () => void): void {
          if (settled) {
            return
          }
          settled = true
          clearTimeout(timer)
          server.close()
          run()
        }

        server.on('error', (err) => {
          settle(() => reject(err))
        })

        server.listen(0, '127.0.0.1', () => {
          const addr = server.address()
          if (addr == null || typeof addr === 'string') {
            settle(() => reject(new Error('Failed to bind loopback server')))
            return
          }

          redirectUri = `http://127.0.0.1:${addr.port}${path}`
          openBrowser(buildAuthorizationUrl(redirectUri)).catch((err: unknown) => {
            settle(() => reject(err instanceof Error ? err : new Error(String(err))))
          })
        })
      })
    },
  }
}

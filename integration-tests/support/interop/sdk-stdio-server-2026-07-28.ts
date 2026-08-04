/**
 * Stdio entry point serving the interop fixture with the official SDK v2 server on `2026-07-28`
 * and nothing else.
 *
 * `legacy: 'reject'` answers a `2025-11-25` opening with the unsupported-protocol-version error
 * instead of pinning a `2025-11-25` instance (the default `legacy: 'serve'`). Same reasoning as
 * `startSDK20260728HTTPServer`: against a both-revisions peer, a mokei client that silently fell
 * back would pass every assertion while testing the wrong revision.
 */
import { serveStdio } from '@modelcontextprotocol/server/stdio'

import { createSDKServer } from './fixture.ts'

serveStdio(() => createSDKServer(), { legacy: 'reject' })

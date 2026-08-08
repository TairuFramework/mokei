/**
 * Stdio entry point serving the MRTR fixture with the official SDK v2 server on `2026-07-28`.
 *
 * `legacy: 'reject'` for the same reason as `sdk-stdio-server-2026-07-28.ts`: a mokei client that
 * silently fell back to `2025-11-25` would pass every assertion while testing the wrong revision,
 * and `2025-11-25` has no MRTR at all.
 */
import { serveStdio } from '@modelcontextprotocol/server/stdio'

import { createSDKMRTRServer } from './mrtr-fixture.ts'

serveStdio(() => createSDKMRTRServer(), { legacy: 'reject' })

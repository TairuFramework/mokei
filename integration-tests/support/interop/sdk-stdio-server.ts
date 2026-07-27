/** Stdio entry point serving the interop fixture with the official SDK v2 server. */
import { serveStdio } from '@modelcontextprotocol/server/stdio'

import { createSDKServer } from './fixture.ts'

serveStdio(() => createSDKServer())

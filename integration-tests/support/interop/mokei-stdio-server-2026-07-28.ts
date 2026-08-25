/** Stdio entry point serving the interop fixture on protocol version 2026-07-28. */
import { serveProcess } from '@mokei/context-server-node'

import { createMokeiConfig } from './fixture.ts'

serveProcess(createMokeiConfig(['2026-07-28']))

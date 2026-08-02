/** Stdio entry point serving the interop fixture on protocol version 2025-11-25 only. */
import { serveProcess } from '@mokei/context-server'

import { createMokeiConfig } from './fixture.ts'

serveProcess(createMokeiConfig(['2025-11-25']))

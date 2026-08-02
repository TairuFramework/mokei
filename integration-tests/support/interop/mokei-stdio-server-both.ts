/** Stdio entry point serving the interop fixture on both supported revisions. */
import { serveProcess } from '@mokei/context-server'

import { createMokeiConfig } from './fixture.ts'

serveProcess(createMokeiConfig(['2026-07-28', '2025-11-25']))

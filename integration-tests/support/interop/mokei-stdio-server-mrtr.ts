/** Stdio entry point serving the MRTR fixture with mokei's server on `2026-07-28` only. */
import { serveProcess } from '@mokei/context-server'

import { createMokeiMRTRConfig } from './mrtr-fixture.ts'

serveProcess(createMokeiMRTRConfig(['2026-07-28']))

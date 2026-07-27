/** Stdio entry point serving the interop fixture with `@mokei/context-server`. */
import { serveProcess } from '@mokei/context-server'

import { createMokeiConfig } from './fixture.ts'

serveProcess(createMokeiConfig())

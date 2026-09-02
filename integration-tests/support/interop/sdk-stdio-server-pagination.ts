/**
 * Stdio entry point serving the pagination fixture with the official SDK v2 server.
 *
 * No `legacy` restriction: the point of the fixture is to walk pages on *both* revisions, so the
 * client picks the revision (the suite pins `2025-11-25` and `2026-07-28` in turn) and `serveStdio`
 * negotiates whichever it asks for.
 */
import { serveStdio } from '@modelcontextprotocol/server/stdio'

import { createSDKPaginationServer } from './pagination-fixture.ts'

serveStdio(() => createSDKPaginationServer())

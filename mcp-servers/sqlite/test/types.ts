/**
 * Type-level tests for the typed client (`ExtractServerTypes`).
 *
 * No runtime assertions — vitest does not pick this file up (it matches `*.test.ts`). It is
 * compiled by `tsc -p tsconfig.test.json`, and the `@ts-expect-error` lines fail the build if
 * the call they mark ever starts compiling.
 *
 * This exists because the typed client was silently broken: `ExtractServerTypes` yielded
 * `never` arguments (so `callTool` could not be called at all), and no test compiled it.
 */
import type { ContextClient } from '@mokei/context-client'

import type { SQLiteServerTypes } from '../src/index.js'

declare const client: ContextClient<SQLiteServerTypes>

// The extracted argument type is the real one the inputSchema describes, not an open record.
type AllArgs = SQLiteServerTypes['Tools']['sqlite_all']
declare const args: AllArgs
const sql: string = args.sql
const parameters: Record<string, string | number | null> | undefined = args.parameters
void sql
void parameters

// A correct call compiles.
void client.callTool({ name: 'sqlite_all', arguments: { sql: 'SELECT 1' } })
void client.callTool({ name: 'sqlite_run', arguments: { sql: 'SELECT 1', parameters: { a: 1 } } })

// @ts-expect-error unknown tool name
void client.callTool({ name: 'nope', arguments: { sql: 'SELECT 1' } })

// @ts-expect-error `sql` must be a string
void client.callTool({ name: 'sqlite_all', arguments: { sql: 123 } })

// @ts-expect-error `sql` is required
void client.callTool({ name: 'sqlite_all', arguments: {} })

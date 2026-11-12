/**
 * Version of the mokei packages, which release in lockstep. Reported as MCP client and server
 * implementation versions and as instrumentation scope versions. `test/version.test.ts` fails
 * when it drifts from `package.json`: update it after `pnpm version -r`.
 */
export const MOKEI_VERSION = '0.16.1'

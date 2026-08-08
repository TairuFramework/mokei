/**
 * A minimal MCP surface exposing one multi round-trip tool (MRTR, SEP-2322), defined twice — once
 * with mokei's server API and once with the official SDK v2 API — so each implementation can be
 * driven by the other's client.
 *
 * The tool suspends on its first round asking the client for its roots, then answers with the
 * number of roots it received. `roots/list` is the cheapest of the three input requests to fulfil
 * from a test: no model, no user interaction, and a result the assertion can count.
 *
 * Kept out of `fixture.ts` on purpose: adding a tool there would change
 * `MOKEI_TOOL_NAMES`/`SDK_TOOL_NAMES` and break every suite asserting them.
 *
 * Both sides also mint a `requestState` on the suspension and re-check it on the retry round, so
 * the suite's single text assertion covers the opaque-state echo as well as the input round trip:
 * a peer that dropped or mangled `requestState` answers `requestStateMismatch(...)` instead of
 * `rootsAnswer(...)`, which reads as a diff rather than as a silent pass.
 */
import { inputRequired, inputResponse, McpServer } from '@modelcontextprotocol/server'
import type { ProtocolVersion } from '@mokei/context-protocol'
import {
  createTool,
  inputRequired as mokeiInputRequired,
  type ServerConfig,
} from '@mokei/context-server'

export const MRTR_SERVER_NAME = 'interop-mrtr-fixture'
export const MRTR_SERVER_VERSION = '1.0.0'
export const MRTR_TOOL_NAME = 'countRoots'
const MRTR_TOOL_DESCRIPTION = 'Counts the roots the client reports'
/** The key both fixtures assign their embedded `roots/list` request, and read the response back at. */
export const MRTR_INPUT_KEY = 'roots'

/**
 * The payload the mokei fixture mints its `requestState` from, and — serialized — the exact
 * string the SDK fixture mints. Neither server configures an integrity hook, so on both stacks the
 * value that comes back on the retry round is the raw wire string.
 */
const MRTR_STATE_PAYLOAD = { asked: true }

/** What `createSDKMRTRServer` mints. mokei's default (JSON) minting produces the same string. */
const MRTR_STATE_STRING = JSON.stringify(MRTR_STATE_PAYLOAD)

/** Text the tool answers with once it has the client's roots and its own state back. */
export function rootsAnswer(count: number): string {
  return `roots: ${count}`
}

/** Text the tool answers with when the client echoed something other than what it minted. */
export function requestStateMismatch(received: unknown): string {
  return `requestState mismatch: ${JSON.stringify(received) ?? 'undefined'}`
}

export function createMokeiMRTRConfig(
  protocolVersions: Array<ProtocolVersion> = ['2026-07-28'],
): ServerConfig {
  return {
    name: MRTR_SERVER_NAME,
    version: MRTR_SERVER_VERSION,
    protocolVersions,
    tools: {
      [MRTR_TOOL_NAME]: createTool({
        description: MRTR_TOOL_DESCRIPTION,
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        handler: ({ inputResponses, mintRequestState, requestState }) => {
          // Minted through the handler's own hook rather than compared against a hard-coded
          // string, so the check stays honest if the server is ever given a `requestState.mint`.
          const minted = mintRequestState(MRTR_STATE_PAYLOAD)
          const answer = inputResponses?.[MRTR_INPUT_KEY] as { roots?: Array<unknown> } | undefined
          if (answer == null) {
            return mokeiInputRequired({
              // With an explicit empty `params`, where the SDK's `inputRequired.listRoots()`
              // emits the member-less `{ method: 'roots/list' }`. Both are legal (`params` is
              // optional in either schema) and the asymmetry is the point: each stack's decoder
              // is put in front of the shape the other actually writes.
              inputRequests: { [MRTR_INPUT_KEY]: { method: 'roots/list', params: {} } },
              requestState: minted,
            })
          }
          if (requestState !== minted) {
            return { content: [{ type: 'text', text: requestStateMismatch(requestState) }] }
          }
          return { content: [{ type: 'text', text: rootsAnswer(answer.roots?.length ?? 0) }] }
        },
      }),
    },
  }
}

/**
 * The same fixture served by the official SDK v2 `McpServer`.
 *
 * Registered without an `inputSchema`: SDK 2.0.0 calls a schema-less tool handler with `(ctx)`
 * alone rather than `(args, ctx)` (`createToolExecutor` in its `mcp` chunk), and skips argument
 * validation entirely, which is exactly right for a tool taking none.
 *
 * `ctx.mcpReq.inputResponses` is a plain `Record<string, unknown>` of the *bare* responses, while
 * `ctx.mcpReq.requestState` is an *accessor function* (`RequestStateAccessor`), not a value —
 * without a `ServerOptions.requestState.verify` hook it returns the raw wire string.
 */
export function createSDKMRTRServer(): McpServer {
  const server = new McpServer(
    { name: MRTR_SERVER_NAME, version: MRTR_SERVER_VERSION },
    { capabilities: { tools: {} } },
  )
  server.registerTool(MRTR_TOOL_NAME, { description: MRTR_TOOL_DESCRIPTION }, (ctx) => {
    const view = inputResponse(ctx.mcpReq.inputResponses, MRTR_INPUT_KEY)
    if (view.kind !== 'roots') {
      return inputRequired({
        inputRequests: { [MRTR_INPUT_KEY]: inputRequired.listRoots() },
        requestState: MRTR_STATE_STRING,
      })
    }
    const state = ctx.mcpReq.requestState<string>()
    if (state !== MRTR_STATE_STRING) {
      return { content: [{ type: 'text', text: requestStateMismatch(state) }] }
    }
    return { content: [{ type: 'text', text: rootsAnswer(view.roots.length) }] }
  })
  return server
}

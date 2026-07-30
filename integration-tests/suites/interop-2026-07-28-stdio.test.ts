/**
 * mokei's `2026-07-28` wire output, checked against the official SDK's own zod schemas.
 *
 * There is no live SDK peer for this revision to test against: SDK 2.0.0's
 * `@modelcontextprotocol/core` still reports `LATEST_PROTOCOL_VERSION` /
 * `SUPPORTED_PROTOCOL_VERSIONS` as `'2025-11-25'` down to `'2024-10-07'` — `'2026-07-28'` does
 * not appear anywhere in the SDK's runtime logic, only in JSDoc prose. So an SDK server cannot
 * answer as a `2026-07-28` server and an SDK client cannot be pinned to it. What the SDK *does*
 * ship for this revision are its zod schemas and `_meta` key constants, which is what this
 * suite uses instead: mokei's `ContextClient` drives mokei's own stdio server, and every result
 * is parsed with the matching SDK schema as an independent conformance oracle.
 *
 * ## How strong is this oracle? (read before trusting an assertion below)
 *
 * All ten schemas used here (`DiscoverResultSchema`, the `List*ResultSchema`s,
 * `ReadResourceResultSchema`, `CallToolResultSchema`, `CompleteResultSchema`,
 * `GetPromptResultSchema`, `ResultMetaObjectSchema`) are zod v4 `looseObject`s — confirmed by
 * reading `@modelcontextprotocol/core`'s own source (the `ResultSchema`/`PaginatedResultSchema`
 * base in its `auth-*.mjs` chunk) and empirically, by parsing sample objects: unknown keys
 * (`resultType`, `ttlMs`, `cacheScope`) are *retained*, not stripped — the opposite of the
 * strip-by-default risk this task was written to guard against. But "retained" is a weak
 * guarantee on its own: `.parse()` succeeds identically whether those keys are present or
 * absent, and when present their *type* is completely unconstrained (a numeric `resultType` or
 * a string `ttlMs` parses without error — verified, not assumed). So per schema:
 *
 * - **SDK-backed**: every field the schema actually declares a type for (tool/prompt/resource
 *   shape, content blocks, prompt messages, pagination, `supportedVersions`, `capabilities`) —
 *   a real structural check, and the reason this suite is worth having at all.
 * - **Mokei-only**: `resultType`, `ttlMs`, `cacheScope`, and the exact value under `_meta`'s
 *   `io.modelcontextprotocol/serverInfo` key. These are asserted directly against mokei's raw
 *   result (`toBe`/`typeof` checks on the *parsed* value, since the loose passthrough means the
 *   parsed value literally *is* mokei's value here) — not because the SDK schema required or
 *   validated them, since it did neither. Every such assertion below is marked `// mokei-only`.
 * - **`ResultMetaObjectSchema` caveat**: its `serverInfo` getter is
 *   `ImplementationSchema.optional().catch(void 0)` — a malformed `serverInfo` is silently
 *   replaced with `undefined` rather than raising, so a passing `.parse()` can't by itself
 *   distinguish "no serverInfo" from "malformed serverInfo". The mokei-only assertion on the
 *   raw (pre-parse) `_meta` object closes that gap.
 *
 * `_meta` key *names* are the one place this suite gets a genuinely independent check with no
 * caveats: the SDK exports its own `*_META_KEY` string constants
 * (`@modelcontextprotocol/core/internal`), and comparing mokei's emitted keys against those
 * (rather than mokei's own `META_*` constants, which could drift right alongside a bug) would
 * catch a typo'd or stale key name that no amount of mokei-internal testing could.
 */
import {
  CallToolResultSchema,
  CompleteResultSchema,
  DiscoverResultSchema,
  GetPromptResultSchema,
  ListPromptsResultSchema,
  ListResourcesResultSchema,
  ListResourceTemplatesResultSchema,
  ListToolsResultSchema,
  ReadResourceResultSchema,
  ResultMetaObjectSchema,
} from '@modelcontextprotocol/core'
import {
  CLIENT_CAPABILITIES_META_KEY,
  CLIENT_INFO_META_KEY,
  PROTOCOL_VERSION_META_KEY,
  SERVER_INFO_META_KEY,
} from '@modelcontextprotocol/core/internal'
import { afterEach, describe, expect, test } from 'vitest'

import { checkMokeiClient } from '../support/interop/expectations.ts'
import {
  GREETING_URI,
  greetingMessage,
  ITEM_TEMPLATE_NAME,
  ITEM_TEMPLATE_URI,
  itemText,
  itemURI,
  SERVER_NAME,
  SERVER_VERSION,
} from '../support/interop/fixture.ts'
import {
  MOKEI_STDIO_SERVER_2026_07_28_PATH,
  type SpawnedMokeiClient,
  spawnMokeiStdioClient,
} from '../support/interop/servers.ts'

/** Cacheable methods carry `ttlMs`/`cacheScope`; see `packages/context-server/src/cache.ts`. */
function expectCacheHints(raw: Record<string, unknown>): void {
  // mokei-only: neither field is required or type-checked by the SDK's loose schemas.
  expect(typeof raw.ttlMs).toBe('number')
  expect(['public', 'private']).toContain(raw.cacheScope)
}

/** Every result on this revision carries `resultType: 'complete'` (`PROTOCOL.wrapResult`). */
function expectResultType(raw: Record<string, unknown>): void {
  // mokei-only: not required or type-checked by the SDK's loose schemas either.
  expect(raw.resultType).toBe('complete')
}

/** Reads the `_meta` object mokei actually put on an outgoing request's wire params. */
function requestMeta(message: Record<string, unknown>): Record<string, unknown> {
  const params = message.params as Record<string, unknown> | undefined
  return (params?._meta as Record<string, unknown> | undefined) ?? {}
}

describe('2026-07-28 over stdio, checked against the SDK schemas', () => {
  let spawned: SpawnedMokeiClient | null = null

  afterEach(async () => {
    if (spawned != null) {
      await spawned.dispose()
      spawned = null
    }
  })

  test('mokei client against the mokei server', async () => {
    spawned = await spawnMokeiStdioClient(MOKEI_STDIO_SERVER_2026_07_28_PATH, '2026-07-28')
    const { client, sent } = spawned

    // Shared tool/prompt/resource assertions, identical to the 2025-11-25 suites — no
    // `initialize()` handshake to check on this revision (see `CheckMokeiClientOptions`).
    await checkMokeiClient(client, { protocolVersion: '2026-07-28' })

    // --- server/discover --------------------------------------------------------------
    const discovered = await client.discover()
    const discoverParsed = DiscoverResultSchema.parse(discovered)
    // SDK-backed: `supportedVersions`/`capabilities` are typed fields the schema validates.
    expect(discoverParsed.supportedVersions).toContain('2026-07-28')
    expect(discoverParsed.capabilities).toMatchObject({})
    expectResultType(discoverParsed)
    expectCacheHints(discoverParsed)

    // ResultMetaObjectSchema: SDK-backed shape check of `serverInfo` when present (validated
    // against `ImplementationSchema`) — but see the module header's caveat about `.catch()`
    // swallowing a malformed value instead of failing, so also check the raw, unparsed object.
    const metaParsed = ResultMetaObjectSchema.parse(discovered._meta ?? {})
    expect(metaParsed[SERVER_INFO_META_KEY]).toMatchObject({
      name: SERVER_NAME,
      version: SERVER_VERSION,
    })
    // mokei-only: the raw value, bypassing the schema's silent-catch entirely.
    expect(
      (discovered._meta as Record<string, unknown> | undefined)?.[SERVER_INFO_META_KEY],
    ).toMatchObject({
      name: SERVER_NAME,
      version: SERVER_VERSION,
    })

    // --- tools/list ----------------------------------------------------------------------
    const toolsResult = await client.listTools()
    const toolsRaw = toolsResult as unknown as Record<string, unknown>
    const toolsParsed = ListToolsResultSchema.parse(toolsResult)
    // SDK-backed: every tool's name/description/inputSchema shape is validated by ToolSchema.
    expect(toolsParsed.tools.map((tool) => tool.name).sort()).toEqual(['echo', 'sum'])
    expectResultType(toolsRaw)
    expectCacheHints(toolsRaw)

    // --- prompts/list ----------------------------------------------------------------------
    const promptsResult = await client.listPrompts()
    const promptsRaw = promptsResult as unknown as Record<string, unknown>
    const promptsParsed = ListPromptsResultSchema.parse(promptsResult)
    expect(promptsParsed.prompts.map((prompt) => prompt.name)).toEqual(['greet'])
    expectResultType(promptsRaw)
    expectCacheHints(promptsRaw)

    // --- resources/list ----------------------------------------------------------------
    const resourcesResult = await client.listResources()
    const resourcesRaw = resourcesResult as unknown as Record<string, unknown>
    const resourcesParsed = ListResourcesResultSchema.parse(resourcesResult)
    expect(resourcesParsed.resources.map((resource) => resource.uri)).toEqual([GREETING_URI])
    expectResultType(resourcesRaw)
    expectCacheHints(resourcesRaw)

    // --- resources/templates/list --------------------------------------------------------
    const templatesResult = await client.listResourceTemplates()
    const templatesRaw = templatesResult as unknown as Record<string, unknown>
    const templatesParsed = ListResourceTemplatesResultSchema.parse(templatesResult)
    // SDK-backed: uriTemplate/name shape validated by ResourceTemplateSchema.
    expect(templatesParsed.resourceTemplates).toEqual([
      expect.objectContaining({ uriTemplate: ITEM_TEMPLATE_URI, name: ITEM_TEMPLATE_NAME }),
    ])
    expectResultType(templatesRaw)
    expectCacheHints(templatesRaw)

    // --- resources/read (a template match, not the fixed resource) -----------------------
    const itemID = '42'
    const readResult = await client.readResource({ uri: itemURI(itemID) })
    const readRaw = readResult as unknown as Record<string, unknown>
    const readParsed = ReadResourceResultSchema.parse(readResult)
    expect(readParsed.contents).toEqual([
      { uri: itemURI(itemID), mimeType: 'text/plain', text: itemText(itemID) },
    ])
    expectResultType(readRaw)
    expectCacheHints(readRaw)

    // --- tools/call (not a cacheable method: no ttlMs/cacheScope) -------------------------
    const callResult = await client.callTool({ name: 'echo', arguments: { text: 'hi' } })
    const callRaw = callResult as unknown as Record<string, unknown>
    const callParsed = CallToolResultSchema.parse(callResult)
    expect(callParsed.content).toEqual([{ type: 'text', text: 'hi' }])
    expectResultType(callRaw)
    // mokei-only: `tools/call` is absent from `CACHEABLE_METHODS` (`context-server/src/cache.ts`).
    expect(callRaw.ttlMs).toBeUndefined()
    expect(callRaw.cacheScope).toBeUndefined()

    // --- prompts/get (not cacheable either) -----------------------------------------------
    const promptResult = await client.getPrompt({ name: 'greet', arguments: { name: 'Ada' } })
    const promptRaw = promptResult as unknown as Record<string, unknown>
    const promptParsed = GetPromptResultSchema.parse(promptResult)
    expect(promptParsed.messages).toEqual([
      { role: 'user', content: { type: 'text', text: greetingMessage('Ada') } },
    ])
    expectResultType(promptRaw)
    expect(promptRaw.ttlMs).toBeUndefined()
    expect(promptRaw.cacheScope).toBeUndefined()

    // --- completion/complete (not cacheable) ----------------------------------------------
    const completeResult = await client.complete({
      ref: { type: 'ref/prompt', name: 'greet' },
      argument: { name: 'name', value: 'A' },
    })
    const completeRaw = completeResult as unknown as Record<string, unknown>
    const completeParsed = CompleteResultSchema.parse(completeResult)
    // SDK-backed: `values`/`hasMore` shape validated by CompleteResultSchema's `completion`.
    expect(completeParsed.completion.values.sort()).toEqual(['Ada', 'Alan'])
    expectResultType(completeRaw)
    expect(completeRaw.ttlMs).toBeUndefined()
    expect(completeRaw.cacheScope).toBeUndefined()

    // --- _meta key names, checked against the SDK's own constants, not mokei's -------------
    // Genuinely independent: these come from `@modelcontextprotocol/core/internal`'s own
    // `*_META_KEY` exports, not from mokei's `META_*` literals in
    // `packages/context-protocol/src/versions/2026-07-28.ts` — a typo'd or drifted key name in
    // mokei would be caught here even though no mokei-internal test could catch it.
    const discoverRequest = sent.find((message) => message.method === 'server/discover')
    expect(discoverRequest).toBeDefined()
    const sentMetaKeys = Object.keys(requestMeta(discoverRequest as Record<string, unknown>)).sort()
    expect(sentMetaKeys).toEqual(
      [PROTOCOL_VERSION_META_KEY, CLIENT_CAPABILITIES_META_KEY, CLIENT_INFO_META_KEY].sort(),
    )
    // Every other request-carrying method mokei sent on this revision must decorate `_meta`
    // with exactly the same key set (no per-method drift).
    const requestMethods = new Set([
      'server/discover',
      'tools/list',
      'prompts/list',
      'resources/list',
      'resources/templates/list',
      'resources/read',
      'tools/call',
      'prompts/get',
      'completion/complete',
    ])
    for (const message of sent) {
      if (typeof message.method === 'string' && requestMethods.has(message.method)) {
        expect(Object.keys(requestMeta(message)).sort()).toEqual(
          [PROTOCOL_VERSION_META_KEY, CLIENT_CAPABILITIES_META_KEY, CLIENT_INFO_META_KEY].sort(),
        )
      }
    }
  })
})

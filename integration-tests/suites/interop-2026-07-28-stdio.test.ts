/**
 * mokei's `2026-07-28` wire output, checked against the official SDK's own zod schemas.
 *
 * SDK `2.0.0`'s `LATEST_PROTOCOL_VERSION` is `'2025-11-25'`, but that constant only names the
 * revision its *handshake* negotiates. `2026-07-28` needs no handshake, and the SDK does
 * implement it: `FIRST_MODERN_PROTOCOL_VERSION = "2026-07-28"`,
 * `SUPPORTED_MODERN_PROTOCOL_VERSIONS`, `isModernProtocolVersion()`, a wire codec,
 * `validateEnvelopeMeta()` and a `server/discover` handler are all runtime code, not prose. Over
 * stdio that path is reached by `serveStdio` — verified by driving mokei's `ContextClient`,
 * pinned to `'2026-07-28'`, against `support/interop/sdk-stdio-server.ts`: `server/discover`
 * answers `supportedVersions: ['2026-07-28']`, and `tools/list` and `tools/call` both work.
 *
 * So a live SDK stdio peer *is* reachable on this revision, and driving one is the stronger
 * check. This suite does something narrower and complementary: it drives mokei's own server and
 * parses every result with the SDK's zod schemas, which pins mokei's *emitted* wire shape field
 * by field in a way a round trip against an SDK server does not — a peer that accepts a result
 * says nothing about which fields it looked at. Pointing this suite's mokei-against-mokei
 * expectations at the SDK peer as well is tracked in
 * `docs/agents/plans/backlog/2026-06-20-mcp-draft-remaining.md`.
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
 *   a real structural check, and the reason this suite is worth having at all. Non-vacuity of
 *   this structural validation (as opposed to the `_meta` key-name check below) was confirmed
 *   separately by feeding the installed schemas adversarial input — a malformed tool
 *   (`{ name: 123 }`), a bogus content block (`{ type: 'bogus' }`), and a `DiscoverResult`
 *   missing `supportedVersions` — and observing all three rejected.
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
 * `_meta` key *names* (and, per method, the `protocolVersion` value carried under them) are the
 * one place this suite gets a genuinely independent check with no caveats: the SDK exports its
 * own `*_META_KEY` string constants (`@modelcontextprotocol/core/internal`), and comparing
 * mokei's emitted keys/values against those (rather than mokei's own `META_*` constants, which
 * could drift right alongside a bug) would catch a typo'd or stale key name, or a wrong
 * protocol-version string, that no amount of mokei-internal testing could. Durability note:
 * `/internal` is a genuinely declared subpath in the SDK's `exports` map, not a deep reach into
 * its build output — but it's still internal, so if this import ever breaks on an SDK bump,
 * start by checking `@modelcontextprotocol/core`'s `package.json#exports` and
 * `dist/internal.d.mts` for a renamed or relocated `*_META_KEY` export.
 *
 * ## Test structure
 *
 * One spawn drives all ten schema checks and nine method checks (`spawnMokeiStdioClient`
 * doesn't cleanly support more than one connection per test, and re-spawning per method would
 * multiply an already-slow process-spawn cost tenfold for no real isolation benefit — the
 * server is stateless per this revision anyway). To avoid one broken method hiding the rest
 * behind an aborted `test()`, each method's block below runs through `runIndependently`, which
 * converts a thrown failure into a soft one and keeps going; every block's own assertions use
 * `expect.soft` for the same reason.
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
import { afterEach, describe, expect, test, vi } from 'vitest'

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
  MOKEI_STDIO_SERVER_CANCELLATION_PATH,
  type SpawnedMokeiClient,
  spawnMokeiStdioClient,
} from '../support/interop/servers.ts'

const PROTOCOL_VERSION = '2026-07-28'

/** Cacheable methods carry `ttlMs`/`cacheScope`; see `packages/context-server/src/cache.ts`. */
function expectCacheHints(raw: Record<string, unknown>): void {
  // mokei-only: neither field is required or type-checked by the SDK's loose schemas.
  expect.soft(typeof raw.ttlMs).toBe('number')
  expect.soft(['public', 'private']).toContain(raw.cacheScope)
}

/** Every result on this revision carries `resultType: 'complete'` (`PROTOCOL.wrapResult`). */
function expectResultType(raw: Record<string, unknown>): void {
  // mokei-only: not required or type-checked by the SDK's loose schemas either.
  expect.soft(raw.resultType).toBe('complete')
}

/** Reads the `_meta` object mokei actually put on an outgoing request's wire params. */
function requestMeta(message: Record<string, unknown>): Record<string, unknown> {
  const params = message.params as Record<string, unknown> | undefined
  return (params?._meta as Record<string, unknown> | undefined) ?? {}
}

const EXPECTED_REQUEST_META_KEYS = [
  PROTOCOL_VERSION_META_KEY,
  CLIENT_CAPABILITIES_META_KEY,
  CLIENT_INFO_META_KEY,
].sort()

/**
 * Every request-carrying method on this revision must decorate `_meta` with exactly this key
 * set (checked against the SDK's own constants, not mokei's — see the module header), and the
 * `protocolVersion` entry must carry this revision's actual value, not just be present.
 */
function expectRequestMeta(message: Record<string, unknown>): void {
  const meta = requestMeta(message)
  expect.soft(Object.keys(meta).sort()).toEqual(EXPECTED_REQUEST_META_KEYS)
  // mokei-only in the sense that no SDK schema types a request's `_meta`; the key itself is
  // still the SDK's own constant, so a typo'd or wrong version string is still caught here.
  expect.soft(meta[PROTOCOL_VERSION_META_KEY]).toBe(PROTOCOL_VERSION)
}

/**
 * Runs one independent section of the suite and, if it throws, converts that into a soft
 * failure so the remaining sections still run and report (see the module header's "Test
 * structure" note). Every regular `expect` inside `fn` should be `expect.soft` too, so a
 * failure inside one section doesn't hide the other assertions in *that* section either; this
 * wrapper's job is specifically to catch what `expect.soft` can't: an uncaught throw from
 * `await` or `Schema.parse()`, which would otherwise abort the whole `test()`.
 */
async function runIndependently(label: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn()
  } catch (error) {
    expect
      .soft(() => {
        throw error
      }, label)
      .not.toThrow()
  }
}

describe('2026-07-28 over stdio, checked against the SDK schemas', () => {
  let spawned: SpawnedMokeiClient | null = null

  afterEach(async () => {
    if (spawned != null) {
      await spawned.dispose()
      spawned = null
    }
  })

  /** Runs `name` with no arguments and returns the text of its first content block. */
  async function callText(client: SpawnedMokeiClient['client'], name: string): Promise<string> {
    const result = await client.callTool({ name, arguments: {} } as never)
    return (result.content[0] as { text: string }).text
  }

  /**
   * Cancellation is the one thing a client sends on this revision outside the request/response
   * path, and the reason a notification has to carry a protocol version at all: nothing else
   * tells a peer which revision an out-of-band frame belongs to. This drives it through a real
   * process boundary — the stamp has to survive serialization, not just unit-level decoration.
   *
   * This also covers the server-side handler actually aborting. `ContextRPC`'s read loop no
   * longer awaits each message's handler before reading the next
   * (`packages/context-rpc/src/rpc.ts`, `#readLoop`), so `notifications/cancelled` is read while
   * `hang`'s handler is still pending, and its `signal` aborts before the handler's own deadline
   * would otherwise settle it.
   */
  test('a cancelled tool call sends a stamped cancellation the server can place', async () => {
    spawned = await spawnMokeiStdioClient(MOKEI_STDIO_SERVER_CANCELLATION_PATH, PROTOCOL_VERSION)
    const { client, sent } = spawned

    const controller = new AbortController()
    const pending = client.callTool({
      name: 'hang',
      arguments: {},
      signal: controller.signal,
    } as never)
    pending.catch(() => {})

    // Cancelling before the call is on the wire would cancel nothing and pass for the wrong
    // reason: `request()` rejects a pre-aborted signal without writing anything at all.
    await vi.waitFor(() => {
      expect(sent.some((message) => message.method === 'tools/call')).toBe(true)
    })
    controller.abort()
    await expect(pending).rejects.toThrow()

    // The rejection settles as soon as the exchange is cancelled; the notification is written
    // after it, on a path whose result nothing awaits, so it has to be waited for separately.
    const findCancelled = () => sent.find((message) => message.method === 'notifications/cancelled')
    await vi.waitFor(() => {
      expect(findCancelled()).toBeDefined()
    })
    const cancellation = findCancelled()
    // The stamp a peer places the frame's revision by. It has no other source: there is no
    // handshake to have agreed it and no session to have recorded it.
    expect(requestMeta(cancellation as Record<string, unknown>)[PROTOCOL_VERSION_META_KEY]).toBe(
      PROTOCOL_VERSION,
    )
    // ...and only that key. The request envelope does not belong on a notification.
    expect(Object.keys(requestMeta(cancellation as Record<string, unknown>))).toEqual([
      PROTOCOL_VERSION_META_KEY,
    ])

    // The server read the frame and carried on: a notification its validator rejected would be
    // dropped, and one that killed the read loop would leave this call unanswered forever. It
    // also confirms the cancelled call was genuinely in flight when it was cancelled.
    expect(await callText(client, 'started')).toBe('true')

    // The cancellation reaches the handler that is still running — the read loop no longer
    // waits for it to settle first.
    await vi.waitFor(async () => {
      expect(await callText(client, 'aborted')).toBe('true')
    })
  })

  test('mokei client against the mokei server', async () => {
    spawned = await spawnMokeiStdioClient(MOKEI_STDIO_SERVER_2026_07_28_PATH, PROTOCOL_VERSION)
    const { client, sent } = spawned

    await runIndependently('shared tool/prompt/resource assertions (checkMokeiClient)', () =>
      // Shared tool/prompt/resource assertions, identical to the 2025-11-25 suites — no
      // `initialize()` handshake to check on this revision (see `CheckMokeiClientOptions`).
      checkMokeiClient(client, { protocolVersion: PROTOCOL_VERSION }),
    )

    let discovered: Awaited<ReturnType<typeof client.discover>> | undefined

    await runIndependently('server/discover', async () => {
      discovered = await client.discover()
      const discoverParsed = DiscoverResultSchema.parse(discovered)
      // SDK-backed: `supportedVersions`/`capabilities` are typed fields the schema validates.
      expect.soft(discoverParsed.supportedVersions).toContain(PROTOCOL_VERSION)
      // SDK-backed: the fixture's actual capability set (`packages/context-server/src/server.ts`
      // — `logging` is always on, `completions` because the fixture has a `complete` handler,
      // `prompts`/`resources`/`tools` because the fixture defines all three).
      expect.soft(discoverParsed.capabilities).toEqual({
        logging: {},
        completions: {},
        prompts: { listChanged: true },
        resources: { listChanged: true },
        tools: { listChanged: true },
      })
      expectResultType(discoverParsed)
      expectCacheHints(discoverParsed)

      // ResultMetaObjectSchema: SDK-backed shape check of `serverInfo` when present (validated
      // against `ImplementationSchema`) — but see the module header's caveat about `.catch()`
      // swallowing a malformed value instead of failing, so also check the raw, unparsed object.
      const metaParsed = ResultMetaObjectSchema.parse(discovered._meta ?? {})
      expect.soft(metaParsed[SERVER_INFO_META_KEY]).toMatchObject({
        name: SERVER_NAME,
        version: SERVER_VERSION,
      })
      // mokei-only: the raw value, bypassing the schema's silent-catch entirely.
      expect
        .soft((discovered._meta as Record<string, unknown> | undefined)?.[SERVER_INFO_META_KEY])
        .toMatchObject({ name: SERVER_NAME, version: SERVER_VERSION })
    })

    await runIndependently('tools/list', async () => {
      const toolsResult = await client.listTools()
      const toolsRaw = toolsResult as unknown as Record<string, unknown>
      const toolsParsed = ListToolsResultSchema.parse(toolsResult)
      // SDK-backed: every tool's name/description/inputSchema shape is validated by ToolSchema.
      expect.soft(toolsParsed.tools.map((tool) => tool.name).sort()).toEqual(['echo', 'sum'])
      expectResultType(toolsRaw)
      expectCacheHints(toolsRaw)
    })

    await runIndependently('prompts/list', async () => {
      const promptsResult = await client.listPrompts()
      const promptsRaw = promptsResult as unknown as Record<string, unknown>
      const promptsParsed = ListPromptsResultSchema.parse(promptsResult)
      expect.soft(promptsParsed.prompts.map((prompt) => prompt.name)).toEqual(['greet'])
      expectResultType(promptsRaw)
      expectCacheHints(promptsRaw)
    })

    await runIndependently('resources/list', async () => {
      const resourcesResult = await client.listResources()
      const resourcesRaw = resourcesResult as unknown as Record<string, unknown>
      const resourcesParsed = ListResourcesResultSchema.parse(resourcesResult)
      expect.soft(resourcesParsed.resources.map((resource) => resource.uri)).toEqual([GREETING_URI])
      expectResultType(resourcesRaw)
      expectCacheHints(resourcesRaw)
    })

    await runIndependently('resources/templates/list', async () => {
      const templatesResult = await client.listResourceTemplates()
      const templatesRaw = templatesResult as unknown as Record<string, unknown>
      const templatesParsed = ListResourceTemplatesResultSchema.parse(templatesResult)
      // SDK-backed: uriTemplate/name shape validated by ResourceTemplateSchema.
      expect
        .soft(templatesParsed.resourceTemplates)
        .toEqual([
          expect.objectContaining({ uriTemplate: ITEM_TEMPLATE_URI, name: ITEM_TEMPLATE_NAME }),
        ])
      expectResultType(templatesRaw)
      expectCacheHints(templatesRaw)
    })

    await runIndependently('resources/read', async () => {
      const itemID = '42'
      const readResult = await client.readResource({ uri: itemURI(itemID) })
      const readRaw = readResult as unknown as Record<string, unknown>
      const readParsed = ReadResourceResultSchema.parse(readResult)
      expect
        .soft(readParsed.contents)
        .toEqual([{ uri: itemURI(itemID), mimeType: 'text/plain', text: itemText(itemID) }])
      expectResultType(readRaw)
      expectCacheHints(readRaw)
    })

    await runIndependently('tools/call', async () => {
      // Not a cacheable method: no ttlMs/cacheScope.
      const callResult = await client.callTool({ name: 'echo', arguments: { text: 'hi' } })
      const callRaw = callResult as unknown as Record<string, unknown>
      const callParsed = CallToolResultSchema.parse(callResult)
      expect.soft(callParsed.content).toEqual([{ type: 'text', text: 'hi' }])
      expectResultType(callRaw)
      // mokei-only: `tools/call` is absent from `CACHEABLE_METHODS` (`context-server/src/cache.ts`).
      expect.soft(callRaw.ttlMs).toBeUndefined()
      expect.soft(callRaw.cacheScope).toBeUndefined()
    })

    await runIndependently('prompts/get', async () => {
      // Not cacheable either.
      const promptResult = await client.getPrompt({ name: 'greet', arguments: { name: 'Ada' } })
      const promptRaw = promptResult as unknown as Record<string, unknown>
      const promptParsed = GetPromptResultSchema.parse(promptResult)
      expect
        .soft(promptParsed.messages)
        .toEqual([{ role: 'user', content: { type: 'text', text: greetingMessage('Ada') } }])
      expectResultType(promptRaw)
      expect.soft(promptRaw.ttlMs).toBeUndefined()
      expect.soft(promptRaw.cacheScope).toBeUndefined()
    })

    await runIndependently('completion/complete', async () => {
      // Not cacheable.
      const completeResult = await client.complete({
        ref: { type: 'ref/prompt', name: 'greet' },
        argument: { name: 'name', value: 'A' },
      })
      const completeRaw = completeResult as unknown as Record<string, unknown>
      const completeParsed = CompleteResultSchema.parse(completeResult)
      // SDK-backed: `values`/`hasMore` shape validated by CompleteResultSchema's `completion`.
      expect.soft(completeParsed.completion.values.sort()).toEqual(['Ada', 'Alan'])
      expectResultType(completeRaw)
      expect.soft(completeRaw.ttlMs).toBeUndefined()
      expect.soft(completeRaw.cacheScope).toBeUndefined()
    })

    await runIndependently('_meta key names and protocolVersion value', async () => {
      // Genuinely independent: these come from `@modelcontextprotocol/core/internal`'s own
      // `*_META_KEY` exports, not from mokei's `META_*` literals in
      // `packages/context-protocol/src/versions/2026-07-28.ts` — a typo'd or drifted key name
      // or protocol-version value in mokei would be caught here even though no mokei-internal
      // test could catch it.
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
      // Coverage check first: the loop below only asserts on methods it finds in `sent`, so a
      // client that silently stopped sending one of them would otherwise make the loop shrink
      // and still pass. Comparing the full expected set against what was actually seen on the
      // wire makes that failure loud instead of silent.
      const sentMethods = new Set(sent.map((message) => message.method))
      const missingMethods = [...requestMethods].filter((method) => !sentMethods.has(method))
      expect.soft(missingMethods).toEqual([])

      for (const message of sent) {
        if (typeof message.method === 'string' && requestMethods.has(message.method)) {
          expectRequestMeta(message)
        }
      }
    })
  })
})

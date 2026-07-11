# Typed client extraction (`ExtractServerTypes`) is unusable

**Status:** backlog
**Found:** 2026-07-11, while giving the test suites their first-ever typecheck
(`feat/mcp-feature-gaps`).

## Gap

`ExtractServerTypes<typeof config>` is advertised — in `context-server`'s own JSDoc and in
both shipped MCP servers — as the way to get a type-safe client:

```typescript
type MyServerTypes = ExtractServerTypes<typeof config>
const client = new ContextClient<MyServerTypes>({ transport })
```

It does not work, in either direction, and both shipped servers demonstrate one failure
mode each:

- **Annotate the config's return type and the tool types are erased.**
  `createSQLiteConfig(db): ServerConfig` widens `tools` to the *optional*
  `ToolDefinitions | undefined`, which fails the `T['tools'] extends ToolDefinitions` check
  in `ExtractServerTypes`. That falls through to `Record<string, never>`, so
  `ToolParams<T>['arguments']` resolves to **`never`** and `client.callTool(...)` cannot be
  called at all.
- **Omit the annotation and the compiler gives up.** `createFetchConfig` has no return
  annotation, so the concrete definitions survive — and instantiating
  `ContextClient<FetchServerTypes>` then blows up with `TS2589: Type instantiation is
  excessively deep` / `TS2590: union type too complex`.

Underneath both: `createTool` returns `GenericToolDefinition`, not
`TypedToolDefinition<InputSchema>`. So the `T[K] extends TypedToolDefinition<infer S>`
branch of `ExtractToolTypes` can never match, and per-tool argument types cannot be
recovered even when the definitions are preserved. The typed branch is dead code.

This was invisible because no package typechecked its `test/` directory (fixed
2026-07-11) — the `mcp-servers/{sqlite,fetch}` tests use the typed client and had never
been compiled.

## Scope

1. Decide whether `createTool` can return a definition that carries its `InputSchema`
   without reintroducing TS2589. The current signature already defaults `Arguments` /
   `Output` to opaque params specifically to dodge that explosion, so this is the crux —
   any fix has to keep instantiation depth bounded.
2. If it can: make `ExtractToolTypes` recover per-tool argument types, and drop the
   widening `: ServerConfig` / `: ToolDefinitions` annotations on both shipped servers so
   the concrete definitions survive.
3. If it cannot: remove `ExtractServerTypes` / `ExtractToolTypes` / `TypedToolDefinition`
   and the JSDoc that advertises them, rather than shipping a type-safety feature that
   yields `never`.
4. Re-point `mcp-servers/{sqlite,fetch}` tests at the typed client (they currently use the
   untyped `ContextClient`, with a comment pointing here).

## Notes

- Not urgent: the untyped `ContextClient` works fine and is what every real caller uses.
  This is a broken *convenience* API, not a broken runtime path.
- Option 3 is a legitimate outcome. A deleted feature beats a feature whose happy path is
  `never`.

# @mokei/mcp-system-one

## 0.15.0

### Minor Changes

- Add JSON-authored, resumable System One decision flows (`@mokei/decision-flow`, `@mokei/decision-flow-server`) as MCP task-backed tools: static checking, retries, tracing, input elicitation, recovery, per-run approval grants, and flow references with `list_flows` and an input `decline` edge. `check_flow` reports `tool_invalid_schema` for uncompilable tool schemas. Breaking: `checkFlow` and `createDecisionFlowServer` return promises, `checkFlow` requires a `registry`, `flowPlan` takes a `lookup` argument.

- The System One MCP server exposes only `predict`; preset tools and `routerQuestions`, `guardQuestions`, `moderationQuestions`, `triageQuestions` are removed. `validateQuestions`, `validateState` and `validateResult` return Standard Schema results instead of throwing; `SystemOneClient.predict` still throws `SystemOneInputError` or `SystemOneResponseError`, and invalid backend answers now throw the latter. HTTP `400` maps to `SystemOneInputError`. Opt-in retries for transient failures. Renames: `SystemOneHTTPClientOptions` → `SystemOneHTTPClientParams`, `CreateSystemOneClientOptions` → `CreateSystemOneClientParams`; `SystemOneConnectionErrorOptions` and `SystemOneRetryableErrorOptions` removed in favour of `*Params`.

### Patch Changes

- Updated dependencies:
  - @mokei/context-server@0.15.0
  - @mokei/context-server-node@0.15.0
  - @mokei/system-one-client@0.15.0

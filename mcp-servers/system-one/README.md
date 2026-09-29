# @mokei/mcp-system-one

Expose System One classification as MCP tools: `predict`, `guard`, `moderate`, `route`, and
`triage`. Create the server config with `createSystemOneConfig({ client })`, or supply URL,
API key, and model options for its HTTP client.

The `predict` tool accepts `state`, a typed `questions` map, and an optional `model`. It
declares an `outputSchema` and returns the mapped `PredictResult` in `structuredContent`:
`model`, `answers`, and `usage` with `inputTokens` and `outputTokens`. Its text content remains
the JSON encoding of that result for clients using the previous text format. MCP-backed
decision flows require `structuredContent` and validate it against the advertised schema.

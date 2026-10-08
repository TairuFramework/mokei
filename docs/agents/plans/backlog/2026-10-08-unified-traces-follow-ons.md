# Unified traces follow-ons

**Origin:** unified traces. The initial implementation is documented in [architecture](../../architecture.md#unified-traces).

## Follow-ons

- Add a reverse-link index so a context trace can list calls made from flow traces into that context.
- Add `llm.chat` and `agent.turn` spans for `Session` and `AgentSession`.
- Add newest-first, span-filtered log paging after the `@hozon/store-log` query is available (requested upstream).
- Remove `context:message` from the wire after consumers have migrated to trace spans.
- Address Enkaku stream-handler backpressure. The subscriber bound only holds when the transport reports backpressure (requested upstream).
- Parse JSON-looking string values in hozon JSON results. Mokei escapes those strings at its store boundary (requested upstream).

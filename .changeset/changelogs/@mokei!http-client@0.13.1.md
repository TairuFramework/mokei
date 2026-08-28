## 0.13.1

### Patch Changes

- ProtocolDefinition.requiresHandshake and ProtocolDefinition.requiresPerRequestLogLevel have been removed from the exported protocol records. Both were strict functions of clientMethods, so they are replaced by two helper functions exported from the @mokei/context-protocol package root: isHandshakeRequired(protocol) and isPerRequestLogLevel(protocol). Call sites that previously read protocol.requiresHandshake or protocol.requiresPerRequestLogLevel should call the corresponding helper instead. This is a runtime record-shape change, released as a patch because these fields have no known external consumers.

  A server that has begun disposing now rejects any newly-dispatched inbound request with a new JSON-RPC error, SERVER_SHUTTING_DOWN = -32000, exported from @mokei/context-protocol. This code is a mokei extension outside the MCP-reserved -32020..-32099 band. Notifications and in-flight or already-held responses still flow normally during the disposal window; only new requests are rejected. This is the one runtime-behavior change in @mokei/context-rpc.

  @mokei/http-client has gained a refreshTimeout transport param and an exported DEFAULT_HTTP_REFRESH_TIMEOUT constant (10000ms). This bounds the internal schema-refresh independently of the request timeout, so a stale-schema retry can no longer chain up to three full request budgets.

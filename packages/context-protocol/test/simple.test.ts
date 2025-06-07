describe('Simple MCP Protocol Version Test', () => {
  test('should verify protocol version 2025-03-26', async () => {
    const { LATEST_PROTOCOL_VERSION } = await import('../lib/rpc.js')
    expect(LATEST_PROTOCOL_VERSION).toBe('2025-03-26')
  })

  test('should verify JSON-RPC version', async () => {
    const { JSONRPC_VERSION } = await import('../lib/rpc.js')
    expect(JSONRPC_VERSION).toBe('2.0')
  })

  test('should verify error codes', async () => {
    const { PARSE_ERROR, INVALID_REQUEST, METHOD_NOT_FOUND, INVALID_PARAMS, INTERNAL_ERROR } =
      await import('../lib/rpc.js')
    expect(PARSE_ERROR).toBe(-32700)
    expect(INVALID_REQUEST).toBe(-32600)
    expect(METHOD_NOT_FOUND).toBe(-32601)
    expect(INVALID_PARAMS).toBe(-32602)
    expect(INTERNAL_ERROR).toBe(-32603)
  })
})

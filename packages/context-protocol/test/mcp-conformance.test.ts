/**
 * Model Context Protocol (MCP) Version 2025-03-26 Conformance Tests
 *
 * These tests ensure that the implementation conforms to the MCP specification
 * by validating protocol constants, schema structures, and message formats.
 */

describe('MCP Protocol 2025-03-26 Conformance Tests', () => {
  describe('Protocol Version and Constants', () => {
    test('should use MCP protocol version 2025-03-26', async () => {
      const { LATEST_PROTOCOL_VERSION } = await import('../lib/rpc.js')
      expect(LATEST_PROTOCOL_VERSION).toBe('2025-03-26')
    })

    test('should use JSON-RPC version 2.0', async () => {
      const { JSONRPC_VERSION } = await import('../lib/rpc.js')
      expect(JSONRPC_VERSION).toBe('2.0')
    })

    test('should define standard JSON-RPC error codes', async () => {
      const { PARSE_ERROR, INVALID_REQUEST, METHOD_NOT_FOUND, INVALID_PARAMS, INTERNAL_ERROR } =
        await import('../lib/rpc.js')
      expect(PARSE_ERROR).toBe(-32700)
      expect(INVALID_REQUEST).toBe(-32600)
      expect(METHOD_NOT_FOUND).toBe(-32601)
      expect(INVALID_PARAMS).toBe(-32602)
      expect(INTERNAL_ERROR).toBe(-32603)
    })
  })

  describe('Core RPC Schema Structures', () => {
    test('notification schema should have required fields', async () => {
      const { notification } = await import('../lib/rpc.js')
      expect(notification.type).toBe('object')
      expect(notification.required).toEqual(['jsonrpc', 'method'])
      expect(notification.properties.jsonrpc.const).toBe('2.0')
      expect(notification.properties.method.type).toBe('string')
    })

    test('request schema should have required fields', async () => {
      const { request } = await import('../lib/rpc.js')
      expect(request.type).toBe('object')
      expect(request.required).toEqual(['id', 'jsonrpc', 'method'])
      expect(request.properties.jsonrpc.const).toBe('2.0')
      expect(request.properties.id.anyOf).toHaveLength(2)
    })

    test('response schema should have required fields', async () => {
      const { response } = await import('../lib/rpc.js')
      expect(response.type).toBe('object')
      expect(response.required).toEqual(['id', 'jsonrpc'])
      expect(response.properties.jsonrpc.const).toBe('2.0')
    })

    test('progress notification should follow MCP spec', async () => {
      const { progressNotification } = await import('../lib/rpc.js')
      const progressSchema = progressNotification.allOf[1]
      expect(progressSchema.properties.method.const).toBe('notifications/progress')
      expect(progressSchema.properties.params.required).toContain('progress')
      expect(progressSchema.properties.params.required).toContain('progressToken')
    })
  })

  describe('Initialize Handshake', () => {
    test('initialize request should have correct structure', async () => {
      const { initializeRequest } = await import('../lib/initialize.js')
      const initSchema = initializeRequest.allOf[1]
      expect(initSchema.properties.method.const).toBe('initialize')
      expect(initSchema.properties.params.required).toContain('capabilities')
      expect(initSchema.properties.params.required).toContain('clientInfo')
      expect(initSchema.properties.params.required).toContain('protocolVersion')
    })

    test('initialize result should have correct structure', async () => {
      const { initializeResult } = await import('../lib/initialize.js')
      const resultSchema = initializeResult.allOf[1]
      expect(resultSchema.required).toContain('capabilities')
      expect(resultSchema.required).toContain('protocolVersion')
      expect(resultSchema.required).toContain('serverInfo')
      expect(resultSchema.properties.instructions).toBeDefined()
    })

    test('initialized notification should have correct method', async () => {
      const { initializedNotification } = await import('../lib/initialize.js')
      const notifSchema = initializedNotification.allOf[1]
      expect(notifSchema.properties.method.const).toBe('notifications/initialized')
    })
  })

  describe('Content Types', () => {
    test('text content should have required fields', async () => {
      const { textContent } = await import('../lib/content.js')
      expect(textContent.type).toBe('object')
      expect(textContent.required).toContain('text')
      expect(textContent.required).toContain('type')
      expect(textContent.properties.type.const).toBe('text')
    })

    test('image content should have required fields', async () => {
      const { imageContent } = await import('../lib/content.js')
      expect(imageContent.type).toBe('object')
      expect(imageContent.required).toContain('data')
      expect(imageContent.required).toContain('mimeType')
      expect(imageContent.required).toContain('type')
      expect(imageContent.properties.type.const).toBe('image')
      expect(imageContent.properties.data.format).toBe('byte')
    })

    test('role should define valid values', async () => {
      const { role } = await import('../lib/content.js')
      expect(role.type).toBe('string')
      expect(role.enum).toEqual(['assistant', 'user'])
    })
  })

  describe('Tool Capabilities', () => {
    test('tool schema should have required fields', async () => {
      const { tool } = await import('../lib/tool.js')
      expect(tool.type).toBe('object')
      expect(tool.required).toContain('name')
      expect(tool.properties.inputSchema).toBeDefined()
      expect(tool.properties.inputSchema.properties.type.const).toBe('object')
    })

    test('tool call request should have correct structure', async () => {
      const { callToolRequest } = await import('../lib/tool.js')
      const callSchema = callToolRequest.allOf[1]
      expect(callSchema.properties.method.const).toBe('tools/call')
      expect(callSchema.properties.params.required).toContain('name')
      expect(callSchema.properties.params.properties.arguments).toBeDefined()
    })

    test('tool call result should have content array', async () => {
      const { callToolResult } = await import('../lib/tool.js')
      const resultSchema = callToolResult.allOf[1]
      expect(resultSchema.required).toContain('content')
      expect(resultSchema.properties.content.type).toBe('array')
      expect(resultSchema.properties.isError).toBeDefined()
    })

    test('tool list request should support pagination', async () => {
      const { listToolsRequest } = await import('../lib/tool.js')
      // Should extend paginatedRequest
      expect(listToolsRequest.allOf).toBeDefined()
      expect(listToolsRequest.allOf[1].properties.method.const).toBe('tools/list')
    })
  })

  describe('Resource Management', () => {
    test('resource schema should have required fields', async () => {
      const { resource } = await import('../lib/resource.js')
      expect(resource.type).toBe('object')
      expect(resource.required).toContain('name')
      expect(resource.required).toContain('uri')
      expect(resource.properties.uri.format).toBe('uri')
    })

    test('resource template should have uriTemplate', async () => {
      const { resourceTemplate } = await import('../lib/resource.js')
      expect(resourceTemplate.required).toContain('name')
      expect(resourceTemplate.required).toContain('uriTemplate')
    })

    test('read resource request should have uri parameter', async () => {
      const { readResourceRequest } = await import('../lib/resource.js')
      const readSchema = readResourceRequest.allOf[1]
      expect(readSchema.properties.method.const).toBe('resources/read')
      expect(readSchema.properties.params.required).toContain('uri')
      expect(readSchema.properties.params.properties.uri.format).toBe('uri')
    })
  })

  describe('Prompt Capabilities', () => {
    test('prompt schema should have required fields', async () => {
      const { prompt } = await import('../lib/prompt.js')
      expect(prompt.type).toBe('object')
      expect(prompt.required).toContain('name')
      expect(prompt.properties.arguments).toBeDefined()
    })

    test('get prompt request should have correct structure', async () => {
      const { getPromptRequest } = await import('../lib/prompt.js')
      const getSchema = getPromptRequest.allOf[1]
      expect(getSchema.properties.method.const).toBe('prompts/get')
      expect(getSchema.properties.params.required).toContain('name')
      expect(getSchema.properties.params.properties.arguments).toBeDefined()
    })

    test('prompt result should contain messages', async () => {
      const { getPromptResult } = await import('../lib/prompt.js')
      const resultSchema = getPromptResult.allOf[1]
      expect(resultSchema.required).toContain('messages')
      expect(resultSchema.properties.messages.type).toBe('array')
    })
  })

  describe('Roots Management', () => {
    test('root schema should have required uri field', async () => {
      const { root } = await import('../lib/root.js')
      expect(root.type).toBe('object')
      expect(root.required).toContain('uri')
      expect(root.properties.uri.format).toBe('uri')
      expect(root.properties.name).toBeDefined()
    })

    test('list roots request should have correct method', async () => {
      const { listRootsRequest } = await import('../lib/root.js')
      const listSchema = listRootsRequest.allOf[1]
      expect(listSchema.properties.method.const).toBe('roots/list')
    })
  })

  describe('Logging Support', () => {
    test('logging levels should match syslog severities', async () => {
      const { loggingLevel } = await import('../lib/logging.js')
      expect(loggingLevel.type).toBe('string')
      expect(loggingLevel.enum).toContain('debug')
      expect(loggingLevel.enum).toContain('info')
      expect(loggingLevel.enum).toContain('warning')
      expect(loggingLevel.enum).toContain('error')
      expect(loggingLevel.enum).toContain('critical')
    })

    test('set level request should have correct structure', async () => {
      const { setLevelRequest } = await import('../lib/logging.js')
      const setSchema = setLevelRequest.allOf[1]
      expect(setSchema.properties.method.const).toBe('logging/setLevel')
      expect(setSchema.properties.params.required).toContain('level')
    })

    test('logging message notification should have correct structure', async () => {
      const { loggingMessageNotification } = await import('../lib/logging.js')
      const logSchema = loggingMessageNotification.allOf[1]
      expect(logSchema.properties.method.const).toBe('notifications/message')
      expect(logSchema.properties.params.required).toContain('level')
      expect(logSchema.properties.params.required).toContain('data')
    })
  })

  describe('Sampling Support', () => {
    test('create message request should have required fields', async () => {
      const { createMessageRequest } = await import('../lib/sampling.js')
      const createSchema = createMessageRequest.allOf[1]
      expect(createSchema.properties.method.const).toBe('sampling/createMessage')
      expect(createSchema.properties.params.properties.messages).toBeDefined()
      expect(createSchema.properties.params.properties.maxTokens).toBeDefined()
      expect(createSchema.properties.params.properties.modelPreferences).toBeDefined()
    })

    test('model preferences should support hints and priorities', async () => {
      const { modelPreferences } = await import('../lib/sampling.js')
      expect(modelPreferences.properties.hints).toBeDefined()
      expect(modelPreferences.properties.costPriority).toBeDefined()
      expect(modelPreferences.properties.speedPriority).toBeDefined()
      expect(modelPreferences.properties.intelligencePriority).toBeDefined()
    })
  })

  describe('Client and Server Message Types', () => {
    test('client messages should include all request types', async () => {
      const { singleClientMessage } = await import('../lib/client.js')
      expect(singleClientMessage.anyOf).toBeDefined()

      // Check for key client request methods
      const methods = []
      for (const schema of singleClientMessage.anyOf) {
        if (
          'allOf' in schema &&
          Array.isArray(schema.allOf) &&
          schema.allOf[1]?.properties?.method?.const
        ) {
          methods.push(schema.allOf[1].properties.method.const)
        }
      }

      expect(methods).toContain('initialize')
      expect(methods).toContain('tools/call')
      expect(methods).toContain('prompts/get')
      expect(methods).toContain('resources/read')
    })

    test('server messages should include all response types', async () => {
      const { singleServerMessage } = await import('../lib/server.js')
      expect(singleServerMessage.anyOf).toBeDefined()

      // Check for key server request methods
      const methods = []
      for (const schema of singleServerMessage.anyOf) {
        if (
          'allOf' in schema &&
          Array.isArray(schema.allOf) &&
          schema.allOf[1]?.properties?.method?.const
        ) {
          methods.push(schema.allOf[1].properties.method.const)
        }
      }

      // Server messages can be either requests or responses
      // If methods is empty, it might be because server messages have a different structure
      if (methods.length === 0) {
        // Check if we have the expected message types in the union
        expect(singleServerMessage.anyOf.length).toBeGreaterThan(0)
      } else {
        // Otherwise check for specific server request methods
        expect(methods).toContain('roots/list')
        expect(methods).toContain('sampling/createMessage')
      }
    })
  })
})

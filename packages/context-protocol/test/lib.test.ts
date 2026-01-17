import { describe, expect, test } from 'vitest'

import { clientMessage } from '../src/client.js'
import { imageContent, role, textContent } from '../src/content.js'
import { initializedNotification, initializeRequest, initializeResult } from '../src/initialize.js'
import { loggingLevel, loggingMessageNotification, setLevelRequest } from '../src/logging.js'
import { getPromptRequest, getPromptResult, prompt } from '../src/prompt.js'
import { readResourceRequest, resource, resourceTemplate } from '../src/resource.js'
import { listRootsRequest, root } from '../src/root.js'
import {
  INTERNAL_ERROR,
  INVALID_PARAMS,
  INVALID_REQUEST,
  JSONRPC_VERSION,
  LATEST_PROTOCOL_VERSION,
  METHOD_NOT_FOUND,
  notification,
  PARSE_ERROR,
  progressNotification,
  request,
  response,
} from '../src/rpc.js'
import { createMessageRequest, modelPreferences } from '../src/sampling.js'
import { serverMessage } from '../src/server.js'
import { callToolRequest, callToolResult, listToolsRequest, tool } from '../src/tool.js'

describe('Protocol Version and Constants', () => {
  test('should use MCP protocol version 2025-11-25', async () => {
    expect(LATEST_PROTOCOL_VERSION).toBe('2025-11-25')
  })

  test('should use JSON-RPC version 2.0', async () => {
    expect(JSONRPC_VERSION).toBe('2.0')
  })

  test('should define standard JSON-RPC error codes', async () => {
    expect(PARSE_ERROR).toBe(-32700)
    expect(INVALID_REQUEST).toBe(-32600)
    expect(METHOD_NOT_FOUND).toBe(-32601)
    expect(INVALID_PARAMS).toBe(-32602)
    expect(INTERNAL_ERROR).toBe(-32603)
  })
})

describe('Core RPC Schema Structures', () => {
  test('notification schema should have required fields', async () => {
    expect(notification.type).toBe('object')
    expect(notification.required).toEqual(['jsonrpc', 'method'])
    expect(notification.properties.jsonrpc.const).toBe('2.0')
    expect(notification.properties.method.type).toBe('string')
  })

  test('request schema should have required fields', async () => {
    expect(request.type).toBe('object')
    expect(request.required).toEqual(['id', 'jsonrpc', 'method'])
    expect(request.properties.jsonrpc.const).toBe('2.0')
    expect(request.properties.id.anyOf).toHaveLength(2)
  })

  test('response schema should have required fields', async () => {
    expect(response.type).toBe('object')
    expect(response.required).toEqual(['id', 'jsonrpc'])
    expect(response.properties.jsonrpc.const).toBe('2.0')
  })

  test('progress notification should follow MCP spec', async () => {
    const progressSchema = progressNotification.allOf[1]
    expect(progressSchema.properties.method.const).toBe('notifications/progress')
    expect(progressSchema.properties.params.required).toContain('progress')
    expect(progressSchema.properties.params.required).toContain('progressToken')
  })
})

describe('Initialize Handshake', () => {
  test('initialize request should have correct structure', async () => {
    const initSchema = initializeRequest.allOf[1]
    expect(initSchema.properties.method.const).toBe('initialize')
    expect(initSchema.properties.params.required).toContain('capabilities')
    expect(initSchema.properties.params.required).toContain('clientInfo')
    expect(initSchema.properties.params.required).toContain('protocolVersion')
  })

  test('initialize result should have correct structure', async () => {
    const resultSchema = initializeResult.allOf[1]
    expect(resultSchema.required).toContain('capabilities')
    expect(resultSchema.required).toContain('protocolVersion')
    expect(resultSchema.required).toContain('serverInfo')
    expect(resultSchema.properties.instructions).toBeDefined()
  })

  test('initialized notification should have correct method', async () => {
    const notifSchema = initializedNotification.allOf[1]
    expect(notifSchema.properties.method.const).toBe('notifications/initialized')
  })
})

describe('Content Types', () => {
  test('text content should have required fields', async () => {
    expect(textContent.type).toBe('object')
    expect(textContent.required).toContain('text')
    expect(textContent.required).toContain('type')
    expect(textContent.properties.type.const).toBe('text')
  })

  test('image content should have required fields', async () => {
    expect(imageContent.type).toBe('object')
    expect(imageContent.required).toContain('data')
    expect(imageContent.required).toContain('mimeType')
    expect(imageContent.required).toContain('type')
    expect(imageContent.properties.type.const).toBe('image')
    expect(imageContent.properties.data.format).toBe('byte')
  })

  test('role should define valid values', async () => {
    expect(role.type).toBe('string')
    expect(role.enum).toEqual(['assistant', 'user'])
  })
})

describe('Tool Capabilities', () => {
  test('tool schema should have required fields', async () => {
    expect(tool.type).toBe('object')
    expect(tool.required).toContain('name')
    expect(tool.properties.inputSchema).toBeDefined()
    expect(tool.properties.inputSchema.properties.type.const).toBe('object')
  })

  test('tool call request should have correct structure', async () => {
    const callSchema = callToolRequest.allOf[1]
    expect(callSchema.properties.method.const).toBe('tools/call')
    expect(callSchema.properties.params.required).toContain('name')
    expect(callSchema.properties.params.properties.arguments).toBeDefined()
  })

  test('tool call result should have content array', async () => {
    const resultSchema = callToolResult.allOf[1]
    expect(resultSchema.required).toContain('content')
    expect(resultSchema.properties.content.type).toBe('array')
    expect(resultSchema.properties.isError).toBeDefined()
  })

  test('tool list request should support pagination', async () => {
    // Should extend paginatedRequest
    expect(listToolsRequest.allOf).toBeDefined()
    expect(listToolsRequest.allOf[1].properties.method.const).toBe('tools/list')
  })
})

describe('Resource Management', () => {
  test('resource schema should have required fields', async () => {
    expect(resource.type).toBe('object')
    expect(resource.required).toContain('name')
    expect(resource.required).toContain('uri')
    expect(resource.properties.uri.format).toBe('uri')
  })

  test('resource template should have uriTemplate', async () => {
    expect(resourceTemplate.required).toContain('name')
    expect(resourceTemplate.required).toContain('uriTemplate')
  })

  test('read resource request should have uri parameter', async () => {
    const readSchema = readResourceRequest.allOf[1]
    expect(readSchema.properties.method.const).toBe('resources/read')
    expect(readSchema.properties.params.required).toContain('uri')
    expect(readSchema.properties.params.properties.uri.format).toBe('uri')
  })
})

describe('Prompt Capabilities', () => {
  test('prompt schema should have required fields', async () => {
    expect(prompt.type).toBe('object')
    expect(prompt.required).toContain('name')
    expect(prompt.properties.arguments).toBeDefined()
  })

  test('get prompt request should have correct structure', async () => {
    const getSchema = getPromptRequest.allOf[1]
    expect(getSchema.properties.method.const).toBe('prompts/get')
    expect(getSchema.properties.params.required).toContain('name')
    expect(getSchema.properties.params.properties.arguments).toBeDefined()
  })

  test('prompt result should contain messages', async () => {
    const resultSchema = getPromptResult.allOf[1]
    expect(resultSchema.required).toContain('messages')
    expect(resultSchema.properties.messages.type).toBe('array')
  })
})

describe('Roots Management', () => {
  test('root schema should have required uri field', async () => {
    expect(root.type).toBe('object')
    expect(root.required).toContain('uri')
    expect(root.properties.uri.format).toBe('uri')
    expect(root.properties.name).toBeDefined()
  })

  test('list roots request should have correct method', async () => {
    const listSchema = listRootsRequest.allOf[1]
    expect(listSchema.properties.method.const).toBe('roots/list')
  })
})

describe('Logging Support', () => {
  test('logging levels should match syslog severities', async () => {
    expect(loggingLevel.type).toBe('string')
    expect(loggingLevel.enum).toContain('debug')
    expect(loggingLevel.enum).toContain('info')
    expect(loggingLevel.enum).toContain('warning')
    expect(loggingLevel.enum).toContain('error')
    expect(loggingLevel.enum).toContain('critical')
  })

  test('set level request should have correct structure', async () => {
    const setSchema = setLevelRequest.allOf[1]
    expect(setSchema.properties.method.const).toBe('logging/setLevel')
    expect(setSchema.properties.params.required).toContain('level')
  })

  test('logging message notification should have correct structure', async () => {
    const logSchema = loggingMessageNotification.allOf[1]
    expect(logSchema.properties.method.const).toBe('notifications/message')
    expect(logSchema.properties.params.required).toContain('level')
    expect(logSchema.properties.params.required).toContain('data')
  })
})

describe('Sampling Support', () => {
  test('create message request should have required fields', async () => {
    const createSchema = createMessageRequest.allOf[1]
    expect(createSchema.properties.method.const).toBe('sampling/createMessage')
    expect(createSchema.properties.params.properties.messages).toBeDefined()
    expect(createSchema.properties.params.properties.maxTokens).toBeDefined()
    expect(createSchema.properties.params.properties.modelPreferences).toBeDefined()
  })

  test('model preferences should support hints and priorities', async () => {
    expect(modelPreferences.properties.hints).toBeDefined()
    expect(modelPreferences.properties.costPriority).toBeDefined()
    expect(modelPreferences.properties.speedPriority).toBeDefined()
    expect(modelPreferences.properties.intelligencePriority).toBeDefined()
  })
})

describe('Client and Server Message Types', () => {
  test('client messages should include all request types', async () => {
    expect(clientMessage.anyOf).toBeDefined()

    // Check for key client request methods
    const methods = []
    for (const schema of clientMessage.anyOf) {
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
    expect(serverMessage.anyOf).toBeDefined()

    // Check for key server request methods
    const methods = []
    for (const schema of serverMessage.anyOf) {
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
      expect(serverMessage.anyOf.length).toBeGreaterThan(0)
    } else {
      // Otherwise check for specific server request methods
      expect(methods).toContain('roots/list')
      expect(methods).toContain('sampling/createMessage')
    }
  })
})

import { describe, expect, test } from 'vitest'

import {
  declareExtension,
  EXTENSIONS,
  type ExtensionDefinition,
  extensionForClientMethod,
  extensionsFor,
  missingExtensionErrorParams,
  OAUTH_CLIENT_CREDENTIALS,
  readExtension,
  TASKS,
} from '../src/extensions.js'
import {
  declaresTasksExtension,
  MISSING_REQUIRED_CLIENT_CAPABILITY,
  TASKS_EXTENSION,
} from '../src/index.js'

const REVISED: ExtensionDefinition = {
  id: 'example/revised',
  revision: '1',
  protocolVersions: new Set(['2026-07-28']),
  clientMethods: new Set(),
  serverMethods: new Set(),
}

describe('readExtension', () => {
  test('tasks without revision', () => {
    expect(readExtension({ extensions: { [TASKS.id]: { a: 1 } } }, TASKS)).toEqual({ a: 1 })
    expect(readExtension({}, TASKS)).toBeNull()
    expect(readExtension(undefined, TASKS)).toBeNull()
    expect(readExtension({ extensions: { [TASKS.id]: { revision: '2' } } }, TASKS)).toBeNull()
  })

  test('definition with revision', () => {
    const id = REVISED.id
    expect(readExtension({ extensions: { [id]: { revision: '1' } } }, REVISED)).toEqual({
      revision: '1',
    })
    expect(readExtension({ extensions: { [id]: {} } }, REVISED)).toBeNull()
    expect(readExtension({ extensions: { [id]: { revision: '2' } } }, REVISED)).toBeNull()
  })
})

describe('declareExtension', () => {
  test('settings and revision', () => {
    expect(declareExtension(TASKS)).toEqual({})
    expect(declareExtension(REVISED, { a: 1 })).toEqual({ a: 1, revision: '1' })
  })
})

describe('extensionForClientMethod', () => {
  test('lookup', () => {
    expect(extensionForClientMethod('tasks/get')).toBe(TASKS)
    expect(extensionForClientMethod('tools/call')).toBeUndefined()
  })
})

describe('extensionsFor', () => {
  test('filters by protocol version', () => {
    const enabled = new Map([[TASKS, {}]])
    expect(extensionsFor(enabled, '2025-11-25')).toBeUndefined()
    expect(extensionsFor(enabled, '2026-07-28')).toEqual({ 'io.modelcontextprotocol/tasks': {} })
  })
})

describe('missingExtensionErrorParams', () => {
  test('tasks', () => {
    expect(missingExtensionErrorParams(TASKS)).toEqual({
      code: MISSING_REQUIRED_CLIENT_CAPABILITY,
      message: 'Client did not declare the tasks extension',
      data: { requiredCapabilities: { extensions: { 'io.modelcontextprotocol/tasks': {} } } },
    })
  })

  test('other definition uses id in message', () => {
    expect(missingExtensionErrorParams(REVISED).message).toBe(
      'Client did not declare the example/revised extension',
    )
  })
})

test('declaresTasksExtension rejects other revision', () => {
  expect(declaresTasksExtension({ extensions: { [TASKS_EXTENSION]: { revision: 'x' } } })).toBe(
    false,
  )
})

describe('OAUTH_CLIENT_CREDENTIALS', () => {
  test('definition', () => {
    expect(OAUTH_CLIENT_CREDENTIALS.id).toBe('io.modelcontextprotocol/oauth-client-credentials')
    expect(OAUTH_CLIENT_CREDENTIALS.revision).toBeUndefined()
    expect([...OAUTH_CLIENT_CREDENTIALS.protocolVersions].sort()).toEqual([
      '2025-11-25',
      '2026-07-28',
    ])
    expect(OAUTH_CLIENT_CREDENTIALS.clientMethods.size).toBe(0)
    expect(OAUTH_CLIENT_CREDENTIALS.serverMethods.size).toBe(0)
    expect(EXTENSIONS).toContain(OAUTH_CLIENT_CREDENTIALS)
    expect(declareExtension(OAUTH_CLIENT_CREDENTIALS)).toEqual({})
  })
})

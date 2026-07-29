import { describe, expect, test } from 'vitest'

import {
  HEADER_MISMATCH,
  isSupportedProtocolVersion,
  LATEST_PROTOCOL_VERSION,
  MISSING_REQUIRED_CLIENT_CAPABILITY,
  PROTOCOL_VERSIONS,
  UNSUPPORTED_PROTOCOL_VERSION,
} from '../src/index.js'

describe('protocol versions', () => {
  test('lists both supported revisions, newest first', () => {
    expect(PROTOCOL_VERSIONS).toEqual(['2026-07-28', '2025-11-25'])
    expect(LATEST_PROTOCOL_VERSION).toBe('2026-07-28')
  })

  test('recognises supported revisions only', () => {
    expect(isSupportedProtocolVersion('2026-07-28')).toBe(true)
    expect(isSupportedProtocolVersion('2025-11-25')).toBe(true)
    expect(isSupportedProtocolVersion('1900-01-01')).toBe(false)
  })

  test('allocates the spec-reserved error codes', () => {
    expect(HEADER_MISMATCH).toBe(-32020)
    expect(MISSING_REQUIRED_CLIENT_CAPABILITY).toBe(-32021)
    expect(UNSUPPORTED_PROTOCOL_VERSION).toBe(-32022)
  })
})

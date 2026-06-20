import { describe, expect, test } from 'vitest'

import {
  buildParamHeaders,
  collectHeaderAnnotations,
  encodeHeaderValue,
  isValidHeaderParamName,
} from '../src/x-mcp-header.js'

describe('encodeHeaderValue', () => {
  test('passes plain ASCII strings through unchanged', () => {
    expect(encodeHeaderValue('us-east-1')).toBe('us-east-1')
  })

  test('stringifies integers as decimal', () => {
    expect(encodeHeaderValue(42)).toBe('42')
  })

  test('stringifies booleans as true/false', () => {
    expect(encodeHeaderValue(true)).toBe('true')
    expect(encodeHeaderValue(false)).toBe('false')
  })

  test('rejects non-integer numbers', () => {
    expect(() => encodeHeaderValue(1.5)).toThrow()
  })

  test('base64-wraps non-ASCII values', () => {
    expect(encodeHeaderValue('café')).toBe(`=?base64?${btoa('cafÃ©')}?=`)
  })

  test('base64-wraps values with leading/trailing whitespace', () => {
    const encoded = encodeHeaderValue(' x')
    expect(encoded.startsWith('=?base64?')).toBe(true)
  })

  test('base64-wraps values with control characters', () => {
    const encoded = encodeHeaderValue('a\nb')
    expect(encoded.startsWith('=?base64?')).toBe(true)
  })

  test('base64-wraps plain values that collide with the sentinel pattern', () => {
    const encoded = encodeHeaderValue('=?base64?abc?=')
    expect(encoded.startsWith('=?base64?')).toBe(true)
    expect(encoded).not.toBe('=?base64?abc?=')
  })
})

describe('isValidHeaderParamName', () => {
  test('accepts RFC 9110 token characters', () => {
    expect(isValidHeaderParamName('Region')).toBe(true)
    expect(isValidHeaderParamName('X-Tenant_id.v1')).toBe(true)
  })

  test('rejects empty and invalid names', () => {
    expect(isValidHeaderParamName('')).toBe(false)
    expect(isValidHeaderParamName('has space')).toBe(false)
    expect(isValidHeaderParamName('bad/slash')).toBe(false)
  })
})

describe('collectHeaderAnnotations', () => {
  test('collects annotations at top level and nested depth', () => {
    const schema = {
      type: 'object',
      properties: {
        region: { type: 'string', 'x-mcp-header': 'Region' },
        nested: {
          type: 'object',
          properties: {
            tenant: { type: 'integer', 'x-mcp-header': 'Tenant' },
          },
        },
      },
    }
    const result = collectHeaderAnnotations(schema)
    expect(result.valid).toBe(true)
    expect(result.annotations).toEqual([
      { headerName: 'Region', path: ['region'] },
      { headerName: 'Tenant', path: ['nested', 'tenant'] },
    ])
  })

  test('flags invalid header name', () => {
    const schema = {
      type: 'object',
      properties: { region: { type: 'string', 'x-mcp-header': 'bad space' } },
    }
    const result = collectHeaderAnnotations(schema)
    expect(result.valid).toBe(false)
  })

  test('flags case-insensitive duplicates', () => {
    const schema = {
      type: 'object',
      properties: {
        a: { type: 'string', 'x-mcp-header': 'Region' },
        b: { type: 'string', 'x-mcp-header': 'region' },
      },
    }
    const result = collectHeaderAnnotations(schema)
    expect(result.valid).toBe(false)
  })

  test('flags non-primitive (number) annotated types', () => {
    const schema = {
      type: 'object',
      properties: { ratio: { type: 'number', 'x-mcp-header': 'Ratio' } },
    }
    const result = collectHeaderAnnotations(schema)
    expect(result.valid).toBe(false)
  })

  test('accepts nullable primitive union types', () => {
    const schema = {
      type: 'object',
      properties: { region: { type: ['string', 'null'], 'x-mcp-header': 'Region' } },
    }
    const result = collectHeaderAnnotations(schema)
    expect(result.valid).toBe(true)
    expect(result.annotations).toEqual([{ headerName: 'Region', path: ['region'] }])
  })

  test('flags union types containing a non-primitive member', () => {
    const schema = {
      type: 'object',
      properties: { x: { type: ['string', 'object'], 'x-mcp-header': 'X' } },
    }
    const result = collectHeaderAnnotations(schema)
    expect(result.valid).toBe(false)
  })

  test('returns no annotations for plain schema', () => {
    const schema = { type: 'object', properties: { q: { type: 'string' } } }
    const result = collectHeaderAnnotations(schema)
    expect(result.valid).toBe(true)
    expect(result.annotations).toEqual([])
  })

  test('collects an annotation behind a $ref', () => {
    const schema = {
      type: 'object',
      properties: { region: { $ref: '#/$defs/Region' } },
      $defs: { Region: { type: 'string', 'x-mcp-header': 'Region' } },
    }
    const result = collectHeaderAnnotations(schema)
    expect(result.valid).toBe(true)
    expect(result.annotations).toEqual([{ headerName: 'Region', path: ['region'] }])
  })

  test('collects an annotation inside an anyOf branch', () => {
    const schema = {
      type: 'object',
      anyOf: [{ properties: { tenant: { type: 'string', 'x-mcp-header': 'Tenant' } } }],
    }
    const result = collectHeaderAnnotations(schema)
    expect(result.valid).toBe(true)
    expect(result.annotations).toEqual([{ headerName: 'Tenant', path: ['tenant'] }])
  })

  test('flags the same annotation repeated across composite branches as duplicate', () => {
    const schema = {
      type: 'object',
      allOf: [
        { properties: { a: { type: 'string', 'x-mcp-header': 'Dup' } } },
        { properties: { b: { type: 'string', 'x-mcp-header': 'Dup' } } },
      ],
    }
    const result = collectHeaderAnnotations(schema)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('Duplicate'))).toBe(true)
  })

  test('errors on an annotation inside array items', () => {
    const schema = {
      type: 'object',
      properties: {
        tags: {
          type: 'array',
          items: { type: 'object', properties: { id: { type: 'string', 'x-mcp-header': 'Id' } } },
        },
      },
    }
    const result = collectHeaderAnnotations(schema)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('array items'))).toBe(true)
  })

  test('errors on an annotation inside prefixItems', () => {
    const schema = {
      type: 'object',
      properties: {
        pair: {
          type: 'array',
          prefixItems: [
            { type: 'object', properties: { k: { type: 'string', 'x-mcp-header': 'K' } } },
          ],
        },
      },
    }
    const result = collectHeaderAnnotations(schema)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('array items'))).toBe(true)
  })

  test('errors (no hang) on a circular $ref', () => {
    const schema = {
      type: 'object',
      properties: { self: { $ref: '#/$defs/Node' } },
      $defs: { Node: { type: 'object', properties: { next: { $ref: '#/$defs/Node' } } } },
    }
    const result = collectHeaderAnnotations(schema)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('Circular'))).toBe(true)
  })

  test('errors on an unresolved $ref', () => {
    const schema = { type: 'object', properties: { x: { $ref: '#/$defs/Missing' } } }
    const result = collectHeaderAnnotations(schema)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('Unresolved'))).toBe(true)
  })
})

describe('buildParamHeaders', () => {
  const annotations = [
    { headerName: 'Region', path: ['region'] },
    { headerName: 'Tenant', path: ['nested', 'tenant'] },
  ]

  test('maps argument values into Mcp-Param-* headers', () => {
    const headers = buildParamHeaders(annotations, { region: 'us-east-1', nested: { tenant: 7 } })
    expect(headers).toEqual({ 'Mcp-Param-Region': 'us-east-1', 'Mcp-Param-Tenant': '7' })
  })

  test('omits headers for null or absent arguments', () => {
    const headers = buildParamHeaders(annotations, { region: null })
    expect(headers).toEqual({})
  })

  test('returns empty when arguments are undefined', () => {
    expect(buildParamHeaders(annotations, undefined)).toEqual({})
  })
})

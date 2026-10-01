import { elicitValidatorStats, resetElicitValidators } from '@mokei/host'
import { beforeEach, describe, expect, test } from 'vitest'

import { type FieldPlan, type FormParams, planForm, withViolation } from '../src/form.js'

const options = { appName: 'App', source: 'Server "s"' }

function params(
  properties: Record<string, unknown>,
  required?: Array<string>,
  message = 'Please answer',
): FormParams {
  return {
    mode: 'form',
    message,
    requestedSchema: { type: 'object', properties, required },
  } as FormParams
}

function fields(p: FormParams): Array<FieldPlan> {
  const plan = planForm(p, options)
  if (!plan.ok) throw new Error(`unexpected: ${plan.reason}`)
  return plan.fields
}

function single(schema: unknown, required = true): FieldPlan {
  return fields(params({ f: schema }, required ? ['f'] : []))[0] as FieldPlan
}

describe('planForm mapping', () => {
  test('string maps to text with prefill and dialog text', () => {
    const f = single({ type: 'string', title: 'Name', description: 'Your name', default: 'bob' })
    expect(f.ask).toEqual({
      kind: 'text',
      title: 'App',
      text: 'Server "s"\nPlease answer\nName\nYour name',
      default: 'bob',
    })
    expect(f.toValue('x')).toEqual({ ok: true, value: 'x' })
  })

  test('title falls back to name and empty entries are skipped', () => {
    const f = single({ type: 'string' })
    expect(f.ask.text).toBe('Server "s"\nPlease answer\nf')
    const plan = planForm(params({ f: { type: 'string' } }, ['f'], ''), {
      appName: 'A',
      source: '',
    })
    expect(plan.ok && plan.fields[0]?.ask.text).toBe('f')
  })

  test('enum maps to choice with enumNames labels', () => {
    const f = single({ type: 'string', enum: ['a', 'b'], enumNames: ['A', 'B'], default: 'b' })
    expect(f.ask.kind).toBe('choice')
    expect(f.ask.choices).toEqual([
      { value: 'a', label: 'A' },
      { value: 'b', label: 'B' },
    ])
    expect(f.ask.default).toBe('b')
    expect(f.toValue('a')).toEqual({ ok: true, value: 'a' })
    expect(f.toValue('zzz').ok).toBe(false)
  })

  test('enum without enumNames uses values as labels', () => {
    const f = single({ type: 'string', enum: ['a', 'b'] })
    expect(f.ask.choices).toEqual([
      { value: 'a', label: 'a' },
      { value: 'b', label: 'b' },
    ])
    expect(f.ask.default).toBeUndefined()
  })

  test('oneOf maps to choice with title or const labels', () => {
    const f = single({ type: 'string', oneOf: [{ const: 'x', title: 'X!' }, { const: 'y' }] })
    expect(f.ask.choices).toEqual([
      { value: 'x', label: 'X!' },
      { value: 'y', label: 'y' },
    ])
    expect(f.toValue('y')).toEqual({ ok: true, value: 'y' })
  })

  test('number and integer map to text with numeric conversion', () => {
    const n = single({ type: 'number', default: 2.5 })
    expect(n.ask.kind).toBe('text')
    expect(n.ask.default).toBe('2.5')
    expect(n.toValue('3.5')).toEqual({ ok: true, value: 3.5 })
    const i = single({ type: 'integer' })
    expect(i.toValue('7')).toEqual({ ok: true, value: 7 })
  })

  test('number rejects empty and NaN, optional empty is omitted', () => {
    const n = single({ type: 'number' })
    expect(n.toValue('')).toEqual({ ok: false, violation: 'must be a number, such as 42 or 3.5' })
    expect(n.toValue('abc')).toEqual({
      ok: false,
      violation: 'must be a number, such as 42 or 3.5',
    })
    const opt = single({ type: 'number' }, false)
    expect(opt.toValue('')).toEqual({ ok: true })
  })

  test('boolean maps to confirm with default', () => {
    const t = single({ type: 'boolean', default: true })
    expect(t.ask.kind).toBe('confirm')
    expect(t.ask.default).toBe('yes')
    expect(single({ type: 'boolean', default: false }).ask.default).toBe('no')
    expect(single({ type: 'boolean' }).ask.default).toBeUndefined()
    expect(t.toValue(false)).toEqual({ ok: true, value: false })
    expect(t.toValue(true)).toEqual({ ok: true, value: true })
  })

  test('optional empty text is omitted, required empty text is kept', () => {
    expect(single({ type: 'string' }, false).toValue('')).toEqual({ ok: true })
    expect(single({ type: 'string' }, true).toValue('')).toEqual({ ok: true, value: '' })
  })

  test('wrapped value form', () => {
    const [f] = fields(params({ value: { type: 'boolean' } }, ['value']))
    expect(f?.name).toBe('value')
    expect(f?.required).toBe(true)
  })

  test('multi-property order follows properties keys', () => {
    const fs = fields(
      params({ z: { type: 'string' }, a: { type: 'number' }, m: { type: 'boolean' } }, ['a']),
    )
    expect(fs.map((f) => f.name)).toEqual(['z', 'a', 'm'])
    expect(fs.map((f) => f.required)).toEqual([false, true, false])
  })

  test('empty properties gives no fields', () => {
    expect(planForm(params({}), options)).toEqual({ ok: true, fields: [] })
  })
})

describe('planForm rejections', () => {
  const reason = (properties: Record<string, unknown>) => {
    const plan = planForm(params(properties), options)
    return plan.ok ? null : plan.reason
  }

  test('multi-select array', () => {
    expect(reason({ f: { type: 'array', items: { type: 'string', enum: ['a'] } } })).toBe(
      'property "f" has an unsupported kind',
    )
  })

  test('unknown kind', () => {
    expect(reason({ f: { type: 'object' } })).toBe('property "f" has an unsupported kind')
  })

  test('more than 10 properties', () => {
    const props = Object.fromEntries(
      Array.from({ length: 11 }, (_, i) => [`p${i}`, { type: 'string' }]),
    )
    expect(reason(props)).toBe('form has more than 10 properties')
    const ten = Object.fromEntries(
      Array.from({ length: 10 }, (_, i) => [`p${i}`, { type: 'string' }]),
    )
    expect(reason(ten)).toBeNull()
  })

  test('duplicate or empty enum values and labels', () => {
    expect(reason({ f: { type: 'string', enum: ['a', 'a'] } })).not.toBeNull()
    expect(reason({ f: { type: 'string', enum: ['a', ''] } })).not.toBeNull()
    expect(
      reason({ f: { type: 'string', enum: ['a', 'b'], enumNames: ['X', 'X'] } }),
    ).not.toBeNull()
    expect(reason({ f: { type: 'string', enum: ['a', 'b'], enumNames: ['X', ''] } })).not.toBeNull()
    expect(
      reason({ f: { type: 'string', oneOf: [{ const: 'a' }, { const: 'a' }] } }),
    ).not.toBeNull()
    expect(
      reason({
        f: {
          type: 'string',
          oneOf: [
            { const: 'a', title: 'T' },
            { const: 'b', title: 'T' },
          ],
        },
      }),
    ).not.toBeNull()
    expect(reason({ f: { type: 'string', oneOf: [{ const: '' }] } })).not.toBeNull()
  })

  test('enumNames length mismatch', () => {
    expect(reason({ f: { type: 'string', enum: ['a', 'b'], enumNames: ['A'] } })).toMatch(
      /enumNames/,
    )
  })

  test('invalid pattern', () => {
    expect(reason({ f: { type: 'string', pattern: '(' } })).toMatch(/pattern/)
  })
})

describe('constraints via toValue', () => {
  const bad = (schema: unknown, answer: string) => {
    const r = single(schema).toValue(answer)
    return r.ok ? null : r.violation
  }

  test('minLength / maxLength', () => {
    expect(bad({ type: 'string', minLength: 3 }, 'ab')).toBe('must be at least 3 characters')
    expect(bad({ type: 'string', minLength: 3 }, 'abc')).toBeNull()
    expect(bad({ type: 'string', maxLength: 2 }, 'abc')).toBe('must be at most 2 characters')
    expect(bad({ type: 'string', maxLength: 2 }, 'ab')).toBeNull()
    expect(bad({ type: 'string', minLength: 1 }, '')).toBe('must be at least 1 character')
  })

  test('minLength / maxLength count code points, not UTF-16 units', () => {
    // One astral emoji is two UTF-16 units but one code point
    expect(bad({ type: 'string', maxLength: 1 }, '\u{1F600}')).toBeNull()
    expect(bad({ type: 'string', minLength: 2 }, '\u{1F600}')).toBe('must be at least 2 characters')
    expect(bad({ type: 'string', minLength: 2 }, 'a\u{1F600}')).toBeNull()
    expect(bad({ type: 'string', maxLength: 1 }, 'a\u{1F600}')).toBe('must be at most 1 character')
  })

  test('pattern follows JSON Schema: unanchored, anchors when the schema says so', () => {
    expect(bad({ type: 'string', pattern: '[a-c]+' }, 'abcd')).toBeNull()
    expect(bad({ type: 'string', pattern: '[a-c]+' }, 'xyz')).toBe('must match the pattern [a-c]+')
    expect(bad({ type: 'string', pattern: '^[a-c]+$' }, 'abcd')).toBe(
      'must match the pattern ^[a-c]+$',
    )
    expect(bad({ type: 'string', pattern: '^[a-c]+$' }, 'abc')).toBeNull()
  })

  test('minimum / maximum / integer', () => {
    expect(bad({ type: 'number', minimum: 5 }, '4')).toBe('must be at least 5')
    expect(bad({ type: 'number', minimum: 5 }, '5')).toBeNull()
    expect(bad({ type: 'number', maximum: 5 }, '6')).toBe('must be at most 5')
    expect(bad({ type: 'number', maximum: 5 }, '5')).toBeNull()
    expect(bad({ type: 'integer' }, '1.5')).toBe('must be a whole number')
    expect(bad({ type: 'integer' }, '2')).toBeNull()
    expect(bad({ type: 'number' }, 'abc')).toBe('must be a number, such as 42 or 3.5')
  })

  test('formats', () => {
    const f = (format: string, ok: Array<string>, no: Array<string>, message: string) => {
      for (const v of ok) expect(bad({ type: 'string', format }, v), `${format} ${v}`).toBeNull()
      for (const v of no) expect(bad({ type: 'string', format }, v), `${format} ${v}`).toBe(message)
    }
    f('email', ['a@b.co'], ['a@b', 'a b@c.d', 'nope'], 'must be an email address')
    f('uri', ['https://x.y/z'], ['not a uri'], 'must be a URI, such as https://example.com')
    f(
      'date',
      ['2024-02-29'],
      ['2023-02-29', '2024-13-01', '24-1-1', '2024-01-01T00:00:00Z'],
      'must be a date, such as 2024-01-31',
    )
    f(
      'date-time',
      ['2024-01-01T10:00:00Z'],
      ['2024-01-01', 'garbage'],
      'must be a date and time, such as 2024-01-31T10:00:00Z',
    )
  })
})

describe('withViolation', () => {
  test('puts the violation on the first line', () => {
    const ask = { kind: 'text' as const, title: 'T', text: 'body' }
    expect(withViolation(ask, 'too short')).toEqual({ ...ask, text: 'too short\nbody' })
  })
})

describe('form validator factory', () => {
  beforeEach(() => {
    resetElicitValidators()
  })

  function numberForm(index: number): FormParams {
    return params({ field: { type: 'string', maxLength: index + 1 } }, ['field'])
  }

  test('schemas differing only in key order share one compile', () => {
    const first = params({ a: { type: 'string', minLength: 1 } })
    const second = params({ a: { minLength: 1, type: 'string' } })
    planForm(first, options)
    const { compiles } = elicitValidatorStats()
    planForm(second, options)
    expect(elicitValidatorStats().compiles).toBe(compiles)
  })

  test('the 257th distinct compile recycles the factory and clears the cache', () => {
    for (let index = 0; index < 256; index++) planForm(numberForm(index), options)
    expect(elicitValidatorStats()).toEqual({ generation: 0, compiles: 256, entries: 64 })
    planForm(numberForm(256), options)
    expect(elicitValidatorStats()).toEqual({ generation: 1, compiles: 1, entries: 1 })
  })

  test('a validator obtained before a recycle still validates', () => {
    const plan = planForm(numberForm(0), options)
    if (!plan.ok) throw new Error('expected a plan')
    for (let index = 1; index <= 256; index++) planForm(numberForm(index), options)
    expect(elicitValidatorStats().generation).toBe(1)
    const field = plan.fields[0]
    if (field === undefined) throw new Error('expected a field')
    expect(field.toValue('x')).toEqual({ ok: true, value: 'x' })
    expect(field.toValue('xx')).toMatchObject({ ok: false })
  })

  test('a compile error is cached and rethrown', () => {
    const bad = params({ a: { type: 'string', pattern: '(' } })
    const first = planForm(bad, options)
    expect(first.ok).toBe(false)
    const { compiles } = elicitValidatorStats()
    const second = planForm(bad, options)
    expect(second).toEqual(first)
    expect(elicitValidatorStats().compiles).toBe(compiles)
  })
})

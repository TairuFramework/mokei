import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { type FieldPlan, type FormParams, planForm } from '../src/form.js'
import { createInputInbox, InboxAnswerInvalidError } from '../src/inbox.js'

// Counts compiles made on any validator factory
const createValidator = vi.hoisted(() => vi.fn())

vi.mock('@sozai/schema', async (importOriginal) => {
  const original = await importOriginal<typeof import('@sozai/schema')>()
  return {
    ...original,
    createValidatorFactory: (
      factoryOptions?: Parameters<typeof original.createValidatorFactory>[0],
    ) => {
      const factory = original.createValidatorFactory(factoryOptions)
      const inner = factory.createValidator.bind(factory)
      factory.createValidator = ((schema: never) => {
        createValidator(schema)
        return inner(schema)
      }) as typeof factory.createValidator
      return factory
    },
  }
})

const options = { appName: 'App', source: 'Server "s"' }

function params(properties: Record<string, unknown>, required?: Array<string>): FormParams {
  return {
    mode: 'form',
    message: 'Please answer',
    requestedSchema: { type: 'object', properties, required },
  } as FormParams
}

function single(schema: unknown): FieldPlan {
  const plan = planForm(params({ f: schema }, ['f']), options)
  if (!plan.ok) throw new Error(`unexpected: ${plan.reason}`)
  return plan.fields[0] as FieldPlan
}

function bad(schema: unknown, answer: string): string | null {
  const result = single(schema).toValue(answer)
  return result.ok ? null : result.violation
}

let uniqueKey = 0
/** A schema no earlier test compiled, so the cache cannot already hold it. */
function fresh(extra: Record<string, unknown> = {}): Record<string, unknown> {
  uniqueKey += 1
  return { type: 'string', maxLength: 1000 + uniqueKey, ...extra }
}

beforeEach(() => {
  createValidator.mockClear()
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('keyword whitelist', () => {
  test('a whitelisted keyword with a wrong value type is ignored', () => {
    expect(bad({ type: 'string', minLength: 'x' }, 'a')).toBeNull()
    expect(bad({ type: 'number', minimum: 'x' }, '1')).toBeNull()
  })

  test.each([
    // biome-ignore lint/suspicious/noThenProperty: a JSON Schema if/then, not a thenable
    ['if', { if: { type: 'string' }, then: { maxLength: 0 } }],
    ['$id', { $id: 'http://x/y' }],
  ])('%s is dropped', (_name, extra) => {
    const schema = { type: 'string', ...extra }
    expect(bad(schema, 'a')).toBeNull()
  })

  test.each([
    ['$ref', { $ref: 'https://evil.example/x' }],
    ['not', { not: { type: 'string' } }],
    ['allOf', { allOf: [{ maxLength: 0 }] }],
    ['const', { const: 'nope' }],
  ])('%s is rejected before compiling', (keyword, extra) => {
    expect(planForm(params({ f: { type: 'string', ...extra } }), options)).toEqual({
      ok: false,
      reason: `property "f" has an unsupported ${keyword}`,
    })
    expect(createValidator).not.toHaveBeenCalled()
  })

  test('an unknown format is dropped without a console warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    expect(bad(fresh({ format: 'bogus' }), 'a')).toBeNull()
    expect(warn).not.toHaveBeenCalled()
    expect(error).not.toHaveBeenCalled()
    expect(log).not.toHaveBeenCalled()
  })

  test('each field compiles in planForm, before any answer', () => {
    single(fresh())
    expect(createValidator).toHaveBeenCalledTimes(1)
  })
})

describe('number parsing', () => {
  test.each(['Infinity', '-Infinity', '0x10', '0b1', '1_000', 'abc', ' '])(
    '%j is not a number',
    (answer) => {
      expect(bad({ type: 'number' }, answer)).toBe('must be a number, such as 42 or 3.5')
    },
  )

  test.each([
    ['42', 42],
    ['-3.5', -3.5],
    [' 7 ', 7],
    ['1e3', 1000],
    ['.5', 0.5],
  ])('%j parses as %s', (answer, value) => {
    expect(single({ type: 'number' }).toValue(answer)).toEqual({ ok: true, value })
  })
})

describe('a schema that fails to compile', () => {
  const broken = { type: 'string', pattern: '(' }

  test('planForm declines it', () => {
    const plan = planForm(params({ f: broken }, ['f']), options)
    expect(plan).toEqual({ ok: false, reason: 'property "f" has an invalid pattern' })
  })

  test('the inbox compiles at add and reports it on answer', () => {
    const inbox = createInputInbox()
    const request = {
      key: 'k',
      params: params({ f: broken }, ['f']),
      signal: new AbortController().signal,
    }
    const answer = inbox.add(request)
    answer.catch(() => {})
    expect(createValidator).toHaveBeenCalled()
    const [entry] = inbox.list()
    let thrown: unknown
    try {
      inbox.answer(entry?.id as string, { f: 'x' })
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(InboxAnswerInvalidError)
    expect((thrown as InboxAnswerInvalidError).issues).toEqual([
      expect.stringMatching(/^the requested schema cannot be validated: /),
    ])
    inbox.dispose()
  })
})

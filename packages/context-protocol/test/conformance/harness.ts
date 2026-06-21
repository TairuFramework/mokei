import { createValidator, type Schema } from '@sozai/schema'
import { expect, test } from 'vitest'

export type ConformanceCase = {
  name: string
  message: unknown
  valid: boolean
}

export type ConformanceFixture = {
  /** Human label for the SEP / feature under test. */
  sep: string
  cases: Array<ConformanceCase>
}

/**
 * Run every case in a fixture against a schema, asserting accept/reject.
 * A `valid: true` case must validate with no issues; `valid: false` must produce issues.
 */
export function runConformance(schema: Schema, fixture: ConformanceFixture): void {
  const validate = createValidator(schema)
  for (const testCase of fixture.cases) {
    test(`${fixture.sep}: ${testCase.name} (${testCase.valid ? 'accept' : 'reject'})`, () => {
      const result = validate(testCase.message)
      if (testCase.valid) {
        expect(result.issues, JSON.stringify(result.issues)).toBeUndefined()
      } else {
        expect(result.issues).toBeDefined()
      }
    })
  }
}

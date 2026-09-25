import { expectTypeOf, test } from 'vitest'

import type {
  CreateSystemOneClientParams,
  SystemOneConnectionErrorParams,
  SystemOneHTTPClientParams,
  SystemOneOverloadedErrorParams,
  SystemOneRateLimitErrorParams,
  SystemOneRetryableErrorParams,
} from '../src/index.js'
import type { ChoiceAnswer, NoulAnswer, PredictResult, ScoreAnswer } from '../src/types.js'

test('public System One params include HTTP and error fields', () => {
  expectTypeOf<SystemOneHTTPClientParams>().toHaveProperty('url').toEqualTypeOf<string>()
  expectTypeOf<CreateSystemOneClientParams>().toExtend<
    SystemOneHTTPClientParams | { backend: unknown }
  >()
  expectTypeOf<SystemOneConnectionErrorParams>().toHaveProperty('cause').toEqualTypeOf<unknown>()
  expectTypeOf<SystemOneConnectionErrorParams>()
    .toHaveProperty('status')
    .toEqualTypeOf<number | undefined>()
  expectTypeOf<SystemOneRetryableErrorParams>()
    .toHaveProperty('retryAfterMs')
    .toEqualTypeOf<number | undefined>()
  expectTypeOf<SystemOneRateLimitErrorParams>().toEqualTypeOf<SystemOneRetryableErrorParams>()
  expectTypeOf<SystemOneOverloadedErrorParams>().toEqualTypeOf<SystemOneRetryableErrorParams>()
})

test('PredictResult infers answer shape per question type', () => {
  type DeptQuestion = { type: 'choice'; instructions: 'Which team?'; criteria: { a: 'x' } }
  type UrgencyQuestion = { type: 'score'; instructions: 'How urgent?'; criteria: ['low', 'high'] }
  type ChurnQuestion = { type: 'noul'; instructions: 'Will they churn?' }

  type Questions = {
    dept: DeptQuestion
    urgency: UrgencyQuestion
    churn: ChurnQuestion
  }

  type Result = PredictResult<Questions>
  expectTypeOf<Result['answers']['dept']>().toEqualTypeOf<ChoiceAnswer>()
  expectTypeOf<Result['answers']['urgency']>().toEqualTypeOf<ScoreAnswer>()
  expectTypeOf<Result['answers']['churn']>().toEqualTypeOf<NoulAnswer>()
  expectTypeOf<Result['model']>().toEqualTypeOf<string>()
})

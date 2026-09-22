import { expectTypeOf, test } from 'vitest'

import type { ChoiceAnswer, NoulAnswer, PredictResult, ScoreAnswer } from '../src/types.js'

test('PredictResult infers answer shape per question type', () => {
  type DeptQuestion = { type: 'choice'; criteria: { a: 'x' } }
  type UrgencyQuestion = { type: 'score'; criteria: ['low', 'high'] }
  type ChurnQuestion = { type: 'noul' }

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

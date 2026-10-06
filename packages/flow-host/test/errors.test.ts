import { describe, expect, test } from 'vitest'

import {
  describeFlowHostError,
  FlowCheckError,
  FlowNotFoundError,
  InboxAnswerInvalidError,
  InboxItemNotFoundError,
  RunNotFoundError,
} from '../src/errors.js'

describe('describeFlowHostError', () => {
  test('describes an invalid flow with its issues', () => {
    const issues = ['Missing start node', 'Unknown next node']
    const error = new FlowCheckError({ issues })
    const description = describeFlowHostError(error)
    expect(description).toEqual({
      code: 'FLOW_INVALID',
      message: 'Missing start node; Unknown next node',
      data: { issues },
    })
    expect(description?.data?.issues).not.toBe(error.issues)
  })

  test('describes a missing flow', () => {
    expect(describeFlowHostError(new FlowNotFoundError({ flowID: 'missing-flow' }))).toEqual({
      code: 'FLOW_NOT_FOUND',
      message: 'Flow not found: missing-flow',
    })
  })

  test('describes a missing run', () => {
    expect(describeFlowHostError(new RunNotFoundError({ runID: 'missing-run' }))).toEqual({
      code: 'RUN_NOT_FOUND',
      message: 'Run not found: missing-run',
    })
  })

  test('describes a missing inbox item', () => {
    expect(describeFlowHostError(new InboxItemNotFoundError({ itemID: 'missing-item' }))).toEqual({
      code: 'INBOX_ITEM_NOT_FOUND',
      message: 'Inbox item not found: missing-item',
    })
  })

  test('describes an invalid inbox answer with its issues', () => {
    const issues = ['Missing value', 'Expected string']
    const error = new InboxAnswerInvalidError({ issues })
    const description = describeFlowHostError(error)
    expect(description).toEqual({
      code: 'INBOX_ANSWER_INVALID',
      message: 'Missing value; Expected string',
      data: { issues },
    })
    expect(description?.data?.issues).not.toBe(error.issues)
  })

  test('leaves unknown errors undescribed', () => {
    expect(describeFlowHostError(new Error('x'))).toBeUndefined()
  })
})

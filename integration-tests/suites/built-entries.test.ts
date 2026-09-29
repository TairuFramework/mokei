import * as entry from '@mokei/decision-flow'
import { expect, test } from 'vitest'

test('built decision-flow entry exports its public symbols', () => {
  for (const name of [
    'checkDecide',
    'createDecisionFlowGraph',
    'decideKind',
    'decideNodeSchema',
    'decideResultSchema',
    'decideTargets',
    'describeDecisionError',
    'flowDefinitionSchema',
    'flowStorageSchema',
    'formatIssues',
    'InvalidDecisionStateError',
    'retryableDecision',
  ]) {
    expect(entry).toHaveProperty(name)
  }
})

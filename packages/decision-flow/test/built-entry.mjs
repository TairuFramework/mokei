import assert from 'node:assert/strict'

const entry = await import('../lib/index.js')

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
  assert.ok(name in entry, `built package entry exports ${name}`)
}

import { type CheckContext, type FlowIssue, isSafePathSegment } from '@sozai/flow-graph'

import type { DecideNode } from './decide-node.js'

const choiceOperators = new Set(['equalTo', 'notEqualTo', 'in', 'notIn'])
const probabilityOperators = new Set([
  'equalTo',
  'notEqualTo',
  'in',
  'notIn',
  'lessThan',
  'lessThanOrEqualTo',
  'greaterThan',
  'greaterThanOrEqualTo',
])

type PathPart = string | number
type FilterLeaf = { path: unknown; is: unknown }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function pathStartsWithResult(path: unknown, nodeID: string): path is Array<string> {
  return (
    Array.isArray(path) &&
    path[0] === 'results' &&
    path[1] === nodeID &&
    path.every((part) => typeof part === 'string')
  )
}

function collectFilterLeaves(
  value: unknown,
  path: Array<PathPart>,
  visit: (leaf: FilterLeaf, path: Array<PathPart>) => void,
) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      collectFilterLeaves(item, [...path, index], visit)
    })
    return
  }
  if (!isRecord(value)) return

  if (Array.isArray(value.path) && isRecord(value.is)) visit(value as FilterLeaf, path)
  for (const [key, item] of Object.entries(value)) collectFilterLeaves(item, [...path, key], visit)
}

function comparisonOperands(
  operator: string,
  value: unknown,
): Array<{ value: unknown; path: Array<PathPart> }> {
  if (operator === 'in' || operator === 'notIn') {
    if (!Array.isArray(value)) return [{ value, path: [] }]
    return value.map((item, index) => ({ value: item, path: [index] }))
  }
  return [{ value, path: [] }]
}

/** Validate decision-specific restrictions after the engine validates the graph shape and paths. */
export function checkDecide(node: DecideNode, ctx: CheckContext): Array<FlowIssue> {
  const issues: Array<FlowIssue> = []
  const report = (issue: Omit<FlowIssue, 'severity'>) => {
    issues.push(ctx.issue(issue))
  }

  if (isRecord(node.questions)) {
    for (const [questionKey, question] of Object.entries(node.questions)) {
      if (questionKey === '$meta' || questionKey === 'error' || !isSafePathSegment(questionKey)) {
        report({
          path: ['nodes', ctx.nodeID, 'questions', questionKey],
          code: 'invalid_question_key',
          message: `Question key ${JSON.stringify(questionKey)} is reserved or unsafe.`,
          hint: 'Rename the question to a safe path segment other than $meta or error.',
        })
      }

      if (isRecord(question) && question.type === 'choice' && isRecord(question.criteria)) {
        for (const criterionKey of Object.keys(question.criteria)) {
          if (!isSafePathSegment(criterionKey)) {
            report({
              path: ['nodes', ctx.nodeID, 'questions', questionKey, 'criteria', criterionKey],
              code: 'invalid_choice_criterion_key',
              message: `Choice criterion key ${JSON.stringify(criterionKey)} is unsafe.`,
              hint: 'Rename the choice criterion to a safe path segment.',
            })
          }
        }
      }
    }
  }

  const state: unknown = node.state
  if (isRecord(state) && Object.hasOwn(state, 'value')) {
    const value = state.value
    if (value === null || (typeof value !== 'string' && typeof value !== 'object')) {
      report({
        path: ['nodes', ctx.nodeID, 'state', 'value'],
        code: 'invalid_state',
        message: 'Literal state must be a string, object, or array.',
        hint: 'Use a string, object, or array for a literal decision state.',
      })
    }
  }

  const localQuestions = isRecord(node.questions) ? node.questions : {}
  for (const [sourceNodeID, sourceNode] of Object.entries(ctx.definition.nodes)) {
    collectFilterLeaves(sourceNode, ['nodes', sourceNodeID], (leaf, definitionPath) => {
      if (!pathStartsWithResult(leaf.path, ctx.nodeID)) return

      const path = leaf.path
      const questionKey = path[2]
      if (questionKey === undefined) return
      const question = localQuestions[questionKey]
      if (!isRecord(question)) return

      const targetIsChoice = question.type === 'choice' && path.length === 4 && path[3] === 'choice'
      const targetIsProbability =
        (path.length === 4 && path[3] === 'noul' && question.type === 'noul') ||
        (path.length === 4 && path[3] === 'confidence') ||
        (path.length === 5 && path[3] === 'action' && path[4] === 'act_probability') ||
        (path.length === 5 && path[3] === 'probabilities')

      for (const [operator, value] of Object.entries(leaf.is as Record<string, unknown>)) {
        if (targetIsChoice && choiceOperators.has(operator)) {
          const criteria = isRecord(question.criteria) ? question.criteria : {}
          for (const operand of comparisonOperands(operator, value)) {
            if (typeof operand.value !== 'string' || !Object.hasOwn(criteria, operand.value)) {
              report({
                path: [...definitionPath, 'is', operator, ...operand.path],
                code: 'invalid_choice_label',
                message: `Choice comparison uses undeclared label ${JSON.stringify(operand.value)}.`,
                hint: 'Use a label declared in this question’s criteria.',
              })
            }
          }
        }

        if (targetIsProbability && probabilityOperators.has(operator)) {
          for (const operand of comparisonOperands(operator, value)) {
            if (
              typeof operand.value !== 'number' ||
              !Number.isFinite(operand.value) ||
              operand.value < 0 ||
              operand.value > 1
            ) {
              report({
                path: [...definitionPath, 'is', operator, ...operand.path],
                code: 'invalid_probability',
                message: 'Probability comparisons must use finite numbers from 0 to 1.',
                hint: 'Use a finite numeric comparison value between 0 and 1, inclusive.',
              })
            }
          }
        }
      }
    })
  }

  return issues
}

/** Return every transition target using the engine’s target record shape. */
export function decideTargets(node: DecideNode): Array<{ path: Array<PathPart>; id: string }> {
  return [
    ...node.cases.map((item, index) => ({ path: ['cases', index, 'to'], id: item.to })),
    { path: ['default'], id: node.default },
    ...(node.onError === undefined ? [] : [{ path: ['onError'], id: node.onError }]),
  ]
}

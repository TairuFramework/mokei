import type { QuestionMap } from '@mokei/system-one-client'
import {
  createFlowGraph,
  defineNodeKind,
  type Filter,
  type FlowDefinition,
  type NodeKind,
} from '@sozai/flow-graph'
import { describe, expect, test } from 'vitest'

import {
  checkDecide,
  type DecideNode,
  decideNodeSchema,
  decideResultSchema,
  decideTargets,
} from '../src/index.js'

const questions: QuestionMap = {
  department: {
    type: 'choice',
    instructions: 'Which department?',
    criteria: { billing: 'Billing', technical: 'Technical' },
  },
  confidence: { type: 'noul', instructions: 'How likely?' },
  score: { type: 'score', instructions: 'How urgent?', criteria: ['low', 'high'] },
}

const decideKind: NodeKind<DecideNode> = defineNodeKind({
  kind: 'decide',
  schema: decideNodeSchema,
  targets: decideTargets,
  resultSchema: (node) => decideResultSchema(node.questions),
  check: checkDecide,
  execute: () => {
    throw new Error('The checker test kind must not execute')
  },
})

const endNode = { kind: 'end', outcome: 'done' }
const probabilityTargets = [
  ['noul', ['confidence', 'noul']],
  ['confidence', ['confidence', 'confidence']],
  ['action.act_probability', ['department', 'action', 'act_probability']],
  ['choice probability', ['department', 'probabilities', 'billing']],
  ['score probability', ['score', 'probabilities', '0.5']],
] as const
const probabilityComparisons = [
  ['equalTo', 1.1],
  ['notEqualTo', 1.1],
  ['in', [1.1]],
  ['notIn', [1.1]],
  ['lessThan', 1.1],
  ['lessThanOrEqualTo', 1.1],
  ['greaterThan', 1.1],
  ['greaterThanOrEqualTo', 1.1],
] as const

function makeDefinition(overrides: Record<string, unknown> = {}): FlowDefinition {
  const decide = {
    kind: 'decide',
    state: { value: 'A support request' },
    questions,
    cases: [
      {
        when: {
          path: ['results', 'decide', 'department', 'choice'],
          is: { equalTo: 'billing' },
        },
        to: 'done',
      },
    ],
    default: 'done',
    ...overrides,
  }
  return {
    id: 'test',
    name: 'test',
    version: 1,
    start: 'decide',
    nodes: { decide, done: endNode },
  } as FlowDefinition
}

function check(overrides: Record<string, unknown> = {}, extraNodes = {}) {
  const graph = createFlowGraph({ kinds: [decideKind] })
  return graph.check({
    ...makeDefinition(overrides),
    nodes: { ...makeDefinition(overrides).nodes, ...extraNodes },
  }).issues
}

function issueWithCode(issues: ReturnType<typeof check>, code: string) {
  const issue = issues.find((item) => item.code === code)
  if (!issue)
    throw new Error(`Expected issue ${code}; got ${issues.map((item) => item.code).join(', ')}`)
  return issue
}

function choiceFilter(operator: string, comparison: unknown): Filter {
  return {
    path: ['results', 'decide', 'department', 'choice'],
    is: { [operator]: comparison },
  } as Filter
}

function definitionWithFilter(filter: Filter) {
  return makeDefinition({
    cases: [{ when: filter, to: 'done' }],
  })
}

describe('checkDecide', () => {
  test.each([
    ['empty questions', {}],
    ['malformed questions', { department: { type: 'unknown' } }],
  ])('rejects %s', (_label, value) => {
    const issues = check({ questions: value })
    expect(
      issues.some((issue) => issue.path.slice(0, 3).join('.') === 'nodes.decide.questions'),
    ).toBe(true)
    expect(
      issues.filter((issue) => issue.severity === 'error').every((issue) => issue.hint.length > 0),
    ).toBe(true)
  })

  test.each(['$meta', 'error', '__proto__', 'constructor', 'prototype'])(
    'rejects question key %s with a repair hint',
    (key) => {
      const value = JSON.parse(`{"${key}":{"type":"noul","instructions":"Check?"}}`)
      const issues = check({ questions: value })
      expect(issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            severity: 'error',
            code: 'invalid_question_key',
            path: ['nodes', 'decide', 'questions', key],
            hint: expect.any(String),
          }),
        ]),
      )
      expect(issues.some((issue) => issue.path.join('.').includes('questions'))).toBe(true)
    },
  )

  test.each(['__proto__', 'constructor', 'prototype'])(
    'rejects choice criterion key %s with a repair hint',
    (key) => {
      const value = JSON.parse(
        `{"department":{"type":"choice","instructions":"Choose","criteria":{"${key}":"Unsafe"}}}`,
      )
      const issues = check({ questions: value })
      expect(issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            severity: 'error',
            code: 'invalid_choice_criterion_key',
            path: ['nodes', 'decide', 'questions', 'department', 'criteria', key],
            hint: expect.any(String),
          }),
        ]),
      )
    },
  )

  test.each([null, true, 1])('rejects literal state %s', (value) => {
    const issues = check({ state: { value } })
    expect(issueWithCode(issues, 'invalid_state')).toMatchObject({
      path: ['nodes', 'decide', 'state', 'value'],
      hint: expect.any(String),
    })
  })

  test.each(['equalTo', 'notEqualTo', 'in', 'notIn'])(
    'checks declared choice labels for %s under boolean filters',
    (operator) => {
      const comparison = operator === 'in' || operator === 'notIn' ? ['missing'] : 'missing'
      for (const [when, filterPath] of [
        [{ and: [choiceFilter(operator, comparison)] }, ['and', 0]],
        [{ or: [choiceFilter(operator, comparison)] }, ['or', 0]],
        [{ not: choiceFilter(operator, comparison) }, ['not']],
      ] as Array<[Filter, Array<string | number>]>) {
        const issues = createFlowGraph({ kinds: [decideKind] }).check(
          definitionWithFilter(when),
        ).issues
        expect(issueWithCode(issues, 'invalid_choice_label')).toMatchObject({
          path: [
            'nodes',
            'decide',
            'cases',
            0,
            'when',
            ...filterPath,
            'is',
            operator,
            ...(operator === 'in' || operator === 'notIn' ? [0] : []),
          ],
          hint: expect.any(String),
        })
      }
    },
  )

  test('checks filters in other nodes while scoping each decide hook to its own result', () => {
    const definition = makeDefinition()
    definition.nodes.branch = {
      kind: 'branch',
      cases: [
        {
          when: choiceFilter('equalTo', 'unknown'),
          to: 'done',
        },
      ],
      default: 'done',
    }
    const issues = createFlowGraph({ kinds: [decideKind] }).check(definition).issues
    expect(
      issues.some(
        (issue) => issue.code === 'invalid_choice_label' && issue.path.includes('branch'),
      ),
    ).toBe(true)
  })

  const probabilityCases = probabilityTargets.flatMap(([label, suffix]) =>
    probabilityComparisons.map(
      ([operator, value]) =>
        [label, [...suffix], operator, value] as [string, Array<string>, string, unknown],
    ),
  )

  test.each(probabilityCases)(
    'rejects out-of-range %s comparisons for %s',
    (_label, suffix, operator, comparison) => {
      const filter: Filter = {
        path: ['results', 'decide', ...suffix],
        is: { [operator]: comparison },
      }
      const issues = createFlowGraph({ kinds: [decideKind] }).check(
        definitionWithFilter(filter),
      ).issues
      expect(issueWithCode(issues, 'invalid_probability')).toMatchObject({
        path: [
          'nodes',
          'decide',
          'cases',
          0,
          'when',
          'is',
          operator,
          ...(operator === 'in' || operator === 'notIn' ? [0] : []),
        ],
        hint: expect.any(String),
      })
    },
  )

  test('rejects non-finite probability operands after the engine JSON issue', () => {
    const filter: Filter = {
      path: ['results', 'decide', 'confidence', 'confidence'],
      is: { equalTo: Number.NaN },
    }
    const issues = createFlowGraph({ kinds: [decideKind] }).check(
      definitionWithFilter(filter),
    ).issues
    expect(issues.some((issue) => issue.code === 'schema')).toBe(true)
    expect(issues.some((issue) => issue.code === 'invalid_probability')).toBe(false)
  })

  test('accepts declared labels and boundary probabilities', () => {
    const issues = check({
      cases: [
        { when: choiceFilter('equalTo', 'billing'), to: 'done' },
        {
          when: {
            and: [
              {
                path: ['results', 'decide', 'confidence', 'noul'],
                is: { greaterThanOrEqualTo: 0 },
              },
              {
                path: ['results', 'decide', 'score', 'probabilities', '0.5'],
                is: { lessThanOrEqualTo: 1 },
              },
            ],
          },
          to: 'done',
        },
      ],
    })
    expect(issues.filter((issue) => issue.severity === 'error')).toEqual([])
  })

  test('accepts handled error fields and rejects unknown error fields using the engine checker', () => {
    const valid = check(
      { onError: 'done' },
      {
        handled: {
          kind: 'branch',
          cases: [
            {
              when: { path: ['results', 'decide', 'error', 'type'], is: { equalTo: 'Error' } },
              to: 'done',
            },
          ],
          default: 'done',
        },
      },
    )
    expect(valid.some((issue) => issue.code === 'invalid_error_path')).toBe(false)

    const invalid = check(
      { onError: 'done' },
      {
        handled: {
          kind: 'branch',
          cases: [
            {
              when: { path: ['results', 'decide', 'error', 'secret'], is: { isNull: true } },
              to: 'done',
            },
          ],
          default: 'done',
        },
      },
    )
    expect(invalid.some((issue) => issue.code === 'invalid_error_path')).toBe(true)
  })

  test.each([
    ['undeclared question', ['unknown', 'choice']],
    ['extra backend field', ['department', 'rationale']],
    ['undeclared choice probability', ['department', 'probabilities', 'other']],
  ])('reports cross-node invalid_result_path for %s', (_label, suffix) => {
    const definition = makeDefinition()
    definition.nodes.branch = {
      kind: 'branch',
      cases: [
        {
          when: { path: ['results', 'decide', ...suffix], is: { isNull: true } },
          to: 'done',
        },
      ],
      default: 'done',
    }
    const issues = createFlowGraph({ kinds: [decideKind] }).check(definition).issues
    expect(issues.some((issue) => issue.code === 'invalid_result_path')).toBe(true)
  })

  test('accepts open backend-defined legend paths', () => {
    const definition = makeDefinition()
    definition.nodes.branch = {
      kind: 'branch',
      cases: [
        {
          when: {
            path: ['results', 'decide', 'score', 'legend', 'anyBackendKey'],
            is: { isNull: true },
          },
          to: 'done',
        },
      ],
      default: 'done',
    }
    const issues = createFlowGraph({ kinds: [decideKind] }).check(definition).issues
    expect(issues.some((issue) => issue.code === 'invalid_result_path')).toBe(false)
  })

  test('exports its target records from every transition field', () => {
    const targets = decideKind.targets({
      kind: 'decide',
      state: { value: 'state' },
      questions,
      cases: [{ when: choiceFilter('equalTo', 'billing'), to: 'case' }],
      default: 'fallback',
      onError: 'error',
    } as DecideNode)
    expect(targets).toEqual([
      { path: ['cases', 0, 'to'], id: 'case' },
      { path: ['default'], id: 'fallback' },
      { path: ['onError'], id: 'error' },
    ])
  })
})

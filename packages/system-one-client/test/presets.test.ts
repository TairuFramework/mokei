import { describe, expect, test } from 'vitest'

import {
  guardQuestions,
  moderationQuestions,
  routerQuestions,
  triageQuestions,
} from '../src/presets.js'
import { validateQuestions } from '../src/validation.js'

describe('preset question sets', () => {
  test('every preset is a valid question map', () => {
    for (const questions of [
      routerQuestions(),
      guardQuestions(),
      moderationQuestions(),
      triageQuestions(),
    ]) {
      expect(() => validateQuestions({ questions })).not.toThrow()
    }
  })

  test('guardQuestions has a noul jailbreak question; triage has a choice department', () => {
    expect(guardQuestions().jailbreak?.type).toBe('noul')
    const dept = triageQuestions().department
    expect(dept?.type).toBe('choice')
    if (dept?.type === 'choice') {
      expect(Object.keys(dept.criteria).length).toBeGreaterThan(1)
    }
  })

  test('each factory returns a fresh object', () => {
    expect(routerQuestions()).not.toBe(routerQuestions())
  })
})

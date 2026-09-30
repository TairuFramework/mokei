import { describe, expect, test } from 'vitest'

import { validateQuestions } from '../src/validation.js'
import {
  guardQuestions,
  moderationQuestions,
  routerQuestions,
  triageQuestions,
} from './fixtures/presets.js'

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

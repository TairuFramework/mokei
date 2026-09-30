import { afterAll, describe, expect, test } from 'vitest'

import { type AskRequest, createRunner, createZenityBackend } from '../src/index.js'

const REQUESTS: Array<AskRequest> = [
  { kind: 'text', title: 'mokei e2e', text: 'Type something' },
  { kind: 'confirm', title: 'mokei e2e', text: 'Confirm?' },
  {
    kind: 'choice',
    title: 'mokei e2e',
    text: 'Pick one',
    choices: [
      { value: 'a', label: 'Alpha' },
      { value: 'b', label: 'Beta' },
    ],
  },
]

// CI only: real zenity under xvfb (see .github/workflows/build-test.yml)
describe.runIf(process.env.DESKTOP_E2E)('zenity end to end', () => {
  const runner = createRunner()
  const backend = createZenityBackend(runner)

  afterAll(async () => {
    await runner.dispose()
  })

  test.each(REQUESTS)(
    'an unanswered $kind dialog times out',
    async (request) => {
      // 6 s runner budget gives a 1 s native zenity timeout
      const result = await backend.ask?.(request, {
        timeoutMs: 6_000,
        signal: new AbortController().signal,
      })
      expect(result).toEqual({ status: 'timeout' })
    },
    15_000,
  )
})

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { afterAll, describe, expect, test } from 'vitest'

import { type AskRequest, createRunner, createZenityBackend } from '../src/index.js'

const run = promisify(execFile)

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

/**
 * Waits for the zenity window, gives it the X input focus (xvfb runs no window manager), then
 * sends the keys through XTEST. `alt+o` is the `_OK` button mnemonic, so it answers a list
 * wherever the focus is inside the dialog.
 */
function answerWithKeys(keys: Array<string>): Promise<unknown> {
  return run(
    'xdotool',
    [
      'search',
      '--sync',
      '--onlyvisible',
      '--class',
      'zenity',
      'windowfocus',
      '--sync',
      'sleep',
      '0.5',
      ...keys,
    ],
    { timeout: 20_000 },
  )
}

// CI only: real zenity and xdotool under xvfb (see .github/workflows/build-test.yml)
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

  async function answer(request: AskRequest, keys: Array<string>): Promise<unknown> {
    const asked = backend.ask?.(request, {
      timeoutMs: 30_000,
      signal: new AbortController().signal,
    })
    await answerWithKeys(keys)
    return await asked
  }

  test('a text entry answered with typed text', async () => {
    // The entry takes the initial focus and activates the default OK response on Return
    const result = await answer({ kind: 'text', title: 'mokei e2e', text: 'Type something' }, [
      'type',
      '--delay',
      '50',
      'hello e2e',
      'key',
      'Return',
    ])
    expect(result).toEqual({ status: 'answered', value: 'hello e2e' })
  }, 40_000)

  test('a confirm answered with its default No', async () => {
    const result = await answer(
      { kind: 'confirm', title: 'mokei e2e', text: 'Confirm?', default: 'no' },
      ['key', 'alt+o'],
    )
    expect(result).toEqual({ status: 'answered', value: false })
  }, 40_000)

  test('a radiolist choice answered with its default second row', async () => {
    const result = await answer(
      {
        kind: 'choice',
        title: 'mokei e2e',
        text: 'Pick one',
        default: 'b',
        choices: [
          { value: 'a', label: 'Alpha' },
          { value: 'b', label: 'Beta' },
        ],
      },
      ['key', 'alt+o'],
    )
    expect(result).toEqual({ status: 'answered', value: 'b' })
  }, 40_000)
})

import { describe, expect, test } from 'vitest'

import { alerterCanShow, buildAlerterArgs, parseAlerterResult } from '../src/backends/alerter.js'
import { buildNotifySendArgs } from '../src/backends/notify-send.js'
import {
  buildOsascriptAskArgs,
  buildOsascriptNotifyArgs,
  OSASCRIPT_ASK_SCRIPTS,
  OSASCRIPT_NOTIFY_SCRIPT,
  parseOsascriptAskResult,
} from '../src/backends/osascript.js'
import { buildZenityArgs, parseZenityResult } from '../src/backends/zenity.js'
import {
  type AskRequest,
  createAlerterBackend,
  createNotifySendBackend,
  createOsascriptBackend,
  createZenityBackend,
  type Runner,
  type RunOptions,
  type RunResult,
} from '../src/index.js'

const HOSTILE = '"; do shell script "rm -rf ~" --x\n\\'

const choices = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Beta' },
]
const text: AskRequest = { kind: 'text', title: 'T', text: 'X', default: 'dflt' }
const confirm: AskRequest = { kind: 'confirm', title: 'T', text: 'X' }
const choice: AskRequest = { kind: 'choice', title: 'T', text: 'X', choices, default: 'b' }

function result(partial: Partial<RunResult> = {}): RunResult {
  return { code: 0, stdout: '', stderr: '', timedOut: false, ...partial }
}

type Call = { command: string; args: Array<string>; options: RunOptions }
function fakeRunner(reply: RunResult): { runner: Runner; calls: Array<Call> } {
  const calls: Array<Call> = []
  const runner: Runner = {
    async run(command, args, options) {
      calls.push({ command, args, options })
      return reply
    },
    async dispose() {},
  }
  return { runner, calls }
}

const signal = new AbortController().signal

function firstCall(calls: Array<Call>): Call {
  const call = calls[0]
  if (call == null) {
    throw new Error('Runner was not called')
  }
  return call
}

describe('alerter', () => {
  test('args per kind', () => {
    const base = ['--json', '--timeout', '25', '--title', 'T', '--message', 'X']
    expect(buildAlerterArgs(text, 25)).toEqual([...base, '--reply', 'dflt'])
    expect(buildAlerterArgs({ ...text, default: undefined }, 25)).toEqual([...base, '--reply', ''])
    expect(buildAlerterArgs(confirm, 25)).toEqual([...base, '--actions', 'Yes,No'])
    expect(buildAlerterArgs(choice, 25)).toEqual([...base, '--actions', 'Alpha,Beta'])
  })

  const json = (activationType: string, activationValue?: string) =>
    result({ stdout: JSON.stringify({ activationType, activationValue }) })

  // `--json` output captured from alerter 26.5 on macOS.
  const captured = {
    replied: `{
  "activationAt" : "2026-09-30 17:43:52 +0100",
  "activationType" : "replied",
  "activationValue" : "hi",
  "deliveredAt" : "2026-09-30 17:43:46 +0100"
}`,
    actionClicked: (value: string, index: number) => `{
  "activationAt" : "2026-09-30 17:44:04 +0100",
  "activationType" : "actionClicked",
  "activationValue" : "${value}",
  "activationValueIndex" : "${index}",
  "deliveredAt" : "2026-09-30 17:43:55 +0100"
}`,
    closed: `{
  "activationAt" : "2026-09-30 17:44:15 +0100",
  "activationType" : "closed",
  "activationValue" : "",
  "deliveredAt" : "2026-09-30 17:44:07 +0100"
}`,
    contentsClicked: `{
  "activationAt" : "2026-09-30 17:44:22 +0100",
  "activationType" : "contentsClicked",
  "deliveredAt" : "2026-09-30 17:44:19 +0100"
}`,
    timeout: `{
  "activationAt" : "2026-09-30 17:43:43 +0100",
  "activationType" : "timeout",
  "deliveredAt" : "2026-09-30 17:43:39 +0100"
}`,
  }
  const stdout = (value: string) => result({ stdout: value })

  test.each([
    ['replied', text, stdout(captured.replied), { status: 'answered', value: 'hi' }],
    [
      'confirm yes',
      confirm,
      stdout(captured.actionClicked('Yes', 0)),
      { status: 'answered', value: true },
    ],
    [
      'confirm no',
      confirm,
      stdout(captured.actionClicked('No', 1)),
      { status: 'answered', value: false },
    ],
    [
      'choice',
      choice,
      stdout(captured.actionClicked('Beta', 1)),
      { status: 'answered', value: 'b' },
    ],
    ['closed', confirm, stdout(captured.closed), { status: 'dismissed' }],
    ['contentsClicked', confirm, stdout(captured.contentsClicked), { status: 'dismissed' }],
    ['timeout', confirm, stdout(captured.timeout), { status: 'timeout' }],
    ['runner timedOut', confirm, result({ code: null, timedOut: true }), { status: 'timeout' }],
  ])('parse %s', (_name, request, run, expected) => {
    expect(parseAlerterResult(request, run)).toEqual(expected)
  })

  test('unknown exit code throws first stderr line', () => {
    expect(() => parseAlerterResult(text, result({ code: 3, stderr: '\nboom\nmore' }))).toThrow(
      'boom',
    )
    expect(() => parseAlerterResult(text, result({ code: 3 }))).toThrow(
      'alerter exited with code 3',
    )
  })

  test('rejects malformed output', () => {
    expect(() => parseAlerterResult(text, result({ stdout: 'nope' }))).toThrow('not valid JSON')
    expect(() => parseAlerterResult(text, json('weird'))).toThrow('unknown activationType')
    expect(() => parseAlerterResult(choice, json('actionClicked', 'Gamma'))).toThrow(
      'unexpected action',
    )
  })

  test('argv injection', () => {
    const args = buildAlerterArgs({ ...text, text: HOSTILE }, 25)
    expect(args).toContain(HOSTILE)
  })

  test('alerterCanShow', () => {
    expect(alerterCanShow(choice)).toEqual({ ok: true })
    expect(alerterCanShow(text)).toEqual({ ok: true })
    expect(alerterCanShow(confirm)).toEqual({ ok: true })
    expect(alerterCanShow({ ...choice, choices: [{ value: 'x', label: 'a,b' }] })).toEqual({
      ok: false,
      reason: 'alerter cannot show a choice label containing a comma',
    })
  })

  test('alerterCanShow refuses every option value starting with -', () => {
    const dash = {
      ok: false,
      reason: 'alerter cannot show a value starting with "-", which it could read as an option',
    }
    expect(alerterCanShow({ ...text, default: '--appIcon' })).toEqual(dash)
    expect(alerterCanShow({ ...text, default: '-timeout' })).toEqual(dash)
    expect(
      alerterCanShow({ ...choice, choices: [{ value: 'a', label: '-x' }, ...choices] }),
    ).toEqual(dash)
    expect(alerterCanShow({ ...confirm, title: '-T' })).toEqual(dash)
    expect(alerterCanShow({ ...confirm, text: '--sender' })).toEqual(dash)
    // A dash inside a value, or in a later label of the actions list, is not an option
    expect(alerterCanShow({ ...text, default: 'a-b' })).toEqual({ ok: true })
    expect(
      alerterCanShow({ ...choice, choices: [...choices, { value: 'c', label: '-c' }] }),
    ).toEqual({ ok: true })
  })

  test('wrapper passes native timeout and unchanged runner timeout', async () => {
    const { runner, calls } = fakeRunner(json('replied', 'hi'))
    const out = await createAlerterBackend(runner).ask?.(text, { timeoutMs: 30_000, signal })
    expect(out).toEqual({ status: 'answered', value: 'hi' })
    expect(firstCall(calls).command).toBe('alerter')
    expect(firstCall(calls).args.slice(0, 3)).toEqual(['--json', '--timeout', '25'])
    expect(firstCall(calls).options).toEqual({ timeoutMs: 30_000, signal })
  })

  test('native timeout floors at 1 second', async () => {
    const { runner, calls } = fakeRunner(json('timeout'))
    await createAlerterBackend(runner).ask?.(text, { timeoutMs: 3_000, signal })
    expect(firstCall(calls).args[2]).toBe('1')
  })
})

describe('osascript', () => {
  test('ask args are -e lines, then --, then argv', () => {
    for (const request of [text, confirm, choice]) {
      const args = buildOsascriptAskArgs(request, 25)
      const dashes = args.indexOf('--')
      const script = OSASCRIPT_ASK_SCRIPTS[request.kind].split('\n')
      expect(args.slice(0, dashes)).toEqual(script.flatMap((line) => ['-e', line]))
    }
    const tail = (request: AskRequest) => {
      const args = buildOsascriptAskArgs(request, 25)
      return args.slice(args.indexOf('--') + 1)
    }
    expect(tail(text)).toEqual(['T', 'X', 'dflt', '25'])
    expect(tail(confirm)).toEqual(['T', 'X', 'Yes', '25'])
    expect(tail({ ...confirm, default: 'no' })).toEqual(['T', 'X', 'No', '25'])
    expect(tail(choice)).toEqual(['T', 'X', 'Beta', 'Alpha', 'Beta'])
    expect(tail({ ...choice, default: undefined })).toEqual(['T', 'X', 'Alpha', 'Alpha', 'Beta'])
  })

  test.each([
    [
      'text',
      text,
      result({ stdout: 'gave up:false\nhello\n' }),
      { status: 'answered', value: 'hello' },
    ],
    [
      'multiline text',
      text,
      result({ stdout: 'gave up:false\na\nb\n' }),
      { status: 'answered', value: 'a\nb' },
    ],
    [
      'empty text',
      text,
      result({ stdout: 'gave up:false\n\n' }),
      { status: 'answered', value: '' },
    ],
    [
      'confirm yes',
      confirm,
      result({ stdout: 'gave up:false\nYes\n' }),
      { status: 'answered', value: true },
    ],
    [
      'confirm no',
      confirm,
      result({ stdout: 'gave up:false\nNo\n' }),
      { status: 'answered', value: false },
    ],
    [
      'choice',
      choice,
      result({ stdout: 'gave up:false\nBeta\n' }),
      { status: 'answered', value: 'b' },
    ],
    ['gave up', text, result({ stdout: 'gave up:true\n' }), { status: 'timeout' }],
    [
      'cancel -128',
      text,
      result({ code: 1, stderr: 'execution error: User canceled. (-128)' }),
      { status: 'dismissed' },
    ],
    ['list false', choice, result({ stdout: 'false\n' }), { status: 'dismissed' }],
    ['runner timedOut', choice, result({ code: null, timedOut: true }), { status: 'timeout' }],
  ])('parse %s', (_name, request, run, expected) => {
    expect(parseOsascriptAskResult(request, run)).toEqual(expected)
  })

  test('a choice labelled "false" is an answer, not a dismissal', () => {
    const request: AskRequest = { ...choice, choices: [{ value: 'f', label: 'false' }] }
    expect(parseOsascriptAskResult(request, result({ stdout: 'gave up:false\nfalse\n' }))).toEqual({
      status: 'answered',
      value: 'f',
    })
  })

  test('unknown exit code throws first stderr line', () => {
    expect(() =>
      parseOsascriptAskResult(text, result({ code: 1, stderr: 'syntax error\nx' })),
    ).toThrow('syntax error')
    expect(() => parseOsascriptAskResult(text, result({ code: 2 }))).toThrow(
      'osascript exited with code 2',
    )
  })

  test('argv injection', () => {
    for (const request of [
      { ...text, text: HOSTILE },
      { ...confirm, title: HOSTILE },
      { ...choice, choices: [{ value: 'x', label: HOSTILE }] },
    ]) {
      const args = buildOsascriptAskArgs(request, 25)
      const dashes = args.indexOf('--')
      expect(args.indexOf(HOSTILE)).toBeGreaterThan(dashes)
      expect(args.slice(0, dashes).some((a) => a.includes(HOSTILE))).toBe(false)
    }
    const notify = buildOsascriptNotifyArgs({ title: HOSTILE, message: HOSTILE, subtitle: HOSTILE })
    expect(notify.slice(0, notify.indexOf('--')).some((a) => a.includes('rm -rf'))).toBe(false)
    expect(Object.values(OSASCRIPT_ASK_SCRIPTS).join()).not.toContain('rm -rf')
    expect(OSASCRIPT_NOTIFY_SCRIPT).not.toContain('rm -rf')
  })

  test('notify args', () => {
    const args = buildOsascriptNotifyArgs({ title: 'T', message: 'M', subtitle: 'S', sound: true })
    expect(args.slice(args.indexOf('--') + 1)).toEqual(['T', 'M', 'S', '1'])
    const quiet = buildOsascriptNotifyArgs({ title: 'T', message: 'M' })
    expect(quiet.slice(quiet.indexOf('--') + 1)).toEqual(['T', 'M', '', '0'])
    expect(OSASCRIPT_NOTIFY_SCRIPT.match(/sound name "default"/g)).toHaveLength(1)
  })

  test('wrapper ask and notify', async () => {
    const ask = fakeRunner(result({ stdout: 'gave up:false\nYes\n' }))
    const out = await createOsascriptBackend(ask.runner).ask?.(confirm, {
      timeoutMs: 30_000,
      signal,
    })
    expect(out).toEqual({ status: 'answered', value: true })
    expect(firstCall(ask.calls).command).toBe('osascript')
    expect(firstCall(ask.calls).args.at(-1)).toBe('25')
    expect(firstCall(ask.calls).options).toEqual({ timeoutMs: 30_000, signal })

    const notify = fakeRunner(result())
    await createOsascriptBackend(notify.runner).notify?.(
      { title: 'T', message: 'M' },
      { timeoutMs: 5_000, signal },
    )
    expect(firstCall(notify.calls).options).toEqual({ timeoutMs: 5_000, signal })
  })

  test('notify throws on failure and timeout', async () => {
    const failing = createOsascriptBackend(
      fakeRunner(result({ code: 1, stderr: 'no gui\n' })).runner,
    )
    await expect(
      failing.notify?.({ title: 'T', message: 'M' }, { timeoutMs: 5_000, signal }),
    ).rejects.toThrow('no gui')
    const slow = createOsascriptBackend(fakeRunner(result({ code: null, timedOut: true })).runner)
    await expect(
      slow.notify?.({ title: 'T', message: 'M' }, { timeoutMs: 5_000, signal }),
    ).rejects.toThrow('Notification delivery timed out')
  })
})

describe('zenity', () => {
  const list = [
    '--list',
    '--radiolist',
    '--title',
    'T',
    '--text',
    'X',
    '--column',
    'Pick',
    '--column',
    'Choice',
    '--timeout',
    '25',
    '--',
  ]

  test('args per kind', () => {
    expect(buildZenityArgs(text, 25)).toEqual([
      '--entry',
      '--title',
      'T',
      '--text',
      'X',
      '--entry-text',
      'dflt',
      '--timeout',
      '25',
    ])
    expect(buildZenityArgs(confirm, 25)).toEqual([...list, 'TRUE', 'Yes', 'FALSE', 'No'])
    expect(buildZenityArgs({ ...confirm, default: 'no' }, 25)).toEqual([
      ...list,
      'FALSE',
      'Yes',
      'TRUE',
      'No',
    ])
    expect(buildZenityArgs(choice, 25)).toEqual([...list, 'FALSE', 'Alpha', 'TRUE', 'Beta'])
    expect(buildZenityArgs({ ...choice, default: undefined }, 25)).toEqual([
      ...list,
      'TRUE',
      'Alpha',
      'FALSE',
      'Beta',
    ])
  })

  test.each([
    ['text', text, result({ stdout: 'hello\n' }), { status: 'answered', value: 'hello' }],
    ['confirm yes', confirm, result({ stdout: 'Yes\n' }), { status: 'answered', value: true }],
    ['confirm no', confirm, result({ stdout: 'No\n' }), { status: 'answered', value: false }],
    ['choice', choice, result({ stdout: 'Alpha\n' }), { status: 'answered', value: 'a' }],
    ['exit 1', confirm, result({ code: 1 }), { status: 'dismissed' }],
    ['exit 5', confirm, result({ code: 5 }), { status: 'timeout' }],
    ['runner timedOut', text, result({ code: null, timedOut: true }), { status: 'timeout' }],
  ])('parse %s', (_name, request, run, expected) => {
    expect(parseZenityResult(request, run)).toEqual(expected)
  })

  test('unknown exit code throws first stderr line', () => {
    expect(() =>
      parseZenityResult(text, result({ code: -1, stderr: '\n\nCannot open display\nx' })),
    ).toThrow('Cannot open display')
    expect(() => parseZenityResult(text, result({ code: 255 }))).toThrow(
      'zenity exited with code 255',
    )
  })

  test('argv injection', () => {
    expect(buildZenityArgs({ ...text, text: HOSTILE }, 25)).toContain(
      '"; do shell script "rm -rf ~" --x\n\\\\',
    )
    expect(buildZenityArgs({ ...choice, choices: [{ value: 'x', label: HOSTILE }] }, 25)).toContain(
      HOSTILE,
    )
  })

  test('wrapper passes native timeout and unchanged runner timeout', async () => {
    const { runner, calls } = fakeRunner(result({ stdout: 'hi\n' }))
    const out = await createZenityBackend(runner).ask?.(text, { timeoutMs: 30_000, signal })
    expect(out).toEqual({ status: 'answered', value: 'hi' })
    expect(firstCall(calls).command).toBe('zenity')
    expect(firstCall(calls).args.at(-1)).toBe('25')
    expect(firstCall(calls).options).toEqual({ timeoutMs: 30_000, signal })
  })
})

describe('notify-send', () => {
  test('args', () => {
    expect(
      buildNotifySendArgs({ title: 'T', message: 'M', subtitle: 'S', sound: true }, 'mokei'),
    ).toEqual(['--app-name', 'mokei', '--', 'T', 'M'])
  })

  test('wrapper', async () => {
    const { runner, calls } = fakeRunner(result())
    await createNotifySendBackend(runner, 'mokei').notify?.(
      { title: 'T', message: 'M' },
      { timeoutMs: 5_000, signal },
    )
    expect(firstCall(calls)).toEqual({
      command: 'notify-send',
      args: ['--app-name', 'mokei', '--', 'T', 'M'],
      options: { timeoutMs: 5_000, signal },
    })
  })

  test('throws on failure and timeout', async () => {
    const opts = { timeoutMs: 5_000, signal }
    const req = { title: 'T', message: 'M' }
    await expect(
      createNotifySendBackend(
        fakeRunner(result({ code: 1, stderr: 'no bus\n' })).runner,
        'm',
      ).notify?.(req, opts),
    ).rejects.toThrow('no bus')
    await expect(
      createNotifySendBackend(
        fakeRunner(result({ code: null, timedOut: true })).runner,
        'm',
      ).notify?.(req, opts),
    ).rejects.toThrow('Notification delivery timed out')
    expect(createNotifySendBackend(fakeRunner(result()).runner, 'm').ask).toBeUndefined()
  })
})

describe('leading dash values', () => {
  const dashed = ['--help', '-x']

  test.each(dashed)('alerter keeps %s as one element', (v) => {
    const args = buildAlerterArgs(
      { ...choice, title: v, text: v, choices: [{ value: 'x', label: v }] },
      25,
    )
    expect(args.filter((a) => a === v)).toHaveLength(3)
  })

  test.each(dashed)('osascript keeps %s as one element after --', (v) => {
    const args = buildOsascriptAskArgs(
      { ...choice, title: v, text: v, choices: [{ value: 'x', label: v }] },
      25,
    )
    const tail = args.slice(args.indexOf('--') + 1)
    // Title, text, default label and the one choice label
    expect(tail).toEqual([v, v, v, v])
    expect(args.slice(0, args.indexOf('--')).includes(v)).toBe(false)
  })

  test.each(dashed)('zenity rows come after -- for %s', (v) => {
    const args = buildZenityArgs({ ...choice, choices: [{ value: 'x', label: v }] }, 25)
    expect(args.indexOf(v)).toBeGreaterThan(args.indexOf('--'))
    expect(args.filter((a) => a === v)).toHaveLength(1)
    expect(buildZenityArgs(confirm, 25).indexOf('Yes')).toBeGreaterThan(
      buildZenityArgs(confirm, 25).indexOf('--'),
    )
  })

  test.each(dashed)('notify-send title and message come after -- for %s', (v) => {
    const args = buildNotifySendArgs({ title: v, message: v }, 'mokei')
    expect(args).toEqual(['--app-name', 'mokei', '--', v, v])
  })

  // zenity 4 passes entry --text through g_strcompress and mnemonic parsing, and list --text
  // through g_strcompress and Pango markup; titles, column headers and rows are plain text.
  const Special = 'a & b < c > d _e \\f "g" \'h\''

  test('zenity escapes entry --text for g_strcompress and mnemonics', () => {
    const args = buildZenityArgs({ ...text, title: Special, text: Special, default: Special }, 25)
    expect(args).toEqual([
      '--entry',
      '--title',
      Special,
      '--text',
      'a & b < c > d __e \\\\f "g" \'h\'',
      '--entry-text',
      Special,
      '--timeout',
      '25',
    ])
  })

  test.each([
    ['confirm', confirm],
    ['choice', choice],
  ] as const)('zenity escapes %s list --text for g_strcompress and markup', (_, request) => {
    const label = { value: 'x', label: Special }
    const args = buildZenityArgs(
      { ...request, title: Special, text: Special, choices: [label], default: 'x' },
      25,
    )
    expect(args.slice(0, 6)).toEqual([
      '--list',
      '--radiolist',
      '--title',
      Special,
      '--text',
      'a &amp; b &lt; c &gt; d _e \\\\f &quot;g&quot; &apos;h&apos;',
    ])
    if (request.kind === 'choice') {
      expect(args.slice(args.indexOf('--') + 1)).toEqual(['TRUE', Special])
    }
  })

  test('zenity keeps newlines in --text', () => {
    expect(buildZenityArgs({ ...text, text: 'a\nb' }, 25)).toContain('a\nb')
    expect(buildZenityArgs({ ...confirm, text: 'a\nb' }, 25)).toContain('a\nb')
  })

  test('zenity no longer passes --no-markup, which zenity ignores for entry and list', () => {
    for (const request of [text, confirm, choice]) {
      expect(buildZenityArgs(request, 25)).not.toContain('--no-markup')
    }
  })

  test('confirm answers other than Yes/No throw', () => {
    expect(() => parseZenityResult(confirm, result({ stdout: '' }))).toThrow(
      'unknown confirm answer',
    )
    expect(() => parseZenityResult(confirm, result({ stdout: 'Maybe\n' }))).toThrow(
      'unknown confirm answer',
    )
    expect(() => parseOsascriptAskResult(confirm, result({ stdout: 'gave up:false\n' }))).toThrow(
      'unknown confirm answer',
    )
    expect(() =>
      parseOsascriptAskResult(confirm, result({ stdout: 'gave up:false\nMaybe\n' })),
    ).toThrow('unknown confirm answer')
  })

  test('only (-128) is a dismissal', () => {
    expect(() =>
      parseOsascriptAskResult(text, result({ code: 1, stderr: 'error at 1-1280' })),
    ).toThrow()
  })
})

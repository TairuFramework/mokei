import { describe, expect, test, vi } from 'vitest'

import {
  type Availability,
  askBackendFor,
  createDetector,
  detectAvailability,
  type ForcedBackends,
  selectBackends,
} from '../src/detect.js'
import type { AskRequest, BackendName } from '../src/index.js'

const ALL = ['/bin/alerter', '/bin/osascript', '/bin/zenity', '/bin/notify-send']
function has(...names: Array<string>): (path: string) => boolean {
  return (path) => names.some((name) => path === `/bin/${name}`)
}
const GUI = { PATH: '/usr/local/bin:/bin', DISPLAY: ':0', DBUS_SESSION_BUS_ADDRESS: 'unix:x' }

function detect(
  platform: NodeJS.Platform,
  env: Record<string, string | undefined>,
  ...names: Array<string>
) {
  return detectAvailability({ platform, env, isExecutable: has(...names) })
}
function select(availability: Availability, forced: ForcedBackends, platform: NodeJS.Platform) {
  return selectBackends(availability, forced, platform)
}

describe('detectAvailability', () => {
  test('darwin finds alerter and osascript on PATH', () => {
    const a = detect('darwin', { PATH: '/bin' }, 'alerter', 'osascript', 'zenity')
    expect([...a.available].sort()).toEqual(['alerter', 'osascript'])
    expect(a.missing.zenity).toBe('not supported on darwin')
    expect(a.missing['notify-send']).toBe('not supported on darwin')
  })

  test('darwin backend missing from PATH', () => {
    const a = detect('darwin', { PATH: '/bin' }, 'osascript')
    expect(a.available.has('alerter')).toBe(false)
    expect(a.missing.alerter).toBe('not on PATH')
  })

  test('PATH lookup splits on colon and checks every directory', () => {
    const isExecutable = vi.fn((path: string) => path === '/b/osascript')
    const a = detectAvailability({ platform: 'darwin', env: { PATH: '/a:/b' }, isExecutable })
    expect(a.available.has('osascript')).toBe(true)
    expect(isExecutable).toHaveBeenCalledWith('/a/osascript')
  })

  test('zenity needs a display', () => {
    const a = detect('linux', { PATH: '/bin' }, 'zenity')
    expect(a.available.has('zenity')).toBe(false)
    expect(a.missing.zenity).toBe('DISPLAY and WAYLAND_DISPLAY are not set')
  })

  test('empty WAYLAND_DISPLAY counts as unset, non-empty counts as set', () => {
    expect(
      detect('linux', { PATH: '/bin', WAYLAND_DISPLAY: '' }, 'zenity').available.has('zenity'),
    ).toBe(false)
    expect(detect('linux', { PATH: '/bin', DISPLAY: '' }, 'zenity').available.has('zenity')).toBe(
      false,
    )
    expect(
      detect('linux', { PATH: '/bin', WAYLAND_DISPLAY: 'wayland-0' }, 'zenity').available.has(
        'zenity',
      ),
    ).toBe(true)
  })

  test('zenity not on PATH', () => {
    expect(detect('linux', GUI).missing.zenity).toBe('not on PATH')
  })

  test('notify-send needs DBUS_SESSION_BUS_ADDRESS', () => {
    const a = detect('linux', { PATH: '/bin' }, 'notify-send')
    expect(a.available.has('notify-send')).toBe(false)
    expect(a.missing['notify-send']).toBe('DBUS_SESSION_BUS_ADDRESS is not set')
    expect(
      detect('linux', { PATH: '/bin', DBUS_SESSION_BUS_ADDRESS: '' }, 'notify-send').available.size,
    ).toBe(0)
    expect(detect('linux', GUI, 'notify-send').available.has('notify-send')).toBe(true)
  })

  test('linux has no alerter or osascript', () => {
    const a = detect('linux', GUI, 'alerter', 'osascript')
    expect(a.available.size).toBe(0)
    expect(a.missing.alerter).toBe('not supported on linux')
    expect(a.missing.osascript).toBe('not supported on linux')
  })

  test('win32 has no backends', () => {
    const a = detect('win32', GUI, 'alerter', 'osascript', 'zenity', 'notify-send')
    expect(a.available.size).toBe(0)
    for (const name of ['alerter', 'osascript', 'zenity', 'notify-send'] as Array<BackendName>) {
      expect(a.missing[name]).toBe('not supported on win32')
    }
  })

  test('missing PATH means nothing is found', () => {
    expect(detect('darwin', {}, 'osascript').available.size).toBe(0)
  })
})

describe('selectBackends', () => {
  test('darwin auto prefers alerter, falls back to osascript', () => {
    const both = select(detect('darwin', GUI, 'alerter', 'osascript'), {}, 'darwin')
    expect(both.ask).toEqual({ name: 'alerter', forced: false })
    expect(both.notify).toEqual({ name: 'osascript', forced: false })
    const one = select(detect('darwin', GUI, 'osascript'), {}, 'darwin')
    expect(one.ask).toEqual({ name: 'osascript', forced: false })
  })

  test('linux auto picks zenity and notify-send', () => {
    const s = select(detect('linux', GUI, 'zenity', 'notify-send'), {}, 'linux')
    expect(s.ask).toEqual({ name: 'zenity', forced: false })
    expect(s.notify).toEqual({ name: 'notify-send', forced: false })
  })

  test('darwin hints', () => {
    const s = select(detect('darwin', GUI), {}, 'darwin')
    expect(s.ask).toBeUndefined()
    expect(s.askProblem).toContain('alerter')
    expect(s.askProblem).toContain('osascript')
    expect(s.askProblem).toContain('GUI session')
    expect(s.notifyProblem).toContain('osascript')
    expect(s.notifyProblem).toContain('GUI session')
  })

  test('linux hints name the missing session variable', () => {
    const noSession = select(
      detect('linux', { PATH: '/bin' }, 'zenity', 'notify-send'),
      {},
      'linux',
    )
    expect(noSession.askProblem).toContain('zenity')
    expect(noSession.askProblem).toContain('DISPLAY')
    expect(noSession.notifyProblem).toContain('notify-send (libnotify-bin)')
    expect(noSession.notifyProblem).toContain('DBUS_SESSION_BUS_ADDRESS')
    const noBinaries = select(detect('linux', GUI), {}, 'linux')
    expect(noBinaries.askProblem).toContain('zenity')
    expect(noBinaries.askProblem).not.toContain('DISPLAY')
    expect(noBinaries.notifyProblem).toContain('notify-send (libnotify-bin)')
    expect(noBinaries.notifyProblem).not.toContain('DBUS_SESSION_BUS_ADDRESS')
    expect(noBinaries.askProblem).toContain('GUI session')
  })

  test('win32 selects nothing and reports a problem', () => {
    const s = select(detect('win32', GUI), {}, 'win32')
    expect(s.ask).toBeUndefined()
    expect(s.notify).toBeUndefined()
    expect(s.askProblem).toContain('win32')
    expect(s.notifyProblem).toContain('win32')
  })

  test('a forced available backend is selected as forced', () => {
    const s = select(detect('darwin', GUI, 'alerter', 'osascript'), { ask: 'osascript' }, 'darwin')
    expect(s.ask).toEqual({ name: 'osascript', forced: true })
  })

  test('a forced unavailable backend is never overridden', () => {
    const s = select(
      detect('darwin', GUI, 'osascript'),
      { ask: 'alerter', notify: 'notify-send' },
      'darwin',
    )
    expect(s.ask).toBeUndefined()
    expect(s.askProblem).toBe('Forced dialog backend alerter is unavailable: not on PATH')
    expect(s.notify).toBeUndefined()
    expect(s.notifyProblem).toBe(
      'Forced notify backend notify-send is unavailable: not supported on darwin',
    )
  })
})

describe('askBackendFor', () => {
  const comma: AskRequest = {
    kind: 'choice',
    title: 't',
    text: 'x',
    choices: [
      { value: 'a', label: 'A, B' },
      { value: 'b', label: 'C' },
    ],
  }
  const plain: AskRequest = { kind: 'confirm', title: 't', text: 'x' }

  test('forced alerter cannot show a comma label', () => {
    const a = detect('darwin', GUI, 'alerter', 'osascript')
    const r = askBackendFor(comma, select(a, { ask: 'alerter' }, 'darwin'), a)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('alerter cannot show a choice label containing a comma')
  })

  test('auto alerter falls back to osascript for a comma label', () => {
    const a = detect('darwin', GUI, 'alerter', 'osascript')
    expect(askBackendFor(comma, select(a, {}, 'darwin'), a)).toEqual({
      ok: true,
      name: 'osascript',
    })
  })

  test('auto alerter without osascript fails with the osascript hint', () => {
    const a = detect('darwin', GUI, 'alerter')
    const r = askBackendFor(comma, select(a, {}, 'darwin'), a)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('osascript')
  })

  const dash: AskRequest = { kind: 'text', title: 't', text: 'x', default: '--appIcon' }

  test('forced alerter cannot show a value starting with -', () => {
    const a = detect('darwin', GUI, 'alerter', 'osascript')
    const r = askBackendFor(dash, select(a, { ask: 'alerter' }, 'darwin'), a)
    expect(r).toEqual({
      ok: false,
      reason:
        'alerter cannot show a value starting with "-", which it could read as an option; change the request or use another dialog backend',
    })
  })

  test('auto alerter falls back to osascript for a value starting with -', () => {
    const a = detect('darwin', GUI, 'alerter', 'osascript')
    expect(askBackendFor(dash, select(a, {}, 'darwin'), a)).toEqual({
      ok: true,
      name: 'osascript',
    })
  })

  test('alerter is used when no label has a comma', () => {
    const a = detect('darwin', GUI, 'alerter', 'osascript')
    expect(askBackendFor(plain, select(a, {}, 'darwin'), a)).toEqual({ ok: true, name: 'alerter' })
  })

  test('no ask backend returns the problem', () => {
    const a = detect('linux', GUI)
    const s = select(a, {}, 'linux')
    expect(askBackendFor(plain, s, a)).toEqual({ ok: false, reason: s.askProblem })
  })
})

describe('createDetector', () => {
  test('detects lazily, once', () => {
    const isExecutable = vi.fn(has('osascript'))
    const detector = createDetector({ platform: 'darwin', env: { PATH: '/bin' }, isExecutable })
    expect(isExecutable).not.toHaveBeenCalled()
    const first = detector()
    const calls = isExecutable.mock.calls.length
    expect(calls).toBeGreaterThan(0)
    expect(detector()).toBe(first)
    expect(isExecutable.mock.calls.length).toBe(calls)
    expect(first.selection.ask?.name).toBe('osascript')
  })

  test('applies forced backends', () => {
    const detector = createDetector({
      platform: 'darwin',
      env: { PATH: '/bin' },
      isExecutable: has(...ALL.map((p) => p.slice(5))),
      forced: { notify: 'osascript' },
    })
    expect(detector().selection.notify).toEqual({ name: 'osascript', forced: true })
  })
})

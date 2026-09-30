import { accessSync, constants } from 'node:fs'

import { alerterCanShow } from './backends/alerter.js'
import type {
  AskBackendName,
  AskRequest,
  BackendName,
  NotifyBackendName,
} from './backends/types.js'

export type DetectOptions = {
  platform: NodeJS.Platform
  env: Record<string, string | undefined>
  /** Defaults to `fs.accessSync(path, X_OK)` succeeding. */
  isExecutable?: (path: string) => boolean
}
export type ForcedBackends = { ask?: AskBackendName; notify?: NotifyBackendName }
export type Availability = {
  available: ReadonlySet<BackendName>
  missing: Partial<Record<BackendName, string>>
}
export type BackendSelection = {
  ask?: { name: AskBackendName; forced: boolean }
  notify?: { name: NotifyBackendName; forced: boolean }
  /** Install hint, or the forced-unavailable message. */
  askProblem?: string
  notifyProblem?: string
}

const ALL_BACKENDS: Array<BackendName> = ['alerter', 'osascript', 'zenity', 'notify-send']
const PLATFORM_OF: Record<BackendName, NodeJS.Platform> = {
  alerter: 'darwin',
  osascript: 'darwin',
  zenity: 'linux',
  'notify-send': 'linux',
}
const DISPLAY_MISSING = 'DISPLAY and WAYLAND_DISPLAY are not set'
const DBUS_MISSING = 'DBUS_SESSION_BUS_ADDRESS is not set'
const GUI_SESSION_NOTE =
  'The process must run in the desktop user GUI session (not a daemon, cron job or system service).'

function defaultIsExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

function isSet(value: string | undefined): boolean {
  return value != null && value !== ''
}

export function detectAvailability(options: DetectOptions): Availability {
  const { platform, env } = options
  const isExecutable = options.isExecutable ?? defaultIsExecutable
  const dirs = (env.PATH ?? '').split(':').filter((dir) => dir !== '')
  const onPath = (name: string) => dirs.some((dir) => isExecutable(`${dir}/${name}`))

  const available = new Set<BackendName>()
  const missing: Partial<Record<BackendName, string>> = {}
  for (const name of ALL_BACKENDS) {
    let reason: string | undefined
    if (PLATFORM_OF[name] !== platform) {
      reason = `not supported on ${platform}`
    } else if (!onPath(name)) {
      reason = 'not on PATH'
    } else if (name === 'zenity' && !isSet(env.DISPLAY) && !isSet(env.WAYLAND_DISPLAY)) {
      reason = DISPLAY_MISSING
    } else if (name === 'notify-send' && !isSet(env.DBUS_SESSION_BUS_ADDRESS)) {
      reason = DBUS_MISSING
    }
    if (reason == null) {
      available.add(name)
    } else {
      missing[name] = reason
    }
  }
  return { available, missing }
}

type Capability = 'dialog' | 'notify'

function installHint(
  capability: Capability,
  availability: Availability,
  platform: NodeJS.Platform,
): string {
  if (platform === 'darwin') {
    const base =
      capability === 'dialog'
        ? 'No dialog backend found. Install alerter (brew install vjeantet/tap/alerter) or make osascript available.'
        : 'No notification backend found. Make osascript available.'
    return `${base} ${GUI_SESSION_NOTE}`
  }
  if (platform === 'linux') {
    if (capability === 'dialog') {
      const cause =
        availability.missing.zenity === DISPLAY_MISSING
          ? ' DISPLAY or WAYLAND_DISPLAY must be set.'
          : ''
      return `No dialog backend found. Install zenity.${cause} ${GUI_SESSION_NOTE}`
    }
    const cause =
      availability.missing['notify-send'] === DBUS_MISSING
        ? ' DBUS_SESSION_BUS_ADDRESS must be set.'
        : ''
    return `No notification backend found. Install notify-send (libnotify-bin).${cause} ${GUI_SESSION_NOTE}`
  }
  return `Desktop ${capability === 'dialog' ? 'dialogs are' : 'notifications are'} not supported on ${platform}. ${GUI_SESSION_NOTE}`
}

function select<Name extends BackendName>(
  capability: Capability,
  order: Array<Name>,
  forced: Name | undefined,
  availability: Availability,
  platform: NodeJS.Platform,
): { chosen?: { name: Name; forced: boolean }; problem?: string } {
  if (forced != null) {
    if (availability.available.has(forced)) {
      return { chosen: { name: forced, forced: true } }
    }
    const why = availability.missing[forced] ?? 'unavailable'
    return { problem: `Forced ${capability} backend ${forced} is unavailable: ${why}` }
  }
  const name = order.find((candidate) => availability.available.has(candidate))
  if (name != null) {
    return { chosen: { name, forced: false } }
  }
  return { problem: installHint(capability, availability, platform) }
}

export function selectBackends(
  availability: Availability,
  forced: ForcedBackends,
  platform: NodeJS.Platform,
): BackendSelection {
  const askOrder: Array<AskBackendName> =
    platform === 'darwin' ? ['alerter', 'osascript'] : platform === 'linux' ? ['zenity'] : []
  const notifyOrder: Array<NotifyBackendName> =
    platform === 'darwin' ? ['osascript'] : platform === 'linux' ? ['notify-send'] : []
  const ask = select('dialog', askOrder, forced.ask, availability, platform)
  const notify = select('notify', notifyOrder, forced.notify, availability, platform)
  return {
    ask: ask.chosen,
    notify: notify.chosen,
    askProblem: ask.problem,
    notifyProblem: notify.problem,
  }
}

export function askBackendFor(
  request: AskRequest,
  selection: BackendSelection,
  availability: Availability,
): { ok: true; name: AskBackendName } | { ok: false; reason: string } {
  const ask = selection.ask
  if (ask == null) {
    return { ok: false, reason: selection.askProblem ?? 'No dialog backend is available' }
  }
  if (ask.name !== 'alerter' || alerterCanShow(request)) {
    return { ok: true, name: ask.name }
  }
  const comma = 'alerter cannot show a choice label containing a comma'
  if (ask.forced) {
    return { ok: false, reason: `${comma}; use a different label or another dialog backend` }
  }
  if (availability.available.has('osascript')) {
    return { ok: true, name: 'osascript' }
  }
  return {
    ok: false,
    reason: `${comma}, and the osascript fallback is unavailable: ${availability.missing.osascript ?? 'unavailable'}. Make osascript available or avoid commas in choice labels.`,
  }
}

export function createDetector(
  options: DetectOptions & { forced?: ForcedBackends },
): () => { availability: Availability; selection: BackendSelection } {
  let cached: { availability: Availability; selection: BackendSelection } | undefined
  return () => {
    if (cached == null) {
      const availability = detectAvailability(options)
      cached = {
        availability,
        selection: selectBackends(availability, options.forced ?? {}, options.platform),
      }
    }
    return cached
  }
}

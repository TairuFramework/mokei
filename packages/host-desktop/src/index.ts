export { createAlerterBackend } from './backends/alerter.js'
export { createNotifySendBackend } from './backends/notify-send.js'
export { createOsascriptBackend } from './backends/osascript.js'
export type {
  AskBackendName,
  AskKind,
  AskRequest,
  AskResult,
  BackendCallOptions,
  BackendName,
  DesktopBackend,
  NotifyBackendName,
  NotifyRequest,
} from './backends/types.js'
export { createZenityBackend } from './backends/zenity.js'
export {
  type Availability,
  askBackendFor,
  type BackendSelection,
  createDetector,
  type DetectOptions,
  detectAvailability,
  type ForcedBackends,
  selectBackends,
} from './detect.js'
export { createRunner, type Runner, type RunOptions, type RunResult } from './runner.js'

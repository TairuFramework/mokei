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
  NotifyCallOptions,
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
  notifyBackendFor,
  selectBackends,
} from './detect.js'
export {
  createDesktopElicitHandler,
  type DesktopElicitHandler,
  type DesktopElicitOptions,
} from './elicit-handler.js'
export {
  createInputInbox,
  type DesktopElicitRequest,
  InboxAnswerInvalidError,
  InboxDisposedError,
  type InboxPrompt,
  type InputInbox,
  type InputInboxEvents,
  type PendingInput,
} from './inbox.js'
export { createDesktopInputSurface, type DesktopInputSurface } from './input-surface.js'
export {
  createDesktopNotifier,
  type DesktopNotifier,
  type DesktopNotifyOptions,
} from './notification.js'
export { createRunner, type Runner, type RunOptions, type RunResult } from './runner.js'
export { createDesktopTools, type DesktopTools, type DesktopToolsOptions } from './tools.js'

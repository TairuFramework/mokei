export type { FlowConfig } from './config.js'
export { FlowConfigError, loadFlowConfig } from './config.js'
export { openFlowDatabase } from './database.js'
export type { FlowDesktopAdapter, FlowDesktopController } from './desktop.js'
export {
  createFlowDesktopController,
  DesktopPromptUnavailableError,
  InboxPromptInProgressError,
} from './desktop.js'
export { loadFlowDirs } from './flow-dirs.js'
export { createFlowHandlers, type FlowHandlers } from './handlers.js'
export { createMonitorHandlers, type MonitorHandlers } from './monitor-handlers.js'
export type { MonitorPresence, MonitorTab, MonitorTabState } from './monitor-presence.js'
export {
  createMonitorPresence,
  MonitorAttachmentNotFoundError,
  MonitorURLError,
  PRESENCE_REPLY_TIMEOUT_MS,
  parseMonitorURL,
} from './monitor-presence.js'
export { createMonitorSurface } from './monitor-surface.js'
export { startRetention } from './retention.js'
export type { FlowResources, FlowService, FlowServiceParams, FlowServiceStatus } from './service.js'
export { createFlowService, FlowServiceUnavailableError } from './service.js'
export { createSQLiteRunStore } from './sqlite-run-store.js'
export { createSQLiteTaskStore } from './sqlite-task-store.js'
export { createSQLiteTraceStore } from './sqlite-trace-store.js'
export type { InboxSurface, PromptOutcome, SurfaceDelivery, SurfaceStatus } from './surfaces.js'
export { setupFlowTelemetry } from './telemetry.js'

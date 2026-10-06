export type { FlowConfig } from './config.js'
export { FlowConfigError, loadFlowConfig } from './config.js'
export { openFlowDatabase } from './database.js'
export type {
  DesktopPromptUnavailableErrorParams,
  FlowDesktopAdapter,
  FlowDesktopController,
  InboxPromptInProgressErrorParams,
} from './desktop.js'
export {
  createFlowDesktopController,
  DesktopPromptUnavailableError,
  InboxPromptInProgressError,
} from './desktop.js'
export { loadFlowDirs } from './flow-dirs.js'
export { createFlowHandlers, type FlowHandlers } from './handlers.js'
export { createMonitorHandlers, type MonitorHandlers } from './monitor-handlers.js'
export type {
  MonitorAttachmentNotFoundErrorParams,
  MonitorPresence,
  MonitorTab,
  MonitorTabState,
  MonitorURLErrorParams,
} from './monitor-presence.js'
export {
  createMonitorPresence,
  MonitorAttachmentNotFoundError,
  MonitorURLError,
  PRESENCE_REPLY_TIMEOUT_MS,
  parseMonitorURL,
} from './monitor-presence.js'
export { createMonitorSurface } from './monitor-surface.js'
export { createNativeSurface } from './native-surface.js'
export { startRetention } from './retention.js'
export type { FlowRunTables } from './run-store.js'
export { FLOW_RUN_STORE, getFlowRunStore, runStoreDefinition } from './run-store.js'
export type {
  FlowResources,
  FlowService,
  FlowServiceParams,
  FlowServiceStatus,
  FlowServiceUnavailableErrorParams,
} from './service.js'
export { createFlowService, FlowServiceUnavailableError } from './service.js'
export { createSQLiteRunStore } from './sqlite-run-store.js'
export { createSQLiteTaskStore } from './sqlite-task-store.js'
export { createSQLiteTraceStore } from './sqlite-trace-store.js'
export type { InboxSurface, PromptOutcome, SurfaceDelivery, SurfaceStatus } from './surfaces.js'
export type { FlowTaskTables } from './task-store.js'
export { FLOW_TASK_STORE, getFlowTaskStore, taskStoreDefinition } from './task-store.js'
export { setupFlowTelemetry } from './telemetry.js'

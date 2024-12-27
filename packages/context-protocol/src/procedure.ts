import type { CompleteRequest, CompleteResult } from './completion.js'
import type { InitializeRequest, InitializeResult, InitializedNotification } from './initialize.js'
import type { SetLevelRequest } from './logging.js'
import type {
  GetPromptRequest,
  GetPromptResult,
  ListPromptsRequest,
  ListPromptsResult,
  PromptListChangedNotification,
} from './prompt.js'
import type {
  ListResourceTemplatesRequest,
  ListResourceTemplatesResult,
  ListResourcesRequest,
  ListResourcesResult,
  ResourceListChangedNotification,
} from './resource.js'
import type { CancelledNotification, PingRequest, ProgressNotification } from './rpc.js'
import type {
  CallToolRequest,
  CallToolResult,
  ListToolsRequest,
  ListToolsResult,
  ToolListChangedNotification,
} from './tool.js'

export type ClientNotifications = {
  cancelled: CancelledNotification
  initialized: InitializedNotification
  progress: ProgressNotification
}

export type ClientRequests = {
  'completion/complete': {
    Method: CompleteRequest['method']
    Params: CompleteRequest['params']
    Result: CompleteResult
  }
  initialize: {
    Method: InitializeRequest['method']
    Params: InitializeRequest['params']
    Result: InitializeResult
  }
  'logging/setLevel': {
    Method: SetLevelRequest['method']
    Params: SetLevelRequest['params']
    Result: undefined
  }
  ping: {
    Method: PingRequest['method']
    Params: PingRequest['params']
    Result: undefined
  }
  'prompts/get': {
    Method: GetPromptRequest['method']
    Params: GetPromptRequest['params']
    Result: GetPromptResult
  }
  'prompts/list': {
    Method: ListPromptsRequest['method']
    Params: ListPromptsRequest['params']
    Result: ListPromptsResult
  }
  'resources/list': {
    Method: ListResourcesRequest['method']
    Params: ListResourcesRequest['params']
    Result: ListResourcesResult
  }
  'resources/templates/list': {
    Method: ListResourceTemplatesRequest['method']
    Params: ListResourceTemplatesRequest['params']
    Result: ListResourceTemplatesResult
  }
  'tools/call': {
    Method: CallToolRequest['method']
    Params: CallToolRequest['params']
    Result: CallToolResult
  }
  'tools/list': {
    Method: ListToolsRequest['method']
    Params: ListToolsRequest['params']
    Result: ListToolsResult
  }
}

export type ServerNotifications = {
  'prompts/list_changed': PromptListChangedNotification
  'resources/list_changed': ResourceListChangedNotification
  'tools/list_changed': ToolListChangedNotification
}

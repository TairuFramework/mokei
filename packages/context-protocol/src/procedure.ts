import type { CompleteRequest, CompleteResult } from './completion.js'
import type { ElicitRequest, ElicitResult } from './elicitation.js'
import type { InitializedNotification, InitializeRequest, InitializeResult } from './initialize.js'
import type { SetLevelRequest } from './logging.js'
import type {
  GetPromptRequest,
  GetPromptResult,
  ListPromptsRequest,
  ListPromptsResult,
  PromptListChangedNotification,
} from './prompt.js'
import type {
  ListResourcesRequest,
  ListResourcesResult,
  ListResourceTemplatesRequest,
  ListResourceTemplatesResult,
  ReadResourceRequest,
  ReadResourceResult,
  ResourceListChangedNotification,
} from './resource.js'
import type { ListRootsRequest, ListRootsResult, RootsListChangedNotification } from './root.js'
import type { CancelledNotification, PingRequest, ProgressNotification, Result } from './rpc.js'
import type { CreateMessageRequest, CreateMessageResult } from './sampling.js'
import type {
  CallToolRequest,
  CallToolResult,
  ListToolsRequest,
  ListToolsResult,
  ToolListChangedNotification,
} from './tool.js'

export type CommonNotifications = {
  cancelled: CancelledNotification
  progress: ProgressNotification
}

export type CommonRequests = {
  ping: {
    Method: PingRequest['method']
    Params: PingRequest['params']
    Result: Result
  }
}

export type ClientNotifications = {
  initialized: InitializedNotification
  'roots/list_changed': RootsListChangedNotification
}

export type ClientRequests = {
  'completion/complete': {
    Params: CompleteRequest['params']
    Result: CompleteResult
  }
  initialize: {
    Params: InitializeRequest['params']
    Result: InitializeResult
  }
  'logging/setLevel': {
    Params: SetLevelRequest['params']
    Result: Result
  }
  'prompts/get': {
    Params: GetPromptRequest['params']
    Result: GetPromptResult
  }
  'prompts/list': {
    Params: ListPromptsRequest['params']
    Result: ListPromptsResult
  }
  'resources/list': {
    Params: ListResourcesRequest['params']
    Result: ListResourcesResult
  }
  'resources/read': {
    Params: ReadResourceRequest['params']
    Result: ReadResourceResult
  }
  'resources/templates/list': {
    Params: ListResourceTemplatesRequest['params']
    Result: ListResourceTemplatesResult
  }
  'tools/call': {
    Params: CallToolRequest['params']
    Result: CallToolResult
  }
  'tools/list': {
    Params: ListToolsRequest['params']
    Result: ListToolsResult
  }
}

export type ServerNotifications = {
  'prompts/list_changed': PromptListChangedNotification
  'resources/list_changed': ResourceListChangedNotification
  'tools/list_changed': ToolListChangedNotification
}

export type ServerRequests = {
  'elicitation/create': {
    Params: ElicitRequest['params']
    Result: ElicitResult
  }
  'roots/list': {
    Params: ListRootsRequest['params']
    Result: ListRootsResult
  }
  'sampling/createMessage': {
    Params: CreateMessageRequest['params']
    Result: CreateMessageResult
  }
}

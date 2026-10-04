import { HandlerError } from '@enkaku/server'
import {
  FlowCheckError,
  FlowNotFoundError,
  InboxAnswerInvalidError,
  InboxItemNotFoundError,
  RunNotFoundError,
} from '@mokei/flow-host'
import { getReporter } from '@sozai/log'

import { DesktopPromptUnavailableError, InboxPromptInProgressError } from './desktop.js'
import { FlowServiceUnavailableError } from './service.js'

const report = getReporter(['mokei', 'flow-host', 'handlers'], '@mokei/flow-host-node')

export function toHandlerError(error: unknown): HandlerError<string> {
  if (error instanceof FlowServiceUnavailableError) {
    return new HandlerError({
      code: 'FLOW_UNAVAILABLE',
      message: error.message,
      data: { status: error.status },
    })
  }
  if (error instanceof FlowCheckError || error instanceof InboxAnswerInvalidError) {
    return new HandlerError({
      code: error instanceof FlowCheckError ? 'FLOW_INVALID' : 'INBOX_ANSWER_INVALID',
      message: error.message,
      data: { issues: [...error.issues] },
    })
  }
  if (error instanceof FlowNotFoundError) {
    return new HandlerError({ code: 'FLOW_NOT_FOUND', message: error.message })
  }
  if (error instanceof RunNotFoundError) {
    return new HandlerError({ code: 'RUN_NOT_FOUND', message: error.message })
  }
  if (error instanceof InboxItemNotFoundError) {
    return new HandlerError({ code: 'INBOX_ITEM_NOT_FOUND', message: error.message })
  }
  if (error instanceof DesktopPromptUnavailableError) {
    return new HandlerError({ code: 'PROMPT_UNSUPPORTED', message: error.message })
  }
  if (error instanceof InboxPromptInProgressError) {
    return new HandlerError({ code: 'PROMPT_IN_PROGRESS', message: error.message })
  }
  report('Flow request failed', error)
  return new HandlerError({ code: 'INTERNAL_ERROR', message: 'Flow request failed' })
}

import { HandlerError } from '@enkaku/server'
import { describeFlowHostError } from '@mokei/flow-host'
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
  if (error instanceof DesktopPromptUnavailableError) {
    return new HandlerError({ code: 'PROMPT_UNSUPPORTED', message: error.message })
  }
  if (error instanceof InboxPromptInProgressError) {
    return new HandlerError({ code: 'PROMPT_IN_PROGRESS', message: error.message })
  }
  const description = describeFlowHostError(error)
  if (description != null) {
    return new HandlerError(description)
  }
  report('Flow request failed', error)
  return new HandlerError({ code: 'INTERNAL_ERROR', message: 'Flow request failed' })
}

export type FlowNotFoundErrorParams = { flowID: string }

export class FlowNotFoundError extends Error {
  constructor(params: FlowNotFoundErrorParams) {
    super(`Flow not found: ${params.flowID}`)
    this.name = 'FlowNotFoundError'
  }
}

export type FlowCheckErrorParams = { issues: Array<string> }

export class FlowCheckError extends Error {
  #issues: Array<string>

  constructor(params: FlowCheckErrorParams) {
    super(params.issues.join('; '))
    this.name = 'FlowCheckError'
    this.#issues = params.issues
  }

  get issues(): Array<string> {
    return this.#issues
  }
}

export type RunNotFoundErrorParams = { runID: string }

export class RunNotFoundError extends Error {
  constructor(params: RunNotFoundErrorParams) {
    super(`Run not found: ${params.runID}`)
    this.name = 'RunNotFoundError'
  }
}

export type InboxItemNotFoundErrorParams = { itemID: string }

export class InboxItemNotFoundError extends Error {
  constructor(params: InboxItemNotFoundErrorParams) {
    super(`Inbox item not found: ${params.itemID}`)
    this.name = 'InboxItemNotFoundError'
  }
}

export type InboxAnswerInvalidErrorParams = { issues: Array<string> }

export class InboxAnswerInvalidError extends Error {
  #issues: Array<string>

  constructor(params: InboxAnswerInvalidErrorParams) {
    super(params.issues.join('; '))
    this.name = 'InboxAnswerInvalidError'
    this.#issues = params.issues
  }

  get issues(): Array<string> {
    return this.#issues
  }
}

export type FlowHostErrorDescription = {
  code:
    | 'FLOW_INVALID'
    | 'FLOW_NOT_FOUND'
    | 'RUN_NOT_FOUND'
    | 'INBOX_ITEM_NOT_FOUND'
    | 'INBOX_ANSWER_INVALID'
  message: string
  data?: { issues: Array<string> }
}

export function describeFlowHostError(error: unknown): FlowHostErrorDescription | undefined {
  if (error instanceof FlowCheckError || error instanceof InboxAnswerInvalidError) {
    return {
      code: error instanceof FlowCheckError ? 'FLOW_INVALID' : 'INBOX_ANSWER_INVALID',
      message: error.message,
      data: { issues: [...error.issues] },
    }
  }
  if (error instanceof FlowNotFoundError) {
    return { code: 'FLOW_NOT_FOUND', message: error.message }
  }
  if (error instanceof RunNotFoundError) {
    return { code: 'RUN_NOT_FOUND', message: error.message }
  }
  if (error instanceof InboxItemNotFoundError) {
    return { code: 'INBOX_ITEM_NOT_FOUND', message: error.message }
  }
  return undefined
}

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

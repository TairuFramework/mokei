export class FlowNotFoundError extends Error {
  constructor(flowID: string) {
    super(`Flow not found: ${flowID}`)
    this.name = 'FlowNotFoundError'
  }
}

export class FlowCheckError extends Error {
  #issues: Array<string>

  constructor(issues: Array<string>) {
    super(issues.join('; '))
    this.name = 'FlowCheckError'
    this.#issues = issues
  }

  get issues(): Array<string> {
    return this.#issues
  }
}

export class RunNotFoundError extends Error {
  constructor(runID: string) {
    super(`Run not found: ${runID}`)
    this.name = 'RunNotFoundError'
  }
}

export class InboxItemNotFoundError extends Error {
  constructor(id: string) {
    super(`Inbox item not found: ${id}`)
    this.name = 'InboxItemNotFoundError'
  }
}

export class InboxAnswerInvalidError extends Error {
  #issues: Array<string>

  constructor(issues: Array<string>) {
    super(issues.join('; '))
    this.name = 'InboxAnswerInvalidError'
    this.#issues = issues
  }

  get issues(): Array<string> {
    return this.#issues
  }
}

import type { FlowIssue } from '@sozai/flow-graph'

export type RegisteredFlowErrorParams = {
  flowID: string
  issues: ReadonlyArray<FlowIssue>
  message: string
}

/** A registered flow definition was rejected at registration time. */
export class RegisteredFlowError extends Error {
  #flowID: string
  #issues: ReadonlyArray<FlowIssue>

  constructor(params: RegisteredFlowErrorParams) {
    super(params.message)
    this.name = 'RegisteredFlowError'
    this.#flowID = params.flowID
    this.#issues = structuredClone(params.issues)
  }

  get flowID(): string {
    return this.#flowID
  }

  /** The blocking issues that rejected the flow. */
  get issues(): Array<FlowIssue> {
    return structuredClone([...this.#issues])
  }
}

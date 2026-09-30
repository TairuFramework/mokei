import { matchesAllow } from './config.mjs'

/** Approve flows whose tools are all allowlisted; otherwise follow the `confirm` mode. */
export function createApprovalStrategy({ allow, confirm, confirmDialog }) {
  return async (request) => {
    const flow = request.flow
    if (flow === undefined) return true
    const disallowed = flow.tools.filter((tool) => !matchesAllow(tool, allow))
    if (disallowed.length === 0) return true
    if (confirm === 'approve') return true
    if (confirm === 'deny') {
      return { approved: false, reason: `Not in allowlist: ${disallowed.join(', ')}` }
    }
    const approved = await confirmDialog(flow, request.signal)
    return approved ? true : { approved: false, reason: 'Declined on desktop' }
  }
}

/** Adapt the decision-flow `wrapApproval` output to the run manager's `approve` contract. */
export function createApprove({ wrapped }) {
  return async ({ runId, toolName, args, signal }) => {
    const result = await wrapped({
      toolCall: { id: runId, name: `flow:${toolName}`, arguments: JSON.stringify(args) },
      iteration: 1,
      history: [],
      signal,
    })
    if (result === true) return { approved: true, meta: {} }
    if (result === false) return { approved: false, reason: 'denied' }
    if (result.approved) return { approved: true, meta: result.meta ?? {} }
    return { approved: false, reason: result.reason ?? 'denied' }
  }
}

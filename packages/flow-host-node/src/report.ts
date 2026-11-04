import { getReporter, isSetup } from '@sozai/log'

/** Logger category for flow-host error reports, routed to the console instead of the log store. */
export const FLOW_REPORT_CATEGORY: ReadonlyArray<string> = ['mokei', 'flow-host', 'capture']

export type FlowReport = (message: string, error: unknown) => void

/**
 * A reporter whose records render the error in the message itself. Console sinks print only the
 * message, so an error passed as a record property alone never reaches the daemon output.
 */
export function getFlowReporter(packageName: string): FlowReport {
  const report = getReporter([...FLOW_REPORT_CATEGORY], packageName)
  return (message, error) => {
    if (!isSetup()) {
      // The unconfigured fallback prints the error beside the message.
      report(message, error)
      return
    }
    report(`${message.replaceAll('{', '{{').replaceAll('}', '}}')}: {error}`, error)
  }
}

import { type FlowRunSnapshot, isFlowControlError } from '@mokei/flow-client'
import { useMemo } from 'react'

import { useFlow } from './FlowProvider.js'
import { type ReconciledQuery, useReconciledQuery } from './useReconciledQuery.js'

export function useRun(runID: string) {
  const { control } = useFlow()
  const query = useMemo<
    ReconciledQuery<FlowRunSnapshot | undefined, FlowRunSnapshot | undefined>
  >(() => {
    const read = async () => {
      try {
        return await control.runs.get(runID)
      } catch (error) {
        if (!isFlowControlError(error, 'RUN_NOT_FOUND')) throw error
      }
    }
    return {
      initial: undefined,
      read,
      affected: (event) => {
        return event.type === 'run:state' && event.data.runID === runID ? runID : undefined
      },
      readAffected: read,
      merge: (_data, _id, run) => run,
      apply: (run, event) => (event.type === 'run:state' ? event.data : run),
    }
  }, [control, runID])
  const { data, ...state } = useReconciledQuery(query)
  return { run: data, ...state }
}

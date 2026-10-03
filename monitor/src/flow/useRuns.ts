import type { FlowRunSnapshot, RunListFilter } from '@mokei/flow-client'
import { isFlowControlError } from '@mokei/flow-client'
import { useMemo } from 'react'

import { useFlow } from './FlowProvider.js'
import { applyRunEvent } from './reconcile.js'
import { type ReconciledQuery, useReconciledQuery } from './useReconciledQuery.js'

function filterRuns(runs: Map<string, FlowRunSnapshot>, filter?: RunListFilter) {
  const entries = [...runs.values()]
    .filter((run) => {
      return (
        (filter?.states == null || filter.states.includes(run.state)) &&
        (filter?.updatedBefore == null || run.updatedAt < filter.updatedBefore)
      )
    })
    .sort((a, b) => b.createdAt - a.createdAt)
  return new Map(entries.map((run) => [run.runID, run]))
}

export function useRuns(filter?: RunListFilter) {
  const { control } = useFlow()
  const filterKey = JSON.stringify(filter ?? {})
  const query = useMemo<
    ReconciledQuery<Map<string, FlowRunSnapshot>, FlowRunSnapshot | undefined>
  >(() => {
    const params: RunListFilter = JSON.parse(filterKey)
    const merge = (runs: Map<string, FlowRunSnapshot>, runID: string, run?: FlowRunSnapshot) => {
      const next = new Map(runs)
      next.delete(runID)
      if (run != null) next.set(runID, run)
      return filterRuns(next, params)
    }
    return {
      initial: new Map(),
      read: async () => {
        return filterRuns(
          new Map((await control.runs.list(params)).map((run) => [run.runID, run])),
          params,
        )
      },
      refreshOn: (event) => {
        if (params.limit == null || event.type !== 'run:state') return false
        return (
          (params.states != null && !params.states.includes(event.data.state)) ||
          (params.updatedBefore != null && event.data.updatedAt >= params.updatedBefore)
        )
      },
      affected: (event) => (event.type === 'run:state' ? event.data.runID : undefined),
      readAffected: async (runID) => {
        try {
          return await control.runs.get(runID)
        } catch (error) {
          if (!isFlowControlError(error, 'RUN_NOT_FOUND')) throw error
        }
      },
      refreshAfterAffected: (run) => params.limit != null && run == null,
      merge,
      apply: (runs, event) => filterRuns(applyRunEvent(runs, event), params),
    }
  }, [control, filterKey])
  const { data, ...state } = useReconciledQuery(query)
  const runs = [...data.values()]
  return { runs: filter?.limit == null ? runs : runs.slice(0, filter.limit), ...state }
}

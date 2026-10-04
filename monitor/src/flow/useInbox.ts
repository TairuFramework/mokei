import { useInboxQuery } from './useInboxQuery.js'

export function useInbox(filter?: { runID?: string }) {
  const { data, ...state } = useInboxQuery(undefined, filter?.runID)
  return {
    items: [...data.items.values()].sort((a, b) => b.createdAt - a.createdAt),
    settled: data.settled,
    ...state,
  }
}

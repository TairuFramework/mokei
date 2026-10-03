import { useInboxQuery } from './useInboxQuery.js'

export function useInboxItem(itemID: string) {
  const { data, ...state } = useInboxQuery(itemID)
  return { item: data.items.get(itemID), outcome: data.settled.get(itemID), ...state }
}

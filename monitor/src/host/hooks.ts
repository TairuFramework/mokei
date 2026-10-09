import { useHostConnection } from './useHostConnection.js'

export function useHostInfo() {
  return useHostConnection().info
}

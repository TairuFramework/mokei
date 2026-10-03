import { createRemoteFlowControl } from '@mokei/flow-client'

import { createHostClient } from '../host/client.js'

export function createFlowConnection(onRestart: () => void, onFailure: () => void) {
  const observedFetch: typeof fetch = async (input, init) => {
    try {
      const response = await globalThis.fetch(input, init)
      if (response.status === 403) onRestart()
      else if (!response.ok) onFailure()
      return response
    } catch (error) {
      if (!init?.signal?.aborted) onFailure()
      throw error
    }
  }
  const url = import.meta.env.VITE_API_URL || `${window.location.origin}/api`
  const client = createHostClient(url, observedFetch)
  return { client, control: createRemoteFlowControl(client) }
}

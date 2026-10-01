import type { ElicitResult } from '@mokei/context-protocol'

import { createDialogSurface } from './dialog-surface.js'
import type { DesktopElicitOptions } from './elicit-handler.js'
import type { DesktopElicitRequest } from './inbox.js'

export type DesktopInputSurface = {
  canPrompt(request: DesktopElicitRequest): boolean
  prompt(request: DesktopElicitRequest, options?: { signal?: AbortSignal }): Promise<ElicitResult>
  notify(request: DesktopElicitRequest): Promise<void>
  dispose(): Promise<void>
}

export function createDesktopInputSurface(options: DesktopElicitOptions): DesktopInputSurface {
  const surface = createDialogSurface(options)
  return {
    canPrompt: (request) => surface.planSteps(request).ok,
    prompt: (request, options) => {
      const signal =
        options?.signal == null ? request.signal : AbortSignal.any([request.signal, options.signal])
      return surface.showDialogs({ ...request, signal }, 'reject')
    },
    notify: (request) => surface.notifyAdded(request, surface.describeSource(request)),
    dispose: surface.dispose,
  }
}

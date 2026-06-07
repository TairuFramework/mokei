import { type RenderOptions, render } from 'ink'
import { type ComponentType, createElement } from 'react'

export async function runInk<P extends object>(
  Component: ComponentType<P>,
  props: P = {} as P,
  options: RenderOptions = {},
): Promise<void> {
  const app = render(createElement(Component, props), { exitOnCtrlC: false, ...options })
  await app.waitUntilExit()
}

export function renderStatic<P extends object>(
  Component: ComponentType<P>,
  props: P = {} as P,
): void {
  const { unmount } = render(createElement(Component, props))
  unmount()
}

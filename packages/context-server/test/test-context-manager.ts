import { AsyncLocalStorage } from 'node:async_hooks'
import type { Context } from '@opentelemetry/api'
import { context, ROOT_CONTEXT } from '@opentelemetry/api'

export function installTestContextManager(): () => void {
  const storage = new AsyncLocalStorage<Context>()
  // OTel's default context manager does not propagate across await boundaries.
  context.setGlobalContextManager({
    active: () => storage.getStore() ?? ROOT_CONTEXT,
    with: <A extends Array<unknown>, F extends (...args: A) => ReturnType<F>>(
      ctx: Context,
      fn: F,
      thisArg?: ThisParameterType<F>,
      ...args: A
    ): ReturnType<F> => {
      return storage.run(ctx, () => fn.call(thisArg, ...args))
    },
    bind: <T>(_ctx: Context, target: T): T => target,
    enable() {
      return this
    },
    disable() {
      return this
    },
  })
  return () => {
    context.disable()
  }
}

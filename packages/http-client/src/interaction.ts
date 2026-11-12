/**
 * Internal `RequestInit` field saying whether a request may open an interactive sign-in. The
 * transport stamps every request; a fetch middleware that keeps `init` (by spreading it) keeps the
 * tag, and the OAuth middleware reads it with {@link interactionOf}.
 */
export const REQUEST_INTERACTION: unique symbol = Symbol('dev.mokei/request-interaction')

/** `'never'`: the request must not start a sign-in or step-up. `'allowed'`: it may. */
export type RequestInteraction = 'never' | 'allowed'

export type InteractiveRequestInit = RequestInit & { [REQUEST_INTERACTION]?: RequestInteraction }

/** The interaction mode of `init`; untagged requests are `'allowed'`. */
export function interactionOf(init?: RequestInit): RequestInteraction {
  return (init as InteractiveRequestInit | undefined)?.[REQUEST_INTERACTION] ?? 'allowed'
}

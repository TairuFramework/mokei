import { getLogger, type Logger } from '@sozai/log'

export type { Logger }

export function getMokeiLogger(namespace: string, properties?: Record<string, unknown>): Logger {
  return getLogger(['mokei', namespace], properties)
}

import { logStoreDefinition } from '@hozon/store-log'
import { telemetryStoreDefinition } from '@hozon/store-telemetry'
import type { JSONValue } from '@sozai/json'

const ATTRIBUTE_PREFIX = 'mokei-json:'

function encodeString(value: string): string {
  return value.startsWith(ATTRIBUTE_PREFIX) || /^[\s]*[[{]/u.test(value)
    ? `${ATTRIBUTE_PREFIX}${value}`
    : value
}

function decodeString(value: string): string {
  return value.startsWith(ATTRIBUTE_PREFIX) ? value.slice(ATTRIBUTE_PREFIX.length) : value
}

function mapValue(value: JSONValue, mapString: (value: string) => string): JSONValue {
  if (typeof value === 'string') return mapString(value)
  if (Array.isArray(value)) return value.map((entry) => mapValue(entry, mapString))
  if (value != null && typeof value === 'object') return mapProperties(value, mapString)
  return value
}

function mapProperties(
  properties: Record<string, JSONValue>,
  mapString: (value: string) => string,
): Record<string, JSONValue> {
  return Object.fromEntries(
    Object.entries(properties).map(([key, value]) => [key, mapValue(value, mapString)]),
  )
}

// Hozon's JSON result plugin recursively parses JSON-looking strings, including properties.
export const mokeiTelemetryStoreDefinition: typeof telemetryStoreDefinition = {
  ...telemetryStoreDefinition,
  createAPI(db, adapter) {
    const store = telemetryStoreDefinition.createAPI(db, adapter)
    return {
      ...store,
      async addSpans(spans) {
        await store.addSpans(
          spans.map((span) => ({
            ...span,
            attributes: mapProperties(span.attributes, encodeString),
            events: span.events.map((event) => ({
              ...event,
              attributes: mapProperties(event.attributes, encodeString),
            })),
          })),
        )
      },
      async getSpans(traceID) {
        const spans = await store.getSpans(traceID)
        return spans.map((span) => ({
          ...span,
          attributes: mapProperties(span.attributes, decodeString),
          events: span.events.map((event) => ({
            ...event,
            attributes: mapProperties(event.attributes, decodeString),
          })),
        }))
      },
    }
  },
}

export const mokeiLogStoreDefinition: typeof logStoreDefinition = {
  ...logStoreDefinition,
  createAPI(db, adapter) {
    const store = logStoreDefinition.createAPI(db, adapter)
    return {
      ...store,
      async addLogs(logs) {
        await store.addLogs(
          logs.map((log) => ({ ...log, properties: mapProperties(log.properties, encodeString) })),
        )
      },
      async getTraceLogs(traceID) {
        const logs = await store.getTraceLogs(traceID)
        return logs.map((log) => ({
          ...log,
          properties: mapProperties(log.properties, decodeString),
        }))
      },
      async queryLogs(params) {
        const result = await store.queryLogs(params)
        return {
          ...result,
          logs: result.logs.map((log) => ({
            ...log,
            properties: mapProperties(log.properties, decodeString),
          })),
        }
      },
    }
  },
}

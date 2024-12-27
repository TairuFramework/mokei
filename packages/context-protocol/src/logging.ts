import type { FromSchema, Schema } from '@enkaku/schema'

import { notification, request } from './rpc.js'

// https://github.com/modelcontextprotocol/specification/blob/e19c2d5768c6b5f0c7372b9330a66d5a5cc22549/schema/schema.json#L1057
export const loggingLevel = {
  description: `The severity of a log message.
    
    These map to syslog message severities, as specified in RFC-5424:
    https://datatracker.ietf.org/doc/html/rfc5424#section-6.2.1`,
  enum: ['alert', 'critical', 'debug', 'emergency', 'error', 'info', 'notice', 'warning'],
  type: 'string',
} as const satisfies Schema

// https://github.com/modelcontextprotocol/specification/blob/e19c2d5768c6b5f0c7372b9330a66d5a5cc22549/schema/schema.json#L1858
export const setLevelRequest = {
  description: 'A request from the client to the server, to enable or adjust logging.',
  allOf: [
    request,
    {
      properties: {
        method: {
          const: 'logging/setLevel',
          type: 'string',
        },
        params: {
          properties: {
            level: loggingLevel,
          },
          required: ['level'],
          type: 'object',
        },
      },
      required: ['method', 'params'],
      type: 'object',
    },
  ],
} as const satisfies Schema
export type SetLevelRequest = FromSchema<typeof setLevelRequest>

// https://github.com/modelcontextprotocol/specification/blob/e19c2d5768c6b5f0c7372b9330a66d5a5cc22549/schema/schema.json#L1071
export const loggingMessageNotification = {
  description:
    'Notification of a log message passed from server to client. If no logging/setLevel request has been sent from the client, the server MAY decide which messages to send automatically.',
  allOf: [
    notification,
    {
      properties: {
        method: {
          const: 'notifications/message',
          type: 'string',
        },
        params: {
          properties: {
            data: {
              description:
                'The data to be logged, such as a string message or an object. Any JSON serializable type is allowed here.',
            },
            level: loggingLevel,
            logger: {
              description: 'An optional name of the logger issuing this message.',
              type: 'string',
            },
          },
          required: ['data', 'level'],
          type: 'object',
        },
      },
      required: ['method', 'params'],
      type: 'object',
    },
  ],
} as const satisfies Schema
export type LoggingMessageNotification = FromSchema<typeof loggingMessageNotification>

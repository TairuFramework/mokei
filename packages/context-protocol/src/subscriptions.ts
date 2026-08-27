import type { FromSchema, Schema } from '@sozai/schema'

import { notification, request, requestId, result } from './rpc.js'

export const META_SUBSCRIPTION_ID = 'io.modelcontextprotocol/subscriptionId'

export const subscriptionFilter = {
  properties: {
    toolsListChanged: { type: 'boolean' },
    promptsListChanged: { type: 'boolean' },
    resourcesListChanged: { type: 'boolean' },
    resourceSubscriptions: { type: 'array', items: { type: 'string', format: 'uri' } },
  },
  type: 'object',
} as const satisfies Schema
export type SubscriptionFilter = FromSchema<typeof subscriptionFilter>

export const subscriptionsListenRequest = {
  description:
    'Opens a long-lived channel for out-of-band server notifications (2026-07-28). Replaces the GET endpoint and resources/subscribe.',
  allOf: [
    request,
    {
      properties: {
        method: { const: 'subscriptions/listen', type: 'string' },
        params: {
          properties: { notifications: subscriptionFilter },
          required: ['notifications'],
          type: 'object',
        },
      },
      required: ['method', 'params'],
      type: 'object',
    },
  ],
} as const satisfies Schema
export type SubscriptionsListenRequest = FromSchema<typeof subscriptionsListenRequest>

export const subscriptionsAcknowledgedNotification = {
  description:
    'First message on a subscriptions/listen stream; reports the honored notification filter.',
  allOf: [
    notification,
    {
      properties: {
        method: { const: 'notifications/subscriptions/acknowledged', type: 'string' },
        params: {
          properties: { notifications: subscriptionFilter },
          required: ['notifications'],
          type: 'object',
        },
      },
      required: ['method', 'params'],
      type: 'object',
    },
  ],
} as const satisfies Schema
export type SubscriptionsAcknowledgedNotification = FromSchema<
  typeof subscriptionsAcknowledgedNotification
>

// Result _meta placement (differs from the notifications' params._meta).
export const subscriptionMetadata = {
  properties: { [META_SUBSCRIPTION_ID]: requestId },
  required: [META_SUBSCRIPTION_ID],
  type: 'object',
} as const satisfies Schema
export type SubscriptionMetadata = FromSchema<typeof subscriptionMetadata>

export const subscriptionsListenResult = {
  description: 'Terminal response to subscriptions/listen; sent only on graceful teardown.',
  allOf: [
    result,
    {
      properties: {
        _meta: subscriptionMetadata,
      },
      required: ['_meta'],
      type: 'object',
    },
  ],
} as const satisfies Schema
export type SubscriptionsListenResult = FromSchema<typeof subscriptionsListenResult>

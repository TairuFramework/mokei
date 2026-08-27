import { createValidator } from '@sozai/schema'
import { describe, expect, test } from 'vitest'

import {
  META_SUBSCRIPTION_ID,
  subscriptionsAcknowledgedNotification,
  subscriptionsListenRequest,
  subscriptionsListenResult,
} from '../src/subscriptions.js'

describe('subscriptions schemas', () => {
  test('a valid subscriptions/listen request passes', () => {
    const validate = createValidator(subscriptionsListenRequest)
    expect(
      validate({
        jsonrpc: '2.0',
        id: 1,
        method: 'subscriptions/listen',
        params: {
          notifications: { resourcesListChanged: true, resourceSubscriptions: ['file:///a'] },
        },
      }).issues,
    ).toBeUndefined()
  })

  test('the acknowledged notification requires a notifications filter', () => {
    const validate = createValidator(subscriptionsAcknowledgedNotification)
    expect(
      validate({
        jsonrpc: '2.0',
        method: 'notifications/subscriptions/acknowledged',
        params: { notifications: {} },
      }).issues,
    ).toBeUndefined()
    expect(
      validate({ jsonrpc: '2.0', method: 'notifications/subscriptions/acknowledged' }).issues,
    ).toBeDefined()
  })

  test('the terminal result requires the subscriptionId in result _meta and resultType complete', () => {
    const validate = createValidator(subscriptionsListenResult)
    expect(
      validate({ _meta: { [META_SUBSCRIPTION_ID]: 1 }, resultType: 'complete' }).issues,
    ).toBeUndefined()
    expect(validate({ resultType: 'complete' }).issues).toBeDefined()
  })
})

import { createValidator } from '@sozai/schema'
import { expect, expectTypeOf, test } from 'vitest'

import {
  type FlowProcedure,
  monitorAttachParamSchema,
  monitorAttachReceiveSchema,
  monitorPresenceParamSchema,
  monitorPresenceReceiveSchema,
  monitorPresenceSendSchema,
} from '../src/index.js'

const validateSend = createValidator(monitorPresenceSendSchema)
const validateReceive = createValidator(monitorPresenceReceiveSchema)
const validateAttachParam = createValidator(monitorAttachParamSchema)
const validateAttachReceive = createValidator(monitorAttachReceiveSchema)
const validatePresenceParam = createValidator(monitorPresenceParamSchema)

test('validates monitor procedure parameters and attachment response', () => {
  expect(validateAttachParam({ url: 'http://127.0.0.1:1234/' }).issues).toBeUndefined()
  expect(
    validateAttachReceive({ type: 'attached', attachmentID: 'attachment-1' }).issues,
  ).toBeUndefined()
  expect(validatePresenceParam({ attachmentID: 'attachment-1' }).issues).toBeUndefined()
})

test('validates every tab-to-daemon presence message', () => {
  expect(
    validateSend({ type: 'state', visible: true, canNotify: false, activeItemID: 'item-1' }).issues,
  ).toBeUndefined()
  expect(validateSend({ type: 'pong', nonce: 'nonce-1' }).issues).toBeUndefined()
  expect(validateSend({ type: 'ack', attemptID: 'attempt-1', shown: true }).issues).toBeUndefined()
})

test('validates every daemon-to-tab presence message', () => {
  expect(validateReceive({ type: 'ping', nonce: 'nonce-1' }).issues).toBeUndefined()
  expect(
    validateReceive({
      type: 'notify',
      attemptID: 'attempt-1',
      deadline: 1,
      itemID: 'item-1',
      title: 'Title',
      message: 'Message',
    }).issues,
  ).toBeUndefined()
  expect(
    validateReceive({ type: 'prompt', attemptID: 'attempt-1', deadline: 1, itemID: 'item-1' })
      .issues,
  ).toBeUndefined()
  expect(validateReceive({ type: 'withdraw', attemptID: 'attempt-1' }).issues).toBeUndefined()
})

test('rejects missing required and unknown message fields', () => {
  expect(
    validateReceive({
      type: 'notify',
      attemptID: 'attempt-1',
      itemID: 'item-1',
      title: 'Title',
      message: 'Message',
    }).issues,
  ).toBeDefined()
  expect(validateSend({ type: 'state', visible: true }).issues).toBeDefined()
  expect(validateSend({ type: 'unknown' }).issues).toBeDefined()
  expect(validateSend({ type: 'pong', nonce: 'nonce-1', extra: true }).issues).toBeDefined()
})

test('does not classify monitor procedures as flow procedures', () => {
  expectTypeOf<'monitor.attach'>().not.toMatchTypeOf<FlowProcedure>()
})

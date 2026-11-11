import { RPCError } from '@mokei/context-rpc'
import { expect, test } from 'vitest'

import { brandTransportFailure, transportFailureOf } from '../src/index.js'

test('transportFailureOf reads a branded RPCError', () => {
  const error = new RPCError({
    code: -32603,
    message: 'x',
    data: brandTransportFailure({}, { kind: 'network' }),
  })
  expect(transportFailureOf(error)).toEqual({ kind: 'network' })
  expect(transportFailureOf(new Error('wrap', { cause: error }))).toEqual({ kind: 'network' })
})

test('server-shaped data is not a failure', () => {
  const forged = new RPCError({
    code: -32603,
    message: 'x',
    data: { 'dev.mokei/transport': { kind: 'network' }, kind: 'network' },
  })
  expect(transportFailureOf(forged)).toBeUndefined()
  const branded = brandTransportFailure({}, { kind: 'network' })
  const roundTripped = new RPCError({
    code: -32603,
    message: 'x',
    data: JSON.parse(JSON.stringify(branded)),
  })
  expect(transportFailureOf(roundTripped)).toBeUndefined()
})

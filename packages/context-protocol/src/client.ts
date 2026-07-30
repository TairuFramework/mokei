import type { FromSchema, Schema } from '@sozai/schema'

import { elicitResult } from './elicitation.js'
import { listRootsResult } from './root.js'
import { errorResponse, response, result } from './rpc.js'
import { createMessageResult } from './sampling.js'

// The result and response envelopes below are version-invariant: every revision's client
// carries the same result/response shape back to a server-initiated request
// (`sampling/createMessage`, `roots/list`, `elicitation/create`). A revision's own *request*
// and *notification* unions vary by method set and live in `./versions/<revision>.ts` instead
// (e.g. `./versions/2025-11-25.ts`, `./versions/2026-07-28.ts`).

export const clientResult = {
  anyOf: [result, createMessageResult, listRootsResult, elicitResult],
} as const satisfies Schema
export type ClientResult = FromSchema<typeof clientResult>

export const clientResponse = {
  anyOf: [
    errorResponse,
    {
      allOf: [
        response,
        {
          type: 'object',
          properties: { result: clientResult },
          required: ['result'],
        },
      ],
    },
  ],
} as const satisfies Schema
export type ClientResponse = FromSchema<typeof clientResponse>

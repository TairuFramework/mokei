import type { ElicitHandler } from '@mokei/context-client'
import type { HostElicitHandler } from '@mokei/host'
import { expectTypeOf, test } from 'vitest'

import { createDesktopElicitHandler } from '../src/index.js'

test('the desktop handler fits the host and client elicit handler types', () => {
  const h = createDesktopElicitHandler()
  expectTypeOf(h).toMatchTypeOf<HostElicitHandler>()
  expectTypeOf(h).toMatchTypeOf<ElicitHandler>()
  const host: HostElicitHandler = h
  const client: ElicitHandler = h
  expectTypeOf(host).not.toBeAny()
  expectTypeOf(client).not.toBeAny()
})

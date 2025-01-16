import { Flags } from '@oclif/core'

import { DEFAULT_SOCKET_PATH } from './constants.js'

export const socketPathFlag = Flags.string({
  char: 'p',
  description: 'Custom socket path',
  default: DEFAULT_SOCKET_PATH,
})

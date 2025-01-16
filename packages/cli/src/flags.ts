import { DEFAULT_SOCKET_PATH } from '@mokei/host-protocol'
import { Flags } from '@oclif/core'

export const socketPathFlag = Flags.string({
  char: 's',
  description: 'Socket path (optional)',
  default: DEFAULT_SOCKET_PATH,
})

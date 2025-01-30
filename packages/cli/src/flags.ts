import { DEFAULT_SOCKET_PATH } from '@mokei/host-protocol'
import { Flags } from '@oclif/core'

export const modelFlag = Flags.string({
  char: 'm',
  description: 'Name of the model to use',
})

export const providerAPIFlag = Flags.string({
  char: 'p',
  description: 'Provider API URL',
})

export const socketPathFlag = Flags.string({
  char: 's',
  description: 'Socket path',
  default: DEFAULT_SOCKET_PATH,
})

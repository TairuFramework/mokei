import { homedir } from 'node:os'
import { join } from 'node:path'

export const DEFAULT_SOCKET_PATH = join(homedir(), '.mokei-daemon.sock')

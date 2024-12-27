import type { TransportType } from '@enkaku/transport'
import type { ClientMessage, ServerMessage } from '@mokei/context-protocol'

export type ClientTransport = TransportType<ServerMessage, ClientMessage>

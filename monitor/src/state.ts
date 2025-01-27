import type { StreamCall } from '@enkaku/client'
import type { HostEvent } from '@mokei/host-protocol'
import { atom } from 'jotai'

export const hostEventsAtom = atom<Array<HostEvent>>([])

export const hostEventsCallAtom = atom<{ call: StreamCall<HostEvent, void> | null }>({ call: null })

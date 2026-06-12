import { Spinner } from '@inkjs/ui'
import { Box, Text, useApp } from 'ink'
import { type ReactNode, useEffect, useState } from 'react'

import { ProviderSelectCard } from './components/ProviderSelectCard.js'
import { type BuiltChat, buildChat, type ChatOptions } from './providers.js'

// Mutable handle the command holds so it can await session disposal AFTER the
// ink app exits. The session owns a persistent daemon socket that keeps the
// event loop alive; disposing it from the command (not fire-and-forget on
// unmount) is what lets the process actually exit on quit.
export type ChatLifecycle = { dispose: (() => Promise<void>) | null }

export type ChatLauncherProps = {
  initialProvider?: string
  chatOptions: ChatOptions
  lifecycle: ChatLifecycle
}

export function ChatLauncher({ initialProvider, chatOptions, lifecycle }: ChatLauncherProps) {
  const { exit } = useApp()
  const [provider, setProvider] = useState<string | undefined>(initialProvider)
  const [chat, setChat] = useState<BuiltChat | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (provider == null) return

    let cancelled = false
    buildChat(provider, chatOptions).then(
      (built) => {
        if (cancelled) {
          // Quit happened while connecting — dispose the orphaned session.
          void built.dispose()
          return
        }
        lifecycle.dispose = built.dispose
        setChat(built)
      },
      (err) => {
        if (!cancelled) setError((err as Error).message)
      },
    )

    return () => {
      cancelled = true
    }
  }, [provider, chatOptions, lifecycle])

  useEffect(() => {
    if (error != null) {
      process.exitCode = 1
      exit()
    }
  }, [error, exit])

  if (error != null) {
    return (
      <Box paddingX={1}>
        <Text color="red">error: {error}</Text>
      </Box>
    )
  }

  if (provider == null) {
    return <ProviderSelectCard onSelect={setProvider} onCancel={exit} />
  }

  if (chat == null) {
    return (
      <Box paddingX={1}>
        <Spinner label={`connecting to ${provider}…`} />
      </Box>
    )
  }

  return chat.element as ReactNode
}

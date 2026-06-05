import { Spinner } from '@inkjs/ui'
import { Box, Text, useApp } from 'ink'
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'

import { ProviderSelectCard } from './components/ProviderSelectCard.js'
import { type BuiltChat, buildChat, type ChatOptions } from './providers.js'

export type ChatLauncherProps = {
  initialProvider?: string
  chatOptions: ChatOptions
}

export function ChatLauncher({ initialProvider, chatOptions }: ChatLauncherProps) {
  const { exit } = useApp()
  const [provider, setProvider] = useState<string | undefined>(initialProvider)
  const [chat, setChat] = useState<BuiltChat | null>(null)
  const [error, setError] = useState<string | null>(null)
  const disposeRef = useRef<(() => Promise<void>) | null>(null)

  const handleCancel = useCallback(() => {
    exit()
  }, [exit])

  useEffect(() => {
    if (provider == null) return

    let cancelled = false
    buildChat(provider, chatOptions).then(
      (built) => {
        if (cancelled) {
          void built.dispose()
          return
        }
        disposeRef.current = built.dispose
        setChat(built)
      },
      (err) => {
        if (!cancelled) setError((err as Error).message)
      },
    )

    return () => {
      cancelled = true
      void disposeRef.current?.()
    }
  }, [provider, chatOptions])

  if (error != null) {
    return (
      <Box paddingX={1}>
        <Text color="red">error: {error}</Text>
      </Box>
    )
  }

  if (provider == null) {
    return <ProviderSelectCard onSelect={setProvider} onCancel={handleCancel} />
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

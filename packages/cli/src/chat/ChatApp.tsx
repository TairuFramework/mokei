import type { ModelProvider, ProviderTypes } from '@mokei/model-provider'
import type { Session } from '@mokei/session'
import { AgentSession } from '@mokei/session'
import { Box, Static, Text, useApp, useInput } from 'ink'
import { useCallback, useEffect, useRef, useState } from 'react'

import { AssistantMessage } from './components/AssistantMessage.js'
import { ConfirmCard } from './components/ConfirmCard.js'
import { Footer } from './components/Footer.js'
import { HelpCard } from './components/HelpCard.js'
import { IconLine } from './components/IconLine.js'
import { ModelSelectCard } from './components/ModelSelectCard.js'
import { PendingTurn } from './components/PendingTurn.js'
import { SystemNotice } from './components/SystemNotice.js'
import { ToolResultCard } from './components/ToolResultCard.js'
import { ToolSelectCard } from './components/ToolSelectCard.js'
import { UserMessage } from './components/UserMessage.js'
import { type AgentSessionLike, useAgentTurn } from './hooks/useAgentTurn.js'
import { useChatEvents } from './hooks/useChatEvents.js'
import { useSession } from './hooks/useSession.js'
import { type ChatModal, useSlashCommands } from './hooks/useSlashCommands.js'
import { useToolApproval } from './hooks/useToolApproval.js'
import { useTranscript } from './transcript.js'

export type ChatAppProps<T extends ProviderTypes> = {
  session: Session<T>
  provider: ModelProvider<T>
  providerKey: string
  initialModel?: string
  timeout?: number
}

export function ChatApp<T extends ProviderTypes>(props: ChatAppProps<T>) {
  const { session, provider, providerKey, initialModel, timeout } = props
  const { exit } = useApp()
  const [model, setModel] = useState<string | undefined>(initialModel)
  const [modal, setModal] = useState<ChatModal>(null)
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null)
  const [models, setModels] = useState<Array<{ id: string }>>([])
  const modelsPromiseRef = useRef<Promise<Array<{ id: string }>> | null>(null)
  const [quitConfirm, setQuitConfirm] = useState(false)
  const quitConfirmRef = useRef(false)
  const quitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null)

  const { transcript, pushEntry } = useTranscript()

  const loadModels = useCallback(() => {
    if (modelsPromiseRef.current == null) {
      modelsPromiseRef.current = provider.listModels().then((list) => {
        const mapped = list.map((m) => ({ id: m.id }))
        setModels(mapped)
        return mapped
      })
    }
    return modelsPromiseRef.current
  }, [provider])

  useEffect(() => {
    loadModels().catch(() => {
      // Ignore — user will see the error when they attempt to pick a model.
    })
  }, [loadModels])

  const { contexts, addContext, removeContext } = useSession(session)
  const { pending, approve, deny, toolApprovalFn } = useToolApproval()

  const getToolCount = useCallback(
    () => session.getToolsForProvider(provider).length,
    [session, provider],
  )
  const { onEvent, showReasoning, setShowReasoning, getLastReasoning, getLastErrorDetail } =
    useChatEvents<T>({ pushEntry, timeout, getToolCount })

  const createAgent = useCallback((): AgentSessionLike<T> => {
    return new AgentSession<T>({
      session,
      provider: providerKey,
      model: model ?? '',
      toolApproval: toolApprovalFn,
      ...(timeout != null ? { timeout } : {}),
    })
  }, [session, providerKey, model, toolApprovalFn, timeout])

  const turn = useAgentTurn<T>({ createAgent, onEvent })

  useEffect(() => {
    if (pendingPrompt != null && model != null && modal == null) {
      const text = pendingPrompt
      setPendingPrompt(null)
      pushEntry({ kind: 'user', text })
      turn.submit(text)
    }
  }, [pendingPrompt, model, modal, pushEntry, turn])

  // If a turn ends (abort/timeout) while a tool approval is still pending, the
  // approval promise's resolver is orphaned — deny it so useToolApproval clears.
  useEffect(() => {
    if (turn.state === 'idle' && pending != null) {
      deny()
    }
  }, [turn.state, pending, deny])

  const handleSubmit = useSlashCommands({
    model,
    setModel,
    setModal,
    setConfirmRemove,
    setPendingPrompt,
    loadModels,
    pushEntry,
    contexts,
    addContext,
    submit: turn.submit,
    exit,
    showReasoning,
    setShowReasoning,
    getLastReasoning,
    getLastErrorDetail,
  })

  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      if (quitConfirmRef.current) {
        if (quitTimerRef.current) clearTimeout(quitTimerRef.current)
        exit()
        return
      }
      quitConfirmRef.current = true
      setQuitConfirm(true)
      if (quitTimerRef.current) clearTimeout(quitTimerRef.current)
      quitTimerRef.current = setTimeout(() => {
        quitConfirmRef.current = false
        setQuitConfirm(false)
        quitTimerRef.current = null
      }, 3000)
      return
    }
    if (modal != null) return
    if (confirmRemove != null) return
    if (key.escape) {
      if (turn.state === 'calling-tool') {
        pushEntry({ kind: 'notice', variant: 'info', text: 'cancelling tool…' })
        turn.cancelTool()
      } else if (turn.state === 'streaming') {
        pushEntry({ kind: 'notice', variant: 'info', text: 'cancelling…' })
        turn.abort()
      }
    }
  })

  useEffect(
    () => () => {
      if (quitTimerRef.current) clearTimeout(quitTimerRef.current)
    },
    [],
  )

  return (
    <Box flexDirection="column">
      <Static items={transcript}>
        {(entry) => {
          switch (entry.kind) {
            case 'user':
              return <UserMessage key={entry.id} text={entry.text} />
            case 'assistant':
              return <AssistantMessage key={entry.id} text={entry.text} />
            case 'tool':
              return (
                <ToolResultCard
                  key={entry.id}
                  name={entry.name}
                  result={entry.result}
                  error={entry.error}
                  outcome={entry.outcome}
                  durationMs={entry.durationMs}
                />
              )
            case 'notice':
              return <SystemNotice key={entry.id} variant={entry.variant} text={entry.text} />
            case 'reasoning':
              return (
                <IconLine key={entry.id} icon="○" color="magenta" dim>
                  {entry.text}
                </IconLine>
              )
          }
        }}
      </Static>

      <PendingTurn
        turn={turn}
        pending={pending}
        onApprove={approve}
        onDeny={deny}
        showReasoning={showReasoning}
      />

      {modal === 'model' ? (
        <ModelSelectCard
          models={models}
          onSelect={(id) => {
            setModel(id)
            setModal(null)
            pushEntry({ kind: 'notice', variant: 'success', text: `model: ${id}` })
          }}
          onCancel={() => setModal(null)}
        />
      ) : null}

      {modal === 'tools' ? (
        <ToolSelectCard
          groups={Object.entries(session.contextHost.contexts).map(([key, ctx]) => ({
            contextKey: key,
            tools: ctx.tools.map((t) => ({
              id: t.id,
              name: t.tool.name,
              description: t.tool.description,
              enabled: t.enabled,
            })),
          }))}
          onConfirm={(enabled) => {
            for (const [key, ctx] of Object.entries(session.contextHost.contexts)) {
              session.contextHost.setContextTools(
                key,
                ctx.tools.map((t) => ({ ...t, enabled: enabled.includes(t.id) })),
              )
            }
            setModal(null)
          }}
          onCancel={() => setModal(null)}
        />
      ) : null}

      {modal === 'help' ? <HelpCard onClose={() => setModal(null)} /> : null}

      {confirmRemove != null ? (
        <ConfirmCard
          message={`remove context ${confirmRemove}?`}
          onConfirm={async () => {
            const key = confirmRemove
            setConfirmRemove(null)
            try {
              const removed = await removeContext(key)
              pushEntry(
                removed
                  ? { kind: 'notice', variant: 'success', text: `context ${key} removed` }
                  : { kind: 'notice', variant: 'error', text: `context ${key} not found` },
              )
            } catch (err) {
              pushEntry({
                kind: 'notice',
                variant: 'error',
                text: `failed to remove ${key}: ${(err as Error).message}`,
              })
            }
          }}
          onCancel={() => {
            setConfirmRemove(null)
            pushEntry({ kind: 'notice', variant: 'info', text: 'remove cancelled' })
          }}
        />
      ) : null}

      {quitConfirm ? (
        <Box paddingX={1}>
          <Text color="yellow">press Ctrl+C again to quit (or wait to cancel)</Text>
        </Box>
      ) : null}

      <Footer
        model={model ?? '(no model)'}
        state={turn.state}
        contexts={contexts}
        onSubmit={handleSubmit}
        disabled={modal != null || confirmRemove != null || turn.state !== 'idle'}
        defaultValue={pendingPrompt ?? undefined}
      />
    </Box>
  )
}

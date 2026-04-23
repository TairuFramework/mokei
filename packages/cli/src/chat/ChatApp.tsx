import type { ModelProvider, ProviderTypes } from '@mokei/model-provider'
import type { Session } from '@mokei/session'
import { AgentSession } from '@mokei/session'
import { Box, Static, useApp, useInput } from 'ink'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { AssistantMessage } from './components/AssistantMessage.js'
import { Footer } from './components/Footer.js'
import { HelpCard } from './components/HelpCard.js'
import { ModelSelectCard } from './components/ModelSelectCard.js'
import { PendingTurn } from './components/PendingTurn.js'
import { SystemNotice, type SystemNoticeVariant } from './components/SystemNotice.js'
import { ToolResultCard } from './components/ToolResultCard.js'
import { ToolSelectCard } from './components/ToolSelectCard.js'
import { UserMessage } from './components/UserMessage.js'
import { type AgentSessionLike, useAgentTurn } from './hooks/useAgentTurn.js'
import { useSession } from './hooks/useSession.js'
import { useToolApproval } from './hooks/useToolApproval.js'
import { parseSlash } from './slash.js'

type TranscriptEntry =
  | { kind: 'user'; id: number; text: string }
  | { kind: 'assistant'; id: number; text: string }
  | { kind: 'tool'; id: number; name: string; result?: string; error?: string }
  | { kind: 'notice'; id: number; variant: SystemNoticeVariant; text: string }

// Distributive omit preserves the discriminated union (plain `Omit<TranscriptEntry, 'id'>`
// collapses into an intersection that drops variant-specific fields).
type TranscriptEntryInput = TranscriptEntry extends infer E
  ? E extends { id: number }
    ? Omit<E, 'id'>
    : never
  : never

export type ChatAppProps<T extends ProviderTypes> = {
  session: Session<T>
  provider: ModelProvider<T>
  providerKey: string
  initialModel?: string
}

export function ChatApp<T extends ProviderTypes>(props: ChatAppProps<T>) {
  const { session, provider, providerKey, initialModel } = props
  const { exit } = useApp()
  const [model, setModel] = useState<string | undefined>(initialModel)
  const [transcript, setTranscript] = useState<Array<TranscriptEntry>>([])
  const [modal, setModal] = useState<null | 'model' | 'tools' | 'help'>(null)
  const [models, setModels] = useState<Array<{ id: string }>>([])
  const modelsPromiseRef = useRef<Promise<Array<{ id: string }>> | null>(null)

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

  const nextID = useMemo(() => {
    let n = 0
    return () => ++n
  }, [])

  const pushEntry = useCallback(
    (entry: TranscriptEntryInput) =>
      setTranscript((prev) => [...prev, { ...entry, id: nextID() } as TranscriptEntry]),
    [nextID],
  )

  const { contexts, addContext, removeContext } = useSession(session)
  const { pending, approve, deny, toolApprovalFn } = useToolApproval()

  const createAgent = useCallback(
    (): AgentSessionLike<T> =>
      new AgentSession<T>({
        session,
        provider: providerKey,
        model: model ?? '',
        toolApproval: toolApprovalFn,
      }),
    [session, providerKey, model, toolApprovalFn],
  )

  const turn = useAgentTurn<T>({
    createAgent,
    onEvent: (event) => {
      switch (event.type) {
        case 'text-complete':
          if (event.text.length > 0) {
            pushEntry({ kind: 'assistant', text: event.text })
          }
          break
        case 'tool-call-complete': {
          const content = event.result?.content
          const text = Array.isArray(content)
            ? (
                content.find((c: { type: string }) => c.type === 'text') as
                  | { type: 'text'; text: string }
                  | undefined
              )?.text
            : undefined
          pushEntry({ kind: 'tool', name: event.toolCall.name, result: text ?? '' })
          break
        }
        case 'tool-call-error':
          pushEntry({ kind: 'tool', name: event.toolCall.name, error: event.error.message })
          break
        case 'error':
          pushEntry({ kind: 'notice', variant: 'error', text: event.error.message })
          break
        case 'timeout':
          pushEntry({ kind: 'notice', variant: 'warning', text: 'turn timed out' })
          break
        case 'max-iterations':
          pushEntry({
            kind: 'notice',
            variant: 'warning',
            text: 'max iterations reached',
          })
          break
      }
    },
  })

  const handleSubmit = useCallback(
    async (raw: string) => {
      const parsed = parseSlash(raw)
      if (parsed.kind === 'message') {
        if (parsed.text === '') return
        pushEntry({ kind: 'user', text: parsed.text })
        if (model == null) {
          await loadModels()
          setModal('model')
          pushEntry({ kind: 'notice', variant: 'info', text: 'select a model to continue' })
          return
        }
        await turn.submit(parsed.text)
        return
      }

      const { name, args } = parsed
      switch (name) {
        case 'help':
          setModal('help')
          break
        case 'quit':
        case 'exit':
          exit()
          break
        case 'context': {
          const [sub, ...rest] = args
          if (sub == null || sub === 'list') {
            pushEntry({
              kind: 'notice',
              variant: 'info',
              text: contexts.length === 0 ? 'no contexts' : `contexts: ${contexts.join(', ')}`,
            })
          } else if (sub === 'add') {
            const [key, command, ...cmdArgs] = rest
            if (!key || !command) {
              pushEntry({
                kind: 'notice',
                variant: 'error',
                text: 'usage: /context add <key> <cmd> [args...]',
              })
              break
            }
            try {
              await addContext({ key, command, args: cmdArgs })
              pushEntry({
                kind: 'notice',
                variant: 'success',
                text: `context ${key} added`,
              })
            } catch (err) {
              pushEntry({ kind: 'notice', variant: 'error', text: (err as Error).message })
            }
          } else if (sub === 'remove') {
            const [key] = rest
            if (!key) {
              pushEntry({
                kind: 'notice',
                variant: 'error',
                text: 'usage: /context remove <key>',
              })
              break
            }
            removeContext(key)
            pushEntry({ kind: 'notice', variant: 'success', text: `context ${key} removed` })
          } else {
            pushEntry({
              kind: 'notice',
              variant: 'error',
              text: `unknown: /context ${sub}`,
            })
          }
          break
        }
        case 'model': {
          const [id] = args
          const list = await loadModels()
          if (id != null) {
            if (list.some((m) => m.id === id)) {
              setModel(id)
              pushEntry({ kind: 'notice', variant: 'success', text: `model: ${id}` })
            } else {
              pushEntry({ kind: 'notice', variant: 'error', text: `unknown model: ${id}` })
            }
          } else {
            setModal('model')
          }
          break
        }
        case 'tools':
          setModal('tools')
          break
        default:
          pushEntry({ kind: 'notice', variant: 'error', text: `unknown command: /${name}` })
      }
    },
    [addContext, contexts, exit, model, provider, pushEntry, removeContext, turn],
  )

  useInput((_, key) => {
    if (modal != null) return
    if (key.escape && turn.state !== 'idle' && turn.state !== 'awaiting-approval') {
      turn.abort()
    }
  })

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
                />
              )
            case 'notice':
              return <SystemNotice key={entry.id} variant={entry.variant} text={entry.text} />
          }
        }}
      </Static>

      <PendingTurn turn={turn} pending={pending} onApprove={approve} onDeny={deny} />

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

      <Footer
        model={model ?? '(no model)'}
        state={turn.state}
        contexts={contexts}
        onSubmit={handleSubmit}
        disabled={modal != null}
      />
    </Box>
  )
}

import type { ModelProvider, ProviderTypes } from '@mokei/model-provider'
import type { Session } from '@mokei/session'
import { AgentSession } from '@mokei/session'
import { Box, Static, Text, useApp, useInput } from 'ink'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { AssistantMessage } from './components/AssistantMessage.js'
import { ConfirmCard } from './components/ConfirmCard.js'
import { Footer } from './components/Footer.js'
import { HelpCard } from './components/HelpCard.js'
import { IconLine } from './components/IconLine.js'
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
  | {
      kind: 'tool'
      id: number
      name: string
      result?: string
      error?: string
      outcome?: 'error' | 'timeout' | 'cancelled'
      durationMs?: number
    }
  | { kind: 'notice'; id: number; variant: SystemNoticeVariant; text: string }
  | { kind: 'reasoning'; id: number; text: string }

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
  timeout?: number
}

export function ChatApp<T extends ProviderTypes>(props: ChatAppProps<T>) {
  const { session, provider, providerKey, initialModel, timeout } = props
  const { exit } = useApp()
  const [model, setModel] = useState<string | undefined>(initialModel)
  const [transcript, setTranscript] = useState<Array<TranscriptEntry>>([])
  const [modal, setModal] = useState<null | 'model' | 'tools' | 'help'>(null)
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null)
  const [models, setModels] = useState<Array<{ id: string }>>([])
  const modelsPromiseRef = useRef<Promise<Array<{ id: string }>> | null>(null)
  const [quitConfirm, setQuitConfirm] = useState(false)
  const quitConfirmRef = useRef(false)
  const quitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null)
  const [showReasoning, setShowReasoning] = useState(true)
  const toolStartRef = useRef<Map<string, number>>(new Map())
  const lastErrorDetailRef = useRef<string | null>(null)
  // Reasoning accumulated during the current turn, committed to lastReasoningRef
  // when the turn ends so `/reasoning last` can reprint it.
  const reasoningBufRef = useRef<string>('')
  const lastReasoningRef = useRef<string>('')
  // Mirror of showReasoning readable from the (possibly stale) onEvent closure.
  const showReasoningRef = useRef(showReasoning)
  showReasoningRef.current = showReasoning

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

  const createAgent = useCallback((): AgentSessionLike<T> => {
    return new AgentSession<T>({
      session,
      provider: providerKey,
      model: model ?? '',
      toolApproval: toolApprovalFn,
      ...(timeout != null ? { timeout } : {}),
    })
  }, [session, providerKey, model, toolApprovalFn, timeout])

  const turn = useAgentTurn<T>({
    createAgent,
    onEvent: (event) => {
      switch (event.type) {
        case 'start':
          reasoningBufRef.current = ''
          break
        case 'reasoning-delta':
          reasoningBufRef.current += event.reasoning
          break
        case 'reasoning-complete':
          // Persist reasoning into the transcript so it stays visible after the
          // response text, when reasoning display is enabled.
          if (showReasoningRef.current && event.reasoning !== '') {
            pushEntry({ kind: 'reasoning', text: event.reasoning })
          }
          break
        case 'text-complete':
          if (event.text.length > 0) {
            pushEntry({ kind: 'assistant', text: event.text })
          }
          break
        case 'tool-call-start':
          toolStartRef.current.set(event.toolCall.id, event.timestamp)
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
          const startedAt = toolStartRef.current.get(event.toolCall.id)
          toolStartRef.current.delete(event.toolCall.id)
          pushEntry({
            kind: 'tool',
            name: event.toolCall.name,
            result: text ?? '',
            ...(startedAt != null ? { durationMs: event.timestamp - startedAt } : {}),
          })
          break
        }
        case 'tool-call-error': {
          const startedAt = toolStartRef.current.get(event.toolCall.id)
          toolStartRef.current.delete(event.toolCall.id)
          const outcome =
            event.error.name === 'ToolCallTimeoutError'
              ? 'timeout'
              : event.error.name === 'ToolCallCancelledError'
                ? 'cancelled'
                : 'error'
          lastErrorDetailRef.current = event.error.stack ?? event.error.message
          pushEntry({
            kind: 'tool',
            name: event.toolCall.name,
            error: event.error.message,
            outcome,
            ...(startedAt != null ? { durationMs: event.timestamp - startedAt } : {}),
          })
          if (outcome === 'cancelled') {
            pushEntry({
              kind: 'notice',
              variant: 'warning',
              text: `tool cancelled: ${event.toolCall.name}`,
            })
          }
          break
        }
        case 'tool-call-denied':
          pushEntry({
            kind: 'notice',
            variant: 'warning',
            text: `tool denied: ${event.toolCall.name}${event.reason ? ` — ${event.reason}` : ''}`,
          })
          break
        case 'error': {
          const err = event.error
          lastReasoningRef.current = reasoningBufRef.current
          lastErrorDetailRef.current = err.stack ?? err.message
          const cause =
            err.cause instanceof Error ? ` (cause: ${err.cause.name}: ${err.cause.message})` : ''
          pushEntry({
            kind: 'notice',
            variant: 'error',
            text: `${err.name}: ${err.message}${cause}`,
          })
          break
        }
        case 'timeout': {
          const secs = timeout != null ? Math.round(timeout / 1000) : null
          pushEntry({
            kind: 'notice',
            variant: 'warning',
            text:
              secs != null
                ? `turn timed out after ${secs}s — pass --timeout to adjust`
                : 'turn timed out — pass --timeout to adjust',
          })
          lastReasoningRef.current = reasoningBufRef.current
          break
        }
        case 'max-iterations':
          lastReasoningRef.current = reasoningBufRef.current
          pushEntry({
            kind: 'notice',
            variant: 'warning',
            text: 'max iterations reached',
          })
          break
        case 'complete':
          lastReasoningRef.current = reasoningBufRef.current
          if (event.result.text === '' && event.result.toolCalls.length === 0) {
            const toolCount = session.getToolsForProvider(provider).length
            const hint =
              toolCount === 0
                ? ' — no tools are enabled for the model to call (add a context and enable its tools with /tools)'
                : ` — ${toolCount} tool(s) available, but the model produced no text or tool call`
            pushEntry({
              kind: 'notice',
              variant: 'warning',
              text: `stream ended with no output (finish: ${event.result.finishReason})${hint}`,
            })
          }
          break
      }
    },
  })

  useEffect(() => {
    if (pendingPrompt != null && model != null && modal == null) {
      const text = pendingPrompt
      setPendingPrompt(null)
      pushEntry({ kind: 'user', text })
      turn.submit(text)
    }
  }, [pendingPrompt, model, modal, pushEntry, turn])

  const handleSubmit = useCallback(
    async (raw: string) => {
      const parsed = parseSlash(raw)
      if (parsed.kind === 'message') {
        if (parsed.text === '') return
        if (model == null) {
          setPendingPrompt(parsed.text)
          await loadModels()
          setModal('model')
          pushEntry({ kind: 'notice', variant: 'info', text: 'select a model to continue' })
          return
        }
        pushEntry({ kind: 'user', text: parsed.text })
        setPendingPrompt(null)
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
              pushEntry({ kind: 'notice', variant: 'error', text: 'usage: /context remove <key>' })
              break
            }
            if (!contexts.includes(key)) {
              pushEntry({ kind: 'notice', variant: 'error', text: `unknown context: ${key}` })
              break
            }
            setConfirmRemove(key)
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
        case 'details':
          if (lastErrorDetailRef.current == null) {
            pushEntry({ kind: 'notice', variant: 'info', text: 'no recent error details' })
          } else {
            pushEntry({ kind: 'notice', variant: 'info', text: lastErrorDetailRef.current })
          }
          break
        case 'reasoning': {
          const [arg] = args
          if (arg === 'last') {
            pushEntry({
              kind: 'notice',
              variant: 'info',
              text:
                lastReasoningRef.current === ''
                  ? 'no reasoning recorded for the last turn'
                  : lastReasoningRef.current,
            })
            break
          }
          const next = arg === 'on' ? true : arg === 'off' ? false : !showReasoning
          setShowReasoning(next)
          pushEntry({
            kind: 'notice',
            variant: 'info',
            text: `reasoning display: ${next ? 'on' : 'off'}`,
          })
          break
        }
        default:
          pushEntry({ kind: 'notice', variant: 'error', text: `unknown command: /${name}` })
      }
    },
    [
      addContext,
      confirmRemove,
      contexts,
      exit,
      model,
      provider,
      pushEntry,
      removeContext,
      showReasoning,
      turn,
    ],
  )

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

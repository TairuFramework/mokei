import type { Session } from '@mokei/session'
import { useCallback } from 'react'

import { parseSlash } from '../slash.js'
import type { PushEntry } from '../transcript.js'

export type ChatModal = null | 'model' | 'tools' | 'help'

export type UseSlashCommandsParams = {
  model: string | undefined
  setModel: (id: string) => void
  setModal: (modal: ChatModal) => void
  setConfirmRemove: (key: string | null) => void
  setPendingPrompt: (text: string | null) => void
  loadModels: () => Promise<Array<{ id: string }>>
  pushEntry: PushEntry
  contexts: Array<string>
  addContext: (params: Parameters<Session['addContext']>[0]) => ReturnType<Session['addContext']>
  submit: (text: string) => Promise<void>
  exit: () => void
  showReasoning: boolean
  setShowReasoning: (next: boolean) => void
  getLastReasoning: () => string
  getLastErrorDetail: () => string | null
}

// Parses input and dispatches slash commands, leaving the actual UI state
// (modals, transcript, the turn) to the callbacks ChatApp wires in.
export function useSlashCommands(params: UseSlashCommandsParams): (raw: string) => Promise<void> {
  const {
    model,
    setModel,
    setModal,
    setConfirmRemove,
    setPendingPrompt,
    loadModels,
    pushEntry,
    contexts,
    addContext,
    submit,
    exit,
    showReasoning,
    setShowReasoning,
    getLastReasoning,
    getLastErrorDetail,
  } = params

  return useCallback(
    async (raw: string) => {
      const parsed = parseSlash(raw)
      if (parsed.kind === 'message') {
        if (parsed.text === '') return
        if (model == null) {
          setPendingPrompt(parsed.text)
          try {
            await loadModels()
          } catch (err) {
            setPendingPrompt(null)
            pushEntry({
              kind: 'notice',
              variant: 'error',
              text: `failed to list models: ${(err as Error).message} — check the endpoint/API key, then retry`,
            })
            return
          }
          setModal('model')
          pushEntry({ kind: 'notice', variant: 'info', text: 'select a model to continue' })
          return
        }
        pushEntry({ kind: 'user', text: parsed.text })
        setPendingPrompt(null)
        await submit(parsed.text)
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
              const tools = await addContext({ key, command, args: cmdArgs })
              pushEntry({
                kind: 'notice',
                variant: 'success',
                text: `context ${key} added (${tools.length} tool(s) enabled — deselect any below)`,
              })
              if (tools.length > 0) {
                setModal('tools')
              }
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
          let list: Array<{ id: string }>
          try {
            list = await loadModels()
          } catch (err) {
            pushEntry({
              kind: 'notice',
              variant: 'error',
              text: `failed to list models: ${(err as Error).message} — check the endpoint/API key, then retry`,
            })
            break
          }
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
        case 'details': {
          const detail = getLastErrorDetail()
          pushEntry({
            kind: 'notice',
            variant: 'info',
            text: detail == null ? 'no recent error details' : detail,
          })
          break
        }
        case 'reasoning': {
          const [arg] = args
          if (arg === 'last') {
            const last = getLastReasoning()
            pushEntry({
              kind: 'notice',
              variant: 'info',
              text: last === '' ? 'no reasoning recorded for the last turn' : last,
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
      model,
      setModel,
      setModal,
      setConfirmRemove,
      setPendingPrompt,
      loadModels,
      pushEntry,
      contexts,
      addContext,
      submit,
      exit,
      showReasoning,
      setShowReasoning,
      getLastReasoning,
      getLastErrorDetail,
    ],
  )
}

import { Writable } from 'node:stream'
import { Disposer } from '@enkaku/async'
import { createReadable } from '@enkaku/stream'
import { type ContextHost, getContextToolInfo } from '@mokei/host'
import { tryParseJSON } from '@mokei/model-provider'
import type {
  AggregatedMessage,
  ClientToolMessage,
  FunctionToolCall,
  Message,
  ModelProvider,
  ProviderTypes,
  ServerMessage,
} from '@mokei/model-provider'
import ora, { type Ora } from 'ora'

import { type Choice, confirm, input, list, prompt } from './prompt.js'

const SESSION_ACTIONS = {
  'session.dispose': 'End the session',
  'user.prompt.text': 'Send a message',
  'user.context.add': 'Add a context',
  'user.context.remove': 'Remove a context',
  'user.tools.select': 'Select tools to enable',
} as const

type SessionAction = keyof typeof SESSION_ACTIONS | 'user.action.select'

const SESSION_ACTION_KEY = Object.entries(SESSION_ACTIONS).reduce(
  (acc, [key, name]) => {
    acc[name] = key as SessionAction
    return acc
  },
  {} as Record<string, SessionAction>,
)

type RequestState = { type: 'idle' } | { type: 'streaming'; abort: () => void }

export type ChatSessionParams<T extends ProviderTypes> = {
  host: ContextHost
  model?: string
  provider: ModelProvider<T>
}

export class ChatSession<T extends ProviderTypes> extends Disposer {
  #controller: ReadableStreamDefaultController<SessionAction>
  #host: ContextHost
  #loader: Ora
  #messages: Array<Message<T['Message'], T['ToolCall']>> = []
  #model?: string
  #provider: ModelProvider<T>
  #requestState: RequestState = { type: 'idle' }
  #stream: ReadableStream<SessionAction>
  #writer: WritableStreamDefaultWriter<string>

  constructor(params: ChatSessionParams<T>) {
    const [stream, controller] = createReadable<SessionAction>()
    super({
      dispose: async () => {
        controller.close()
        await this.#host.dispose()
      },
    })
    this.#controller = controller
    this.#host = params.host
    this.#loader = ora()
    this.#model = params.model
    this.#provider = params.provider
    this.#stream = stream
    this.#writer = Writable.toWeb(process.stdout).getWriter()

    process.on('SIGINT', () => {
      if (this.#requestState.type === 'streaming') {
        this.#requestState.abort()
      }
    })

    this.#next()
  }

  dispose(): Promise<void> {
    this.#next('session.dispose')
    return this.disposed
  }

  #next(action?: SessionAction | null): void {
    this.#controller.enqueue(action ?? 'user.action.select')
  }

  async #promptModel(): Promise<string> {
    const models = await this.#provider.listModels()
    while (true) {
      const result = await prompt<{ model: string }>({
        type: 'select',
        name: 'model',
        message: 'Select a model',
        choices: models.map((m) => m.id),
      })
      if (result != null) {
        return result.model
      }
    }
  }

  async #addContext(): Promise<null> {
    const config = await prompt<{ key: string; command: string }>([
      { type: 'input', name: 'key', message: 'Context key (unique per session)' },
      { type: 'input', name: 'command', message: 'MCP server command' },
    ])
    if (config == null) {
      return null
    }

    const args = await list('MCP server arguments (comma separated)')
    if (args == null) {
      return null
    }

    this.#loader.start('Adding context...')
    try {
      await this.#host.spawn({ ...config, args })
      const tools = await this.#host.setup(config.key)
      this.#loader.succeed(`Context ${config.key} successfully added`)
      if (tools.length !== 0) {
        const selected = await prompt<{ enabledTools: Array<string> }>({
          type: 'select',
          // @ts-ignore
          multiple: true,
          name: 'enabledTools',
          message: `Select tools to enable for context ${config.key}`,
          choices: tools.map((ct) => ({
            name: ct.id,
            message: `${ct.tool.name}: ${ct.tool.description}`,
          })),
          initial: tools.map((ct) => ct.id),
        })
        if (selected != null && selected.enabledTools.length !== tools.length) {
          const contextTools = tools.map((t) => ({
            ...t,
            enabled: selected.enabledTools.includes(t.id),
          }))
          this.#host.setContextTools(config.key, contextTools)
        }
      }
    } catch (error) {
      this.#loader.fail((error as Error).message)
    }

    return null
  }

  async #selectTools(): Promise<null> {
    const entries = Object.entries(this.#host.contexts)
    const allChoices: Array<Choice> = []
    for (const [key, ctx] of entries) {
      if (ctx.tools.length === 0) {
        continue
      }
      const choices = ctx.tools.map((ct) => ({
        name: ct.id,
        message: `${ct.tool.name}: ${ct.tool.description}`,
        enabled: ct.enabled,
      }))
      allChoices.push({ name: key, choices })
    }
    if (allChoices.length === entries.length) {
      this.#loader.warn('No tools found')
      return null
    }

    const result = await prompt<{ enabledTools: Array<string> }>({
      type: 'multiselect',
      name: 'enabledTools',
      message: 'Select tools to enable',
      choices: allChoices,
    })
    if (result?.enabledTools != null) {
      for (const [key, ctx] of entries) {
        const tools = ctx.tools.map((t) => {
          return { ...t, enabled: result.enabledTools.includes(t.id) }
        })
        this.#host.setContextTools(key, tools)
      }
    }
    return null
  }

  async #runChat(model: string): Promise<SessionAction | null> {
    const tools = this.#host.getEnabledTools().map((ct) => {
      return this.#provider.toolFromMCP({ ...ct.tool, name: ct.id })
    })

    while (true) {
      try {
        const messageStream = this.#provider.streamChat({ messages: this.#messages, model, tools })
        const parts: Array<ServerMessage<T['MessagePart'], T['ToolCall']>> = []

        this.#loader.start('Generating...')
        this.#requestState = { type: 'streaming', abort: () => messageStream.abort() }

        for await (const part of await messageStream) {
          if (part.type === 'done') {
            break
          }
          switch (part.type) {
            case 'error': {
              await this.#writer.write('\n')
              this.#loader.warn(String(part.error))
              this.#requestState = { type: 'idle' }
              return 'user.prompt.text'
            }
            case 'tool-call':
              if (this.#loader.isSpinning) {
                this.#loader.stop()
              }
              parts.push({ ...part, source: 'server', role: 'assistant' })
              break
            case 'text-delta':
              if (this.#loader.isSpinning) {
                this.#loader.stop()
                await this.#writer.write('🤖')
              }
              parts.push({ ...part, source: 'server', role: 'assistant' })
              await this.#writer.write(part.text)
              break
          }
        }

        this.#requestState = { type: 'idle' }
        const aggregatedMessage: AggregatedMessage<T['ToolCall']> =
          this.#provider.aggregateMessage(parts)

        if (aggregatedMessage.toolCalls.length === 0) {
          await this.#writer.write('\n')
          this.#loader.succeed('Generation completed')
          this.#messages.push(aggregatedMessage)
          return 'user.prompt.text'
        }

        const toolMessages = await this.#runTools(aggregatedMessage.toolCalls)
        this.#messages.push(aggregatedMessage, ...toolMessages)
      } catch (reason) {
        if (reason instanceof Error && reason.name === 'AbortError') {
          await this.#writer.write('\n')
          this.#loader.warn('Generation cancelled')
          this.#requestState = { type: 'idle' }
          return 'user.prompt.text'
        }
        throw reason
      }
    }
  }

  async #runTools(
    toolCalls: Array<FunctionToolCall<T['ToolCall']>>,
  ): Promise<Array<ClientToolMessage>> {
    const messages: Array<ClientToolMessage> = []

    for (const toolCall of toolCalls) {
      const [context, name] = getContextToolInfo(toolCall.name)
      let text: string
      const ok = await confirm(
        `Allow call of tool ${name} in context ${context} with arguments ${toolCall.input}?`,
      )
      if (ok) {
        this.#loader.info('Tool call accepted').start('Calling tool...')
        try {
          const result = await this.#host.callTool(context, name, tryParseJSON(toolCall.input))
          const resultContent =
            result.content.find((c) => c.type === 'text')?.text ?? 'No text content'
          if (result.isError) {
            this.#loader.warn(`Tool call failed: ${resultContent}`)
            text = JSON.stringify({ error: resultContent })
          } else {
            this.#loader.succeed(`Tool call successful, result: ${resultContent}`)
            text = resultContent
          }
        } catch (reason) {
          const error = (reason as Error).message ?? reason
          this.#loader.warn(`Tool call failed: ${error}`)
          text = JSON.stringify({ error })
        }
      } else {
        this.#loader.warn('Tool call denied')
        text = JSON.stringify({ error: 'Call denied by user' })
      }
      messages.push({
        source: 'client',
        role: 'tool',
        toolCallID: toolCall.id,
        toolCallName: toolCall.name,
        text,
      })
    }

    return messages
  }

  async run(): Promise<void> {
    for await (const action of this.#stream) {
      let nextAction: SessionAction | null | undefined
      switch (action) {
        case 'user.action.select': {
          const selected = await prompt<{ choice: SessionAction }>({
            type: 'select',
            name: 'choice',
            message: 'Select an action',
            choices: Object.values(SESSION_ACTIONS),
          })
          nextAction =
            (selected?.choice && SESSION_ACTION_KEY[selected.choice]) ?? 'session.dispose'
          break
        }
        case 'user.context.add':
          await this.#addContext()
          break
        case 'user.context.remove': {
          const contexts = this.#host.getContextKeys()
          if (contexts.length === 0) {
            this.#loader.warn('No contexts to remove')
          } else {
            let key: string | null = null
            if (contexts.length === 1) {
              const selectedKey = contexts[0]
              const confirmed = await confirm(`Remove context ${selectedKey}?`)
              if (confirmed) {
                key = selectedKey
              }
            } else {
              const selected = await prompt<{ key: string }>({
                type: 'select',
                name: 'key',
                message: 'Select a context to remove',
                choices: contexts,
              })
              key = selected?.key ?? null
            }
            if (key != null) {
              this.#loader.start('Removing context...')
              await this.#host.remove(key)
              this.#loader.succeed('Context removed')
            }
          }
          break
        }
        case 'user.prompt.text': {
          this.#model ??= await this.#promptModel()
          const text = await input('Your message')
          if (text == null || text.trim() === '') {
            break
          }
          this.#messages.push({ source: 'client', role: 'user', text })
          nextAction = await this.#runChat(this.#model)
          break
        }
        case 'user.tools.select':
          nextAction = await this.#selectTools()
          break
        case 'session.dispose':
          this.abort('Dipose')
          return this.disposed
      }

      this.#next(nextAction)
    }

    return await this.disposed
  }
}

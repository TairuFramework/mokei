import { Writable } from 'node:stream'
import { createReadable } from '@enkaku/stream'
import { type Disposer, createDisposer } from '@enkaku/util'
import { ContextHost, type ContextTool, getContextToolInfo } from '@mokei/host-server'
import ora, { type Ora } from 'ora'

import { type Message, type Tool as OllamaTool, ollama } from './clients/ollama.js'

import { getModel } from './ollama.js'
import { type Choice, confirm, input, list, prompt } from './prompt.js'

function toOllamaTool({ id, tool }: ContextTool): OllamaTool {
  return {
    type: 'function',
    function: {
      name: id,
      description: tool.description ?? '',
      parameters: tool.inputSchema,
    },
  } as OllamaTool
}

type ChatToolCallRequest = {
  function: {
    name: string
    arguments: Record<string, unknown>
  }
}

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

export type ChatSessionParams = {
  model?: string
}

export class ChatSession {
  #controller: ReadableStreamDefaultController<SessionAction>
  #disposer: Disposer
  #host: ContextHost
  #loader: Ora
  #messages: Array<Message> = []
  #model?: string
  #requestState: RequestState = { type: 'idle' }
  #stream: ReadableStream<SessionAction>
  #writer: WritableStreamDefaultWriter<string>

  constructor(params: ChatSessionParams = {}) {
    const [stream, controller] = createReadable<SessionAction>()
    this.#controller = controller
    this.#disposer = createDisposer(async () => {
      controller.close()
      await this.#host.dispose()
    })
    this.#host = new ContextHost()
    this.#loader = ora()
    this.#model = params.model
    this.#stream = stream
    this.#writer = Writable.toWeb(process.stdout).getWriter()

    process.on('SIGINT', () => {
      if (this.#requestState.type === 'streaming') {
        this.#requestState.abort()
      }
    })

    this.#next()
  }

  get disposed(): Promise<void> {
    return this.#disposer.disposed
  }

  dispose(): Promise<void> {
    this.#next('session.dispose')
    return this.#disposer.disposed
  }

  #next(action?: SessionAction | null): void {
    this.#controller.enqueue(action ?? 'user.action.select')
  }

  async #addContext(): Promise<null> {
    const config = await prompt<{ key: string; file: string }>([
      { type: 'input', name: 'key', message: 'Context key (unique per session)' },
      { type: 'input', name: 'file', message: 'MCP server command' },
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
      await this.#host.spawn(config.key, config.file, args)
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
    const tools = this.#host.getEnabledTools().map(toOllamaTool)

    while (true) {
      try {
        const messageStream = ollama.chat({ messages: this.#messages, model, stream: true, tools })
        const toolCalls: Array<ChatToolCallRequest> = []
        let content = ''

        this.#loader.start('Generating...')
        this.#requestState = { type: 'streaming', abort: () => messageStream.abort() }

        for await (const part of await messageStream) {
          if (part.message.tool_calls) {
            if (this.#loader.isSpinning) {
              this.#loader.stop()
            }
            toolCalls.push(...part.message.tool_calls)
          } else {
            if (this.#loader.isSpinning) {
              this.#loader.stop()
              await this.#writer.write('🤖')
            }
            content += part.message.content
            await this.#writer.write(part.message.content)
          }
        }
        this.#requestState = { type: 'idle' }

        if (toolCalls.length === 0) {
          await this.#writer.write('\n')
          this.#loader.succeed('Generation completed')
          this.#messages.push({ role: 'assistant', content })
          return 'user.prompt.text'
        }

        const toolMessages = await this.#runTools(toolCalls)
        this.#messages.push(
          { role: 'assistant', content: '', tool_calls: toolCalls },
          ...toolMessages,
        )
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

  async #runTools(toolCalls: Array<ChatToolCallRequest>): Promise<Array<Message>> {
    const messages: Array<Message> = []

    for (const toolCall of toolCalls) {
      const [context, name] = getContextToolInfo(toolCall.function.name)
      let content: string
      const ok = await confirm(
        `Allow call of tool ${name} in context ${context} with arguments ${JSON.stringify(toolCall.function.arguments)}?`,
      )
      if (ok) {
        this.#loader.info('Tool call accepted').start('Calling tool...')
        try {
          const result = await this.#host.callTool(context, name, toolCall.function.arguments)
          const resultContent =
            result.content.find((c) => c.type === 'text')?.text ?? 'No text content'
          if (result.isError) {
            this.#loader.warn(`Tool call failed: ${resultContent}`)
            content = JSON.stringify({ error: resultContent })
          } else {
            this.#loader.succeed(`Tool call successful, result: ${resultContent}`)
            content = resultContent
          }
        } catch (reason) {
          const error = (reason as Error).message ?? reason
          this.#loader.warn(`Tool call failed: ${error}`)
          content = JSON.stringify({ error })
        }
      } else {
        this.#loader.warn('Tool call denied')
        content = JSON.stringify({ error: 'Call denied by user' })
      }
      messages.push({ role: 'tool', content })
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
          this.#model ??= await getModel()
          const content = await input('Your message')
          if (content == null || content.trim() === '') {
            break
          }
          this.#messages.push({ role: 'user', content })
          nextAction = await this.#runChat(this.#model)
          break
        }
        case 'user.tools.select':
          nextAction = await this.#selectTools()
          break
        case 'session.dispose':
          return await this.#disposer.dispose()
      }

      this.#next(nextAction)
    }

    return await this.#disposer.disposed
  }
}

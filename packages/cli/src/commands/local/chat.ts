import { Writable } from 'node:stream'
import { setTimeout } from 'node:timers/promises'
import { input } from '@inquirer/prompts'
import { Command } from '@oclif/core'
import ollama, { type ChatResponse, type Message } from 'ollama'
import ora from 'ora'

import { getModel, modelFlag } from '../../local.js'

type ChatResponseStream = {
  abort: () => void
  [Symbol.asyncIterator](): AsyncGenerator<ChatResponse, void, unknown>
}

type UserPromptState = {
  type: 'user.prompt'
  messages: Array<Message>
}

type AssistantLoadingState = {
  type: 'assistant.loading'
  messages: Array<Message>
  promise: Promise<ChatResponseStream>
  cancelled: boolean
}

type AssistantStreamingState = {
  type: 'assistant.streaming'
  messages: Array<Message>
  stream: ChatResponseStream
  content: string
}

type ChatState = UserPromptState | AssistantLoadingState | AssistantStreamingState

export default class LocalChat extends Command {
  static description = 'Interactive chat with a local model'

  static flags = {
    model: modelFlag,
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(LocalChat)
    const model = await getModel(flags)

    const loader = ora()
    const writer = Writable.toWeb(process.stdout).getWriter()
    let state: ChatState = { type: 'user.prompt', messages: [] }

    process.on('SIGINT', () => {
      switch (state.type) {
        case 'assistant.loading':
          loader.stop()
          state.cancelled = true
          break
        case 'assistant.streaming':
          state.stream.abort()
          break
      }
    })

    while (true) {
      switch (state.type) {
        case 'user.prompt':
          try {
            const content = await input({ message: 'Your message:' })
            loader.start('Generating...')
            const messages: Array<Message> = [...state.messages, { role: 'user', content }]
            state = {
              type: 'assistant.loading',
              messages,
              promise: ollama.chat({ messages, model, stream: true }),
              cancelled: false,
            }
          } catch (error) {
            if (error instanceof Error && error.name === 'ExitPromptError') {
              process.exit()
            } else {
              throw error
            }
          }
          break
        case 'assistant.loading': {
          const stream: ChatResponseStream = await state.promise
          if (state.cancelled) {
            state = { type: 'user.prompt', messages: state.messages }
          } else {
            state = {
              type: 'assistant.streaming',
              messages: state.messages,
              stream,
              content: '',
            }
          }
          break
        }
        case 'assistant.streaming': {
          try {
            for await (const part of state.stream) {
              if (loader.isSpinning) {
                loader.stop()
                await writer.write('🤖')
              }
              state.content += part.message.content
              await writer.write(part.message.content)
            }

            await writer.write('\n')
            loader.succeed('Generation completed')
            state = {
              type: 'user.prompt',
              messages: [...state.messages, { role: 'assistant', content: state.content }],
            }
          } catch (error) {
            if ((error as Error).name === 'AbortError') {
              await writer.write('\n')
              loader.warn('Generation cancelled')
              await setTimeout(100)
              state = { type: 'user.prompt', messages: state.messages }
            } else {
              throw error
            }
          }
          break
        }
      }
    }
  }
}

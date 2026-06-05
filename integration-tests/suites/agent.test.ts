import { OllamaProvider, type OllamaTypes } from '@mokei/ollama-provider'
import { type AgentEvent, AgentSession, Session } from '@mokei/session'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

const FETCH_MCP_SERVER_PATH = '../mcp-servers/fetch/lib/serve.js'

const model = 'lfm2.5:latest'
const provider = new OllamaProvider()

describe('AgentSession', () => {
  const session = new Session<OllamaTypes>({ providers: { ollama: provider } })

  beforeAll(async () => {
    await session.addContext({
      key: 'fetch',
      command: 'node',
      args: [FETCH_MCP_SERVER_PATH],
    })
  })

  afterAll(async () => {
    await session.dispose()
  })

  test('runs the agent loop end-to-end and executes the fetch tool', async () => {
    const agent = new AgentSession({ session, provider: 'ollama', model })

    const events: Array<AgentEvent<OllamaTypes>> = []
    for await (const event of agent.stream(
      'Provide a short summary of what https://mokei.dev does',
    )) {
      events.push(event)
    }

    const types = events.map((e) => e.type)
    // Tool-call lifecycle surfaces through the stream.
    expect(types).toContain('tool-call-start')
    expect(types).toContain('tool-call-complete')
    expect(types).toContain('complete')

    const complete = events.find((e) => e.type === 'complete')
    if (complete?.type !== 'complete') throw new Error('missing complete event')
    const result = complete.result

    expect(result.finishReason).toBe('complete')
    // At least one model call to request the tool, another to answer with it.
    expect(result.iterations).toBeGreaterThanOrEqual(2)
    expect(result.text).not.toBe('')

    const fetchRecord = result.toolCalls.find((r) => r.call.name === 'fetch:get_markdown')
    expect(fetchRecord).toBeDefined()
    expect(fetchRecord?.call.arguments).toContain('https://mokei.dev')
    expect(fetchRecord?.error).toBeUndefined()
    expect(fetchRecord?.result).toMatchObject({
      content: [{ type: 'text', text: expect.stringContaining('Mokei') }],
      isError: false,
    })
  }, 90_000)

  test('turn timeout interrupts a turn instead of hanging', async () => {
    // Tiny turn budget: the model cannot finish in time, so the turn must
    // abort the in-flight (possibly stalled) provider read and emit a timeout
    // rather than blocking until generation ends on its own. Regression guard
    // for the parked-stream hang — if it regressed, this would block until the
    // suite timeout instead of resolving promptly.
    const agent = new AgentSession({ session, provider: 'ollama', model, timeout: 250 })

    const events: Array<AgentEvent<OllamaTypes>> = []
    try {
      for await (const event of agent.stream(
        'Provide a short summary of what https://mokei.dev does',
      )) {
        events.push(event)
      }
    } catch {
      // The agent rethrows the abort after emitting the timeout event.
    }

    const types = events.map((e) => e.type)
    expect(types).toContain('timeout')
    expect(types).not.toContain('complete')
  }, 30_000)
})

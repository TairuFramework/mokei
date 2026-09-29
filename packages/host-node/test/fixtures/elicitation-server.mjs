import { createInterface } from 'node:readline'

const elicitationParams = {
  message: 'Please provide a value',
  requestedSchema: { type: 'object', properties: { answer: { type: 'string' } } },
}

let elicitationCapability = false
let nextID = 1
const pending = new Map()

async function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

const input = createInterface({ input: process.stdin })
input.on('line', (line) => {
  const message = JSON.parse(line)

  if (pending.has(message.id)) {
    pending.get(message.id)(message)
    pending.delete(message.id)
    return
  }

  if (message.method === 'initialize') {
    elicitationCapability = message.params.capabilities?.elicitation != null
    void send({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        protocolVersion: '2025-11-25',
        capabilities: { tools: {} },
        serverInfo: { name: 'elicitation-fixture', version: '1.0.0' },
      },
    })
  } else if (message.method === 'notifications/initialized') {
    // Notifications do not receive a response.
  } else if (message.method === 'tools/list') {
    void send({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        tools: [
          {
            name: 'ask',
            description: 'Ask the client for input',
            inputSchema: { type: 'object', properties: {} },
          },
        ],
      },
    })
  } else if (message.method === 'tools/call') {
    const requestID = `elicitation-${nextID++}`
    pending.set(requestID, async (elicitationResponse) => {
      const response = elicitationResponse.result ?? { error: elicitationResponse.error }
      await send({
        jsonrpc: '2.0',
        id: message.id,
        result: {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ elicitationCapability, response }),
            },
          ],
        },
      })
    })
    void send({
      jsonrpc: '2.0',
      id: requestID,
      method: 'elicitation/create',
      params: elicitationParams,
    })
  }
})

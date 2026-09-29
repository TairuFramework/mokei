let capabilities

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

function handle(message) {
  if (message.method === 'initialize') {
    capabilities = message.params.capabilities
    send({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        protocolVersion: '2025-11-25',
        capabilities: { tools: {} },
        serverInfo: { name: 'elicitation-fixture', version: '1.0.0' },
      },
    })
    return
  }
  if (message.method === 'notifications/initialized') {
    return
  }
  if (message.method === 'tools/list') {
    send({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        tools: [{ name: 'capabilities', inputSchema: { type: 'object' } }],
      },
    })
    return
  }
  if (message.method === 'tools/call') {
    send({
      jsonrpc: '2.0',
      id: message.id,
      result: { content: [{ type: 'text', text: JSON.stringify(capabilities) }] },
    })
  }
}

let buffer = ''
process.stdin.on('data', (chunk) => {
  buffer += chunk.toString()
  let index = buffer.indexOf('\n')
  while (index !== -1) {
    const line = buffer.slice(0, index)
    buffer = buffer.slice(index + 1)
    if (line.trim() !== '') {
      handle(JSON.parse(line))
    }
    index = buffer.indexOf('\n')
  }
})

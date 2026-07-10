function tool(name) {
  return { name, description: name, inputSchema: { type: 'object' } }
}

const PAGES = {
  __first: { tools: [tool('alpha')], nextCursor: 'page-2' },
  'page-2': { tools: [tool('beta')], nextCursor: 'page-3' },
  'page-3': { tools: [tool('gamma')] },
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

function handle(message) {
  if (message.method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        capabilities: { tools: { listChanged: false } },
        protocolVersion: message.params.protocolVersion,
        serverInfo: { name: 'paginating', version: '0.0.0' },
      },
    })
    return
  }
  if (message.method === 'tools/list') {
    const cursor = message.params?.cursor
    send({ jsonrpc: '2.0', id: message.id, result: PAGES[cursor ?? '__first'] })
    return
  }
  if (message.method === 'notifications/initialized') {
    return
  }
  if (message.id != null) {
    send({
      jsonrpc: '2.0',
      id: message.id,
      error: { code: -32601, message: `Unsupported method: ${message.method}` },
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
      try {
        handle(JSON.parse(line))
      } catch (e) {
        process.stderr.write(`Error: ${String(e)}\n`)
      }
    }
    index = buffer.indexOf('\n')
  }
})

process.stdin.on('end', () => {
  process.exit(0)
})

process.stdin.on('error', () => {
  process.exit(1)
})

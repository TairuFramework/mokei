import { unexpectedExit } from './backends/types.js'
import { createRunner, type Runner } from './runner.js'

export type OpenURLOptions = {
  runner?: Runner
  platform?: NodeJS.Platform
  signal?: AbortSignal
}

export async function openURL(url: string, options: OpenURLOptions = {}): Promise<void> {
  const platform = options.platform ?? process.platform
  const command = platform === 'darwin' ? 'open' : platform === 'linux' ? 'xdg-open' : undefined
  if (command == null) {
    throw new Error(`Opening URLs is not supported on ${platform}`)
  }

  const ownsRunner = options.runner == null
  const runner = options.runner ?? createRunner()
  try {
    const result = await runner.run(command, [url], {
      timeoutMs: 10_000,
      signal: options.signal,
    })
    if (result.timedOut) throw new Error('Opening URL timed out')
    if (result.code !== 0) throw unexpectedExit(command, result)
  } finally {
    if (ownsRunner) await runner.dispose()
  }
}

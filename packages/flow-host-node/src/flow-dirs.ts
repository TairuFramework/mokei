import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { FlowDefinition } from '@sozai/flow-graph'

export type FlowFileErrorReason = 'invalid_json' | 'unreadable'

export type FlowFileErrorParams = {
  path: string
  reason: FlowFileErrorReason
  cause: unknown
}

/** A flow directory or flow file could not be read or parsed. */
export class FlowFileError extends Error {
  #path: string
  #reason: FlowFileErrorReason

  constructor(params: FlowFileErrorParams) {
    const detail = params.cause instanceof Error ? params.cause.message : String(params.cause)
    super(
      `${params.reason === 'invalid_json' ? 'Invalid flow JSON' : 'Cannot read flows from'} ${params.path}: ${detail}`,
      { cause: params.cause },
    )
    this.name = 'FlowFileError'
    this.#path = params.path
    this.#reason = params.reason
  }

  get path(): string {
    return this.#path
  }

  get reason(): FlowFileErrorReason {
    return this.#reason
  }
}

export async function loadFlowDirs(dirs: Array<string>): Promise<{
  files: Array<string>
  flows: Array<FlowDefinition>
}> {
  const files: Array<string> = []
  const flows: Array<FlowDefinition> = []
  for (const directory of dirs) {
    let entries: Array<string>
    try {
      entries = await readdir(directory)
    } catch (error) {
      // biome-ignore lint/style/useErrorCause: FlowFileError takes cause in its params object.
      throw new FlowFileError({ path: directory, reason: 'unreadable', cause: error })
    }
    const names = entries.filter((name) => name.endsWith('.json')).sort()
    for (const name of names) {
      const path = join(directory, name)
      let source: string
      try {
        source = await readFile(path, 'utf8')
      } catch (error) {
        // biome-ignore lint/style/useErrorCause: FlowFileError takes cause in its params object.
        throw new FlowFileError({ path, reason: 'unreadable', cause: error })
      }
      let flow: unknown
      try {
        flow = JSON.parse(source)
      } catch (error) {
        // biome-ignore lint/style/useErrorCause: FlowFileError takes cause in its params object.
        throw new FlowFileError({ path, reason: 'invalid_json', cause: error })
      }
      files.push(path)
      flows.push(flow as FlowDefinition)
    }
  }
  return { files, flows }
}

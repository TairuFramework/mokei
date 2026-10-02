import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { FlowDefinition } from '@sozai/flow-graph'

export async function loadFlowDirs(dirs: Array<string>): Promise<{
  files: Array<string>
  flows: Array<FlowDefinition>
}> {
  const files: Array<string> = []
  const flows: Array<FlowDefinition> = []
  for (const directory of dirs) {
    const names = (await readdir(directory)).filter((name) => name.endsWith('.json')).sort()
    for (const name of names) {
      const path = join(directory, name)
      let flow: unknown
      try {
        flow = JSON.parse(await readFile(path, 'utf8'))
      } catch (error) {
        if (error instanceof SyntaxError) {
          throw new Error(`Invalid flow JSON ${path}: ${error.message}`, { cause: error })
        }
        throw error
      }
      files.push(path)
      flows.push(flow as FlowDefinition)
    }
  }
  return { files, flows }
}

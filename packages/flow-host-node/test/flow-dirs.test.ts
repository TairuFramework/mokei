import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'

const directories: Array<string> = []

async function createDirectory() {
  const directory = await mkdtemp(join(tmpdir(), 'flow-dirs-'))
  directories.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })))
})

describe('flow directories', () => {
  test('loads JSON files in directory order and name order', async () => {
    const { loadFlowDirs } = await import('../src/index.js')
    const root = await createDirectory()
    const first = join(root, 'first')
    const second = join(root, 'second')
    await mkdir(first)
    await mkdir(second)
    await writeFile(join(first, 'b.json'), '{"id":"b"}')
    await writeFile(join(first, 'a.json'), '{"id":"a"}')
    await writeFile(join(first, 'note.txt'), '{"id":"ignored"}')
    await writeFile(join(first, 'upper.JSON'), '{"id":"ignored-too"}')
    await writeFile(join(second, 'c.json'), '{"id":"c"}')

    await expect(loadFlowDirs([first, second])).resolves.toEqual({
      files: [join(first, 'a.json'), join(first, 'b.json'), join(second, 'c.json')],
      flows: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
    })
  })

  test('accepts empty directories and names malformed JSON files', async () => {
    const { loadFlowDirs } = await import('../src/index.js')
    const root = await createDirectory()
    const empty = join(root, 'empty')
    const malformed = join(root, 'malformed')
    await mkdir(empty)
    await mkdir(malformed)
    await writeFile(join(malformed, 'broken.json'), '{')

    await expect(loadFlowDirs([empty])).resolves.toEqual({ files: [], flows: [] })
    await expect(loadFlowDirs([malformed])).rejects.toThrow(join(malformed, 'broken.json'))
  })

  test('rejects missing directories and leaves graph validation to the host', async () => {
    const { loadFlowDirs } = await import('../src/index.js')
    const root = await createDirectory()
    const directory = join(root, 'flows')
    await mkdir(directory)
    await writeFile(join(directory, 'invalid-graph.json'), '{"notAFlow":true}')

    await expect(loadFlowDirs([join(root, 'missing')])).rejects.toThrow()
    const result = await loadFlowDirs([directory])
    expect(result.flows).toEqual([{ notAFlow: true }])
  })
})

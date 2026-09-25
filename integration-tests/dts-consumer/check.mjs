// Typechecks the published declarations as a consumer, with `skipLibCheck: false`.
// Third-party declarations are checked too, but their errors are outside our control:
// node-llama-cpp 3.19.0 ships a `.d.ts` that references a missing `LlamaOptions.tempDir`
// and the untyped `async-retry`. Only errors outside node_modules fail the check.
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc')
const project = fileURLToPath(new URL('./tsconfig.json', import.meta.url))
const result = spawnSync(process.execPath, [tsc, '-p', project, '--pretty', 'false'], {
  encoding: 'utf8',
})
if (result.error != null) {
  throw result.error
}

const errors = result.stdout.split('\n').filter((line) => {
  return /error TS\d+/.test(line)
})
const ignored = errors.filter((line) => {
  return line.includes('node_modules/')
})
const failures = errors.filter((line) => {
  return !line.includes('node_modules/')
})

if (ignored.length > 0) {
  console.log(`Ignored ${ignored.length} error(s) in third-party declarations.`)
}
if (failures.length > 0) {
  console.error(failures.join('\n'))
  process.exit(1)
}
if (result.status !== 0 && errors.length === 0) {
  console.error(result.stdout + result.stderr)
  process.exit(result.status ?? 1)
}
console.log('Published declarations typecheck as a consumer.')

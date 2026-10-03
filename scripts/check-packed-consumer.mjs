// Packed-consumer check: packs every public workspace package, installs the tarballs into a
// throwaway project outside the workspace, then type-checks the published declarations and runs
// the installed CLI. Catches dependencies that published declarations or the runtime graph reach
// but a package.json does not declare, which workspace-linked builds never surface.
import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// Entries the consumer imports, as `export type *` re-exports, and the packages it depends on.
const TYPE_IMPORTS = {
  FlowClient: '@mokei/flow-client',
  FlowHostNode: '@mokei/flow-host-node',
}
const CONSUMER_DEPENDENCIES = ['@mokei/flow-client', '@mokei/flow-host-node', 'mokei']

function readJSON(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function run(command, args, options) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options })
  if (result.error != null) {
    throw result.error
  }
  return result
}

function runChecked(label, command, args, options) {
  const result = run(command, args, options)
  if (result.status !== 0) {
    throw new Error(`${label} failed (exit ${result.status})\n${result.stdout}${result.stderr}`)
  }
  return result
}

function readCatalogVersion(name) {
  const text = readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8')
  const catalog = text.match(/^catalog:\n((?: {2}.*\n|\n)+)/m)?.[1] ?? ''
  const line = catalog.split('\n').find((entry) => {
    return entry.trim().replace(/^['"]|['"]?:.*$/g, '') === name
  })
  const version = line?.match(/:\s*['"]?([^'"\s]+)['"]?\s*$/)?.[1]
  if (version == null) {
    throw new Error(`No catalog version for ${name}`)
  }
  return version
}

// Public packages: `versioning.fixed` in pnpm-workspace.yaml, which also lists `mokei`.
function readPublicPackageNames() {
  const text = readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8')
  const block = text.match(/^versioning:\n {2}fixed:\n((?: {4}.*\n)+)/m)?.[1] ?? ''
  const names = [...block.matchAll(/'([^']+)'/g)].map((match) => match[1])
  if (names.length === 0) {
    throw new Error('No packages found in versioning.fixed')
  }
  return names
}

function findPackageDirectories() {
  const directories = new Map()
  for (const group of ['packages', 'mcp-servers']) {
    const base = join(root, group)
    if (!existsSync(base)) {
      continue
    }
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      const manifest = join(base, entry.name, 'package.json')
      if (entry.isDirectory() && existsSync(manifest)) {
        directories.set(readJSON(manifest).name, join(base, entry.name))
      }
    }
  }
  return directories
}

function packPackages(names, tarballs) {
  const directories = findPackageDirectories()
  mkdirSync(tarballs, { recursive: true })
  const packed = {}
  for (const name of names) {
    const directory = directories.get(name)
    if (directory == null) {
      throw new Error(`Workspace package not found: ${name}`)
    }
    const before = new Set(readdirSync(tarballs))
    runChecked(`pnpm pack ${name}`, 'pnpm', ['pack', '--pack-destination', tarballs], {
      cwd: directory,
    })
    const created = readdirSync(tarballs).filter((file) => !before.has(file))
    if (created.length !== 1) {
      throw new Error(`Expected one tarball for ${name}, got ${created.join(', ')}`)
    }
    packed[name] = join(tarballs, created[0])
  }
  return packed
}

function writeConsumer(consumer, packed) {
  const manifest = {
    name: 'mokei-packed-consumer',
    version: '0.0.0',
    private: true,
    type: 'module',
    dependencies: Object.fromEntries(
      CONSUMER_DEPENDENCIES.map((name) => [name, `file:${packed[name]}`]),
    ),
    devDependencies: {
      '@types/node': readCatalogVersion('@types/node'),
      typescript: readCatalogVersion('typescript'),
    },
  }
  writeFileSync(join(consumer, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)

  // pnpm 12 ignores `package.json#pnpm` and non-registry `.npmrc` settings, so the consumer
  // carries its own workspace file. JSON is valid YAML.
  const overrides = Object.fromEntries(
    Object.entries(packed).map(([name, tarball]) => [name, `file:${tarball}`]),
  )
  const settings = {
    overrides,
    // Upstream gaps that the isolated linker exposes and mokei cannot fix from its own
    // manifests: `@enkaku/client` imports types from `@enkaku/protocol`, and `@enkaku/protocol`
    // from `@enkaku/transport`; `@inkjs/ui` imports `react` without declaring a peer. Drop each
    // entry once the upstream package declares the dependency.
    packageExtensions: {
      '@enkaku/client': { dependencies: { '@enkaku/protocol': '*' } },
      '@enkaku/protocol': { dependencies: { '@enkaku/transport': '*' } },
      '@inkjs/ui': { peerDependencies: { react: '*' } },
    },
    nodeLinker: 'isolated',
    hoist: false,
    publicHoistPattern: [],
    linkWorkspacePackages: false,
    // Install scripts (node-llama-cpp) are irrelevant to declarations and `--help`.
    strictDepBuilds: false,
  }
  const lines = Object.entries(settings).map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
  writeFileSync(join(consumer, 'pnpm-workspace.yaml'), `${lines.join('\n')}\n`)

  const exports = Object.entries(TYPE_IMPORTS).map(([alias, specifier]) => {
    return `export type * as ${alias} from '${specifier}'`
  })
  writeFileSync(join(consumer, 'index.ts'), `${exports.join('\n')}\n`)
  const tsconfig = {
    compilerOptions: {
      target: 'es2025',
      lib: ['es2025', 'dom'],
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      strict: true,
      noEmit: true,
      skipLibCheck: false,
      types: ['node'],
    },
    include: ['./index.ts'],
  }
  writeFileSync(join(consumer, 'tsconfig.json'), `${JSON.stringify(tsconfig, null, 2)}\n`)
}

function checkLockfile(consumer) {
  const lockfile = readFileSync(join(consumer, 'pnpm-lock.yaml'), 'utf8')
  const problems = []
  const lines = lockfile.split('\n')
  let section = ''
  for (const [index, line] of lines.entries()) {
    if (/^\w+:/.test(line)) {
      section = line.slice(0, line.indexOf(':'))
    }
    if (/\b(link|workspace):/.test(line)) {
      problems.push(`link/workspace reference: ${line.trim()}`)
    }
    // Package keys such as `'@mokei/context-rpc@file:…':` in the `packages:` section, each of
    // which must resolve from a tarball.
    const key = line.match(/^ {2}'?((?:@mokei\/[^@'\s]+|mokei)@[^':]*:?[^']*)'?:\s*$/)?.[1]
    if (
      section === 'packages' &&
      key != null &&
      !lines.slice(index + 1, index + 4).some((next) => next.includes('tarball:'))
    ) {
      problems.push(`resolution is not a tarball: ${key}`)
    }
  }
  if (problems.length > 0) {
    throw new Error(`Lockfile check failed\n${problems.join('\n')}`)
  }
}

function main() {
  const temporary = mkdtempSync(join(tmpdir(), 'mokei-packed-'))
  let succeeded = false
  try {
    const packed = packPackages(readPublicPackageNames(), join(temporary, 'tarballs'))
    const consumer = join(temporary, 'consumer')
    mkdirSync(consumer)
    writeConsumer(consumer, packed)

    runChecked('pnpm install', 'pnpm', ['install', '--no-frozen-lockfile'], {
      cwd: consumer,
      env: { ...process.env, CI: 'true' },
    })
    checkLockfile(consumer)

    const tsc = join(consumer, 'node_modules/.bin/tsc')
    runChecked('tsc', tsc, ['-p', '.', '--pretty', 'false'], { cwd: consumer })
    console.log('Published declarations typecheck as a consumer.')

    const help = runChecked('mokei --help', join(consumer, 'node_modules/.bin/mokei'), ['--help'], {
      cwd: consumer,
    })
    console.log(help.stdout)
    succeeded = true
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    console.error(`Temporary consumer kept at ${temporary}`)
    process.exitCode = 1
  } finally {
    if (succeeded) {
      rmSync(temporary, { recursive: true, force: true })
    }
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}

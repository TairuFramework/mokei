import type { ReadResourceResult } from '@mokei/context-protocol'
import { INVALID_PARAMS, SKILLS } from '@mokei/context-protocol'
import { RPCError } from '@mokei/context-rpc'
import type {
  ExtensionHandlerRequest,
  ExtensionMethodHandler,
  ServerExtension,
} from '@mokei/context-server'

import type { SkillCatalog } from './skill-catalog.js'

/** Every catalog URI uses this scheme; the catalog answers every URI under it. */
const SKILL_URI_PREFIX = 'skill://'

function readURI(request: ExtensionHandlerRequest): string {
  return request.params.uri as string
}

/**
 * Serves the Skills extension (`2026-07-28` only) from `catalog` on a `ContextServer`, through its
 * `extensions` option, and answers `resources/read` for every `skill://` URI from it on every
 * revision. `resources/directory/read` is served only when the catalog enables `directoryRead`.
 */
export function skillsServerExtension(catalog: SkillCatalog): ServerExtension {
  const handlers: Record<string, ExtensionMethodHandler> = {
    // Every entry on one page: the extension allows a single page.
    'skills/list': () => ({ skills: [...catalog.entries] }),
    'skills/get': (request) => {
      const uri = readURI(request)
      const skill = catalog.getEntry(uri)
      if (skill == null) {
        throw new RPCError({ code: INVALID_PARAMS, message: `No skill is served at ${uri}` })
      }
      return { skill }
    },
  }
  if (catalog.directoryRead) {
    handlers['resources/directory/read'] = (request) => {
      const uri = readURI(request)
      const resources = catalog.getDirectory(uri)
      if (resources == null) {
        throw new RPCError({ code: INVALID_PARAMS, message: `${uri} is not a directory resource` })
      }
      return { resources }
    }
  }

  return {
    definition: SKILLS,
    settings: catalog.directoryRead ? { directoryRead: true } : undefined,
    handlers,
    resources: {
      owns: (uri) => uri.startsWith(SKILL_URI_PREFIX),
      read: (uri): ReadResourceResult['contents'][number] => {
        const file = catalog.getFile(uri)
        if (file == null) {
          throw new RPCError({ code: INVALID_PARAMS, message: `Resource not found: ${uri}` })
        }
        // The catalog sets exactly one of `text` or `blob` per file.
        const { text, blob, ...rest } = file
        return text == null ? { ...rest, blob: blob as string } : { ...rest, text }
      },
    },
    capabilities: { resources: true },
    cache: catalog.cache,
    scopes: catalog.scopes,
  }
}

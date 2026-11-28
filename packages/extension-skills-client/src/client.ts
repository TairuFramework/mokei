import {
  type ContextClient,
  type ContextTypes,
  ExtensionNotDeclaredError,
  type ListParams,
  listPaged,
  type PagedResult,
  type RequestOptions,
  requireClientExtension,
  splitRequestOptions,
} from '@mokei/context-client'
import type {
  GetSkillResult,
  ListSkillsRequest,
  ListSkillsResult,
  ReadResourceDirectoryRequest,
  ReadResourceDirectoryResult,
  Skill,
} from '@mokei/context-protocol'
import { SKILLS } from '@mokei/context-protocol'

import {
  checkSkillEntry,
  listedSkillFile,
  type SkillFile,
  SkillVerificationError,
  verifySkillFile,
} from './skill-verification.js'

/** The Skills extension methods of a `ContextClient` built with `extensions: [SKILLS]`. */
export type SkillsClient = {
  /** Lists the skills the server serves, walking every page unless `cursor` is set. */
  listSkills(params?: ListParams<ListSkillsRequest['params']>): Promise<ListSkillsResult>
  /**
   * Fetches the entry of the skill whose `SKILL.md` is at `uri`. Reads no file. Throws
   * `SkillVerificationError` (reason `'response'`) if the server answers with another skill's entry.
   */
  getSkill(uri: string, options?: RequestOptions): Promise<GetSkillResult>
  /**
   * Lists the direct children of a directory resource, walking every page unless `cursor` is set.
   * Refused locally unless the server declared the skills extension with `directoryRead: true`.
   */
  readResourceDirectory(
    params: ListParams<ReadResourceDirectoryRequest['params']>,
  ): Promise<ReadResourceDirectoryResult>
  /**
   * Reads one file of a skill and verifies it against `entry`, the entry the caller holds: the
   * entry is checked, the URI must be listed by it (or lie within the skill root for a
   * `'dynamic'` entry), and the bytes must match the listed size and digest. For `SKILL.md`, the
   * parsed frontmatter must equal the entry's. Throws `SkillVerificationError` otherwise; content
   * that fails is never returned. An entry or URI that fails locally sends nothing. Some malformed
   * responses (such as contents with neither `text` nor `blob`) fail the inbound wire validation
   * first and reject as `RPCError('Invalid response')` instead of
   * `SkillVerificationError('response')`.
   */
  readSkillFile(entry: Skill, uri: string, options?: RequestOptions): Promise<SkillFile>
}

/**
 * Wraps `client` with the Skills extension methods. The client must be built with
 * `extensions: [SKILLS]`; otherwise every method is refused locally before anything is sent.
 */
export function createSkillsClient<T extends ContextTypes>(client: ContextClient<T>): SkillsClient {
  return {
    async listSkills(params = {}) {
      const [, gateOptions] = splitRequestOptions(params)
      await requireClientExtension(client, SKILLS, 'skills/list', gateOptions)
      const result = await listPaged(
        client,
        'skills/list',
        'skills',
        (pageParams, options) => {
          return client.request(
            'skills/list',
            pageParams as ListSkillsRequest['params'],
            options,
          ) as Promise<PagedResult>
        },
        params,
      )
      return result as ListSkillsResult
    },

    async getSkill(uri, options) {
      await requireClientExtension(client, SKILLS, 'skills/get', options)
      const result = await client.request('skills/get', { uri }, options)
      if (result.skill.uri !== uri) {
        throw new SkillVerificationError({
          reason: 'response',
          uri,
          message: `skills/get for ${uri} returned the entry of ${result.skill.uri}`,
        })
      }
      return result
    },

    async readResourceDirectory(params) {
      const [, gateOptions] = splitRequestOptions(params)
      const settings = await requireClientExtension(
        client,
        SKILLS,
        'resources/directory/read',
        gateOptions,
      )
      if (settings.directoryRead !== true) {
        throw new ExtensionNotDeclaredError({ extension: `${SKILLS.id}#directoryRead` })
      }
      const result = await listPaged(
        client,
        'resources/directory/read',
        'resources',
        (pageParams, options) => {
          return client.request(
            'resources/directory/read',
            pageParams as ReadResourceDirectoryRequest['params'],
            options,
          ) as Promise<PagedResult>
        },
        params,
      )
      return result as ReadResourceDirectoryResult
    },

    async readSkillFile(entry, uri, options) {
      checkSkillEntry(entry)
      const listed = listedSkillFile(entry, uri)
      await requireClientExtension(client, SKILLS, 'readSkillFile', options)
      // Never hand an `input_required` suspension back: only a completed read can be verified.
      const result = await client.readResource({ ...options, uri, allowInputRequired: false })
      return await verifySkillFile(entry, uri, listed, result)
    },
  }
}

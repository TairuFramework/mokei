/**
 * Mokei Skills MCP extension client support.
 *
 * ## Installation
 *
 * ```sh
 * npm install @mokei/extension-skills-client
 * ```
 *
 * @module extension-skills-client
 */

export { createSkillsClient, type SkillsClient } from './client.js'
export {
  checkSkillEntry,
  type SkillFile,
  SkillVerificationError,
  type SkillVerificationErrorParams,
  type SkillVerificationReason,
} from './skill-verification.js'

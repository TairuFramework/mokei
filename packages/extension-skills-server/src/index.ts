/**
 * Mokei Skills MCP extension server support.
 *
 * ## Installation
 *
 * ```sh
 * npm install @mokei/extension-skills-server
 * ```
 *
 * @module extension-skills-server
 */

export { skillsServerExtension } from './extension.js'
export {
  createSkillCatalog,
  type SkillCatalog,
  type SkillCatalogOptions,
  type SkillDefinition,
  type SkillFileContents,
} from './skill-catalog.js'

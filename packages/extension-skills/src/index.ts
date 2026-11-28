/**
 * Mokei Skills MCP extension format helpers.
 *
 * ## Installation
 *
 * ```sh
 * npm install @mokei/extension-skills
 * ```
 *
 * @module extension-skills
 */

export {
  computeDigest,
  decodeExactUTF8,
  frontmatterEquals,
  isValidDigest,
  isValidSkillName,
  isValidSkillURI,
  isWithinSkill,
  joinSkillURI,
  parseSkillFrontmatter,
  SKILL_LIMITS,
  SkillFormatError,
  skillNameFromURI,
  skillRootURI,
  validatePathSegments,
  validateSkillFrontmatter,
} from './skill-format.js'

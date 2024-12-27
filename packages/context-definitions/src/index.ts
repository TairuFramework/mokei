/**
 * Mokei MCP definitions.
 *
 * ## Installation
 *
 * ```sh
 * npm install @mokei/context-definitions
 * ```
 *
 * @module context-definitions
 */

import type { FromSchema, Schema } from '@enkaku/schema'
import { inputSchema } from '@mokei/context-protocol'

export const promptDefinition = {
  type: 'object',
  properties: {
    description: { type: 'string' },
    arguments: { type: 'object' },
  },
  additionalProperties: false,
} as const satisfies Schema
export type PromptDefinition = FromSchema<typeof promptDefinition>

export const promptsDefinition = {
  type: 'object',
  additionalProperties: promptDefinition,
} as const satisfies Schema
export type PromptsDefinition = FromSchema<typeof promptsDefinition>

export const toolDefinition = {
  type: 'object',
  properties: {
    description: { type: 'string' },
    input: inputSchema,
  },
  required: ['input'],
  additionalProperties: false,
} as const satisfies Schema
export type ToolDefinition = FromSchema<typeof toolDefinition>

export const toolsDefinition = {
  type: 'object',
  additionalProperties: toolDefinition,
} as const satisfies Schema
export type ToolsDefinition = FromSchema<typeof toolsDefinition>

export const specificationDefinition = {
  type: 'object',
  properties: {
    prompts: promptsDefinition,
    tools: toolsDefinition,
  },
  additionalProperties: false,
} as const satisfies Schema
export type SpecificationDefinition = FromSchema<typeof specificationDefinition>

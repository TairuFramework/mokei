import { role } from '../src/content.js'
import { elicitResult } from '../src/elicitation.js'
import { samplingMessage, toolChoice } from '../src/sampling.js'
import { multiSelectEnumSchema, primitiveSchemaDefinition } from '../src/schema.js'
import elicitMultiFixture from './conformance/elicitation-multiselect.json'
import elicitResultFixture from './conformance/elicitation-result.json'
import elicitEnumFixture from './conformance/elicitation-sep1330.json'
import { runConformance } from './conformance/harness.js'
import roleFixture from './conformance/role.json'
import samplingContentFixture from './conformance/sampling-content.json'
import toolChoiceFixture from './conformance/sampling-toolchoice.json'

runConformance(role, roleFixture)
runConformance(toolChoice, toolChoiceFixture)
runConformance(samplingMessage, samplingContentFixture)
runConformance(primitiveSchemaDefinition, elicitEnumFixture)
runConformance(multiSelectEnumSchema, elicitMultiFixture)
runConformance(elicitResult, elicitResultFixture)

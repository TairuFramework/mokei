import { role } from '../src/content.js'
import { elicitationCompleteNotification, elicitResult } from '../src/elicitation.js'
import { samplingMessage, toolChoice } from '../src/sampling.js'
import { enumSchema, multiSelectEnumSchema, primitiveSchemaDefinition } from '../src/schema.js'
import { discoverResult, requestMeta } from '../src/versions/2026-07-28.js'
import discoverResultFixture from './conformance/discover-result.json' with { type: 'json' }
import elicitCompleteFixture from './conformance/elicitation-complete.json' with { type: 'json' }
import enumSchemaFixture from './conformance/elicitation-enum-schema.json' with { type: 'json' }
import elicitMultiFixture from './conformance/elicitation-multiselect.json' with { type: 'json' }
import elicitResultFixture from './conformance/elicitation-result.json' with { type: 'json' }
import elicitEnumFixture from './conformance/elicitation-sep1330.json' with { type: 'json' }
import { runConformance } from './conformance/harness.js'
import protocolMetaFixture from './conformance/protocol-meta-2026-07-28.json' with { type: 'json' }
import roleFixture from './conformance/role.json' with { type: 'json' }
import samplingContentFixture from './conformance/sampling-content.json' with { type: 'json' }
import toolChoiceFixture from './conformance/sampling-toolchoice.json' with { type: 'json' }

runConformance(role, roleFixture)
runConformance(toolChoice, toolChoiceFixture)
runConformance(samplingMessage, samplingContentFixture)
runConformance(primitiveSchemaDefinition, elicitEnumFixture)
runConformance(multiSelectEnumSchema, elicitMultiFixture)
runConformance(elicitResult, elicitResultFixture)
runConformance(enumSchema, enumSchemaFixture)
runConformance(elicitationCompleteNotification, elicitCompleteFixture)
runConformance(requestMeta, protocolMetaFixture)
runConformance(discoverResult, discoverResultFixture)

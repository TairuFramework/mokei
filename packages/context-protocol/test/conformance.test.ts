import { role } from '../src/content.js'
import { toolChoice } from '../src/sampling.js'
import { runConformance } from './conformance/harness.js'
import roleFixture from './conformance/role.json'
import toolChoiceFixture from './conformance/sampling-toolchoice.json'

runConformance(role, roleFixture)
runConformance(toolChoice, toolChoiceFixture)

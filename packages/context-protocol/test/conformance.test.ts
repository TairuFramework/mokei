import { role } from '../src/content.js'
import { samplingMessage, toolChoice } from '../src/sampling.js'
import { runConformance } from './conformance/harness.js'
import roleFixture from './conformance/role.json'
import samplingContentFixture from './conformance/sampling-content.json'
import toolChoiceFixture from './conformance/sampling-toolchoice.json'

runConformance(role, roleFixture)
runConformance(toolChoice, toolChoiceFixture)
runConformance(samplingMessage, samplingContentFixture)

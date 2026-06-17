import { role } from '../src/content.js'
import { runConformance } from './conformance/harness.js'
import roleFixture from './conformance/role.json'

runConformance(role, roleFixture)

import { readFileSync } from 'node:fs'
import { makeProjectReadTools } from './agentTools'
import { PLANNED_HANDOFF_FIELD_NAMES, PLANNED_HANDOFF_STORYBOARD_RULE } from './policy'
import { protocolSystem } from './runtime'
import type { ProjectDoc } from '../../domain/types'

let failures = 0

function check(name: string, condition: boolean, detail: string) {
  if (condition) console.log(`  OK ${name}`)
  else {
    failures += 1
    console.error(`  FAIL ${name}: ${detail}`)
  }
}

const doc: ProjectDoc = {
  meta: { id: 'p1', name: 'Policy Test', artStyle: 'cinematic', videoRatio: '16:9', createdAt: 0, updatedAt: 0 },
  seriesBible: { plannedEpisodeCount: 1 },
  novel: [],
  scripts: [],
  assets: [],
  storyboards: [],
  clips: [],
  track: [],
  memory: [],
  episodes: [],
}

const tools = makeProjectReadTools(() => doc)
const handoffTool = tools.find((tool) => tool.name === 'get_episode_handoff')
const localProtocolSystem = protocolSystem('base system', tools)
const agentSource = readFileSync('src/ui/studio/agent/agent.ts', 'utf8')
const agentPolicyUseCount = agentSource.match(/PLANNED_HANDOFF_STORYBOARD_RULE/g)?.length ?? 0

for (const field of PLANNED_HANDOFF_FIELD_NAMES) {
  check(`get_episode_handoff description names ${field}`, !!handoffTool?.description.includes(field), handoffTool?.description ?? '')
  check(`local tool protocol names ${field}`, localProtocolSystem.includes(field), localProtocolSystem)
}

check('get_episode_handoff description includes planned handoff storyboard rule', !!handoffTool?.description.includes(PLANNED_HANDOFF_STORYBOARD_RULE), handoffTool?.description ?? '')
check('local tool protocol includes planned handoff storyboard rule', localProtocolSystem.includes(PLANNED_HANDOFF_STORYBOARD_RULE), localProtocolSystem)
check('agent prompts reuse planned handoff storyboard rule', agentPolicyUseCount >= 4, `uses=${agentPolicyUseCount}\n${agentSource}`)

if (failures) {
  console.error(`\nagentPolicy selftest: ${failures} FAILED`)
  process.exit(1)
}

console.log('\nagentPolicy selftest: ALL PASSED')

import assert from 'node:assert/strict'
import type { Board, Card, ProjectDoc } from '../src/ui/types.ts'
import type { ProviderConfig } from '../src/ui/services/providers/types.ts'
import { buildAgentCapabilitySnapshot } from '../src/ui/services/agentCapabilitySnapshot.ts'
import { compileAgentNodePlan } from '../src/ui/services/agentPlanCompiler.ts'
import { projectWorkflowNodePlan, sanitizeAgentNodePlan } from '../src/ui/services/agentNodePlan.ts'
import { createWorkflowRun, normalizeWorkflowBrief } from '../src/ui/services/workflowPlanner.ts'
import { refreshAgentCompiledPlan } from '../src/ui/services/agentPlanRuntime.ts'

;(globalThis as any).window = {
  mulby: {
    ai: {
      allModels: async () => [
        { id: 'text-pro', endpointType: 'chat', label: 'Text' },
        { id: 'image-pro', endpointType: 'image-generation', label: 'Image' }
      ]
    }
  }
}

function card(id: string, kind: Card['kind'], patch: Partial<Card> = {}): Card {
  return {
    id, kind, x: 0, y: 0, w: 320, h: 240, title: id, prompt: '', modelId: null, providerId: null,
    params: {}, status: 'idle', progress: 0, error: null, assetUrl: null, assetLocalPath: null,
    attachmentId: null, mime: null, text: null, refIds: [], assets: [], meta: {}, parentId: null,
    ...patch
  }
}

function board(id: string, cards: Card[]): Board {
  return { id, name: id, cards: Object.fromEntries(cards.map((item) => [item.id, item])), edges: {}, viewport: { x: 0, y: 0, zoom: 1 } }
}

const videoProvider: ProviderConfig = {
  id: 'video', label: 'Video', kind: 'video', type: 'custom-video', baseURL: 'https://private.invalid', model: 'video-pro',
  capabilities: { textToVideo: true, imageToVideo: true, lastFrame: false, aspects: ['1:1'], durations: [5, 10], resolutions: ['720p'] }
}

function fixture() {
  const source = card('source', 'text', { title: '产品 Brief', text: '通勤者展示一手开盖保温杯。' })
  const foreign = card('foreign-image', 'image', { assetUrl: 'file:///foreign.png', assetLocalPath: '/foreign.png', mime: 'image/png' })
  const project: ProjectDoc = {
    id: 'project', name: 'test', boards: [board('foreign-board', [foreign]), board('board-3', [source])], activeBoardId: 'board-3',
    globalModelId: null, defaultImageModel: 'image-pro', defaultTextModel: 'text-pro', assetAnchors: {}, workflowRuns: {},
    createdAt: 1, updatedAt: 1, schemaVersion: 7
  }
  const brief = normalizeWorkflowBrief({
    title: '通勤杯广告', summary: '产品广告', audience: '通勤人群', aspect: '1:1', totalDuration: 6, ending: '产品定帧',
    product: { productName: '保温杯', brandText: 'MULBY', campaignObjective: '新品认知', coreProposition: '一手开盖', sellingPoints: ['便携'], mandatoryElements: ['MULBY'], callToAction: '立即购买' },
    anchorSuggestions: [
      { role: 'prop', name: '保温杯', description: '固定杯身结构、颜色和文字。' },
      { role: 'reference', name: '手持保温杯', description: '通勤者一只手拿着同一只保温杯。' },
      { role: 'character', name: '通勤者', description: '固定人物身份与服装。' }
    ],
    shots: [
      { desc: '通勤者拿起保温杯', scene: '地铁站', character: '通勤者', action: '拿起', duration: 3, imagePrompt: '通勤者拿起保温杯', videoPrompt: '镜头推进，通勤者拿起保温杯', dialogue: '沉稳女声：“轻装出发”', anchorNames: ['保温杯', '手持保温杯', '通勤者'] },
      { desc: '通勤者一手开盖', scene: '地铁站', character: '通勤者', action: '开盖', duration: 3, imagePrompt: '通勤者一手打开保温杯', videoPrompt: '特写跟随开盖动作', anchorNames: ['保温杯', '手持保温杯', '通勤者'] }
    ]
  }, {}, 'product-ad-film', 6)
  const capability = buildAgentCapabilitySnapshot({
    recipe: 'product-ad-film', project, sourceBoardId: 'board-3', sourceCardId: source.id, aspect: '1:1',
    textModelId: 'text-pro', imageModelId: 'image-pro', videoProvider
  })
  const baseRun = createWorkflowRun({ recipe: 'product-ad-film', sourceCard: source, sourceBoardId: 'board-3', project, goal: '生成产品广告', videoProvider }, brief, capability)
  const plan = projectWorkflowNodePlan(baseRun, project)
  const run = { ...baseRun, nodePlan: plan }
  return { project, capability, run, plan }
}

function testProjectionAndDeterministicCompilation() {
  const { project, capability, plan } = fixture()
  const compiled = compileAgentNodePlan(plan, { snapshot: capability.snapshot, project, videoProvider })
  const second = compileAgentNodePlan(plan, { snapshot: capability.snapshot, project, videoProvider })
  assert.deepEqual(compiled, second, '同一节点计划与能力快照必须编译为完全一致的白名单操作')
  assert.equal(compiled.issues.some((issue) => issue.level === 'error'), false)
  assert.deepEqual([...new Set(compiled.operations.map((operation) => operation.type))].sort(), ['apply-director-environment', 'bind-reference', 'create-owned-card', 'generate-card', 'lock-anchor', 'open-timeline', 'organize-stage-group'])
  const allowed = new Set(['apply-director-environment', 'bind-reference', 'create-owned-card', 'generate-card', 'lock-anchor', 'open-timeline', 'organize-stage-group'])
  assert.equal(compiled.operations.every((operation) => allowed.has(operation.type)), true)
  const serialized = JSON.stringify(compiled)
  for (const forbidden of ['private.invalid', '/foreign.png', 'baseURL', 'assetLocalPath', '"x"', '"y"', 'command']) assert.equal(serialized.includes(forbidden), false, `编译结果不得包含 ${forbidden}`)

  const action = plan.nodes.find((node) => node.semanticSubjectKind === 'product-action')!
  assert.ok(action, '应把手持产品投影为产品动作设定节点')
  assert.equal(action.dependsOn.some((id) => plan.nodes.find((node) => node.id === id)?.semanticSubjectKind === 'product-master'), true)
  assert.equal(action.dependsOn.some((id) => plan.nodes.find((node) => node.id === id)?.semanticSubjectKind === 'character-master'), true)
  for (const video of plan.nodes.filter((node) => node.kind === 'video')) {
    const create = compiled.operations.find((operation) => operation.type === 'create-owned-card' && operation.planNodeId === video.id)
    assert.equal(create?.type, 'create-owned-card')
    if (create?.type === 'create-owned-card') {
      assert.equal(create.resolvedParams.plannedDuration, 3)
      assert.equal(create.resolvedParams.duration, 5, '成片 3s 应映射为可覆盖它的 Provider 5s 原始素材')
      assert.equal(create.corrections.some((correction) => correction.key === 'duration'), true)
    }
  }
  const expectedTasks = plan.nodes.filter((node) => node.generationPolicy === 'generate-after-approval').reduce((sum, node) => sum + node.expectedOutput.quantity, 0)
  assert.equal(compiled.taskCount, expectedTasks)
  assert.equal(plan.nodes.filter((node) => node.kind === 'group').every((group) => !compiled.operations.some((operation) => operation.type === 'create-owned-card' && operation.planNodeId === group.id)), true, '分组只能编译为本地整理操作')
  const pano = plan.nodes.find((node) => node.kind === 'pano')!
  const panoCreate = compiled.operations.find((operation) => operation.type === 'create-owned-card' && operation.planNodeId === pano.id)
  assert.ok(pano && panoCreate?.type === 'create-owned-card')
  assert.equal(pano.params.aspect, undefined)
  assert.equal(panoCreate?.type === 'create-owned-card' ? panoCreate.resolvedParams.aspect : 'unexpected', undefined, '全景编译结果不得接受非 2:1 aspect 参数')
  const audio = plan.nodes.find((node) => node.kind === 'audio')!
  assert.equal(audio.prompt, '轻装出发', 'TTS 节点只保留实际台词，不朗读声线说明')
  const timeline = compiled.operations.find((operation) => operation.type === 'open-timeline')
  assert.equal(timeline?.type === 'open-timeline' && timeline.planNodeIds.includes(audio.id), true, '配音必须与视频共同进入时间线计划')
}

function testCompilerRejectsInvalidAndCrossBoardInputs() {
  const { project, capability, plan } = fixture()
  const tampered = structuredClone(plan)
  const still = tampered.nodes.find((node) => node.id.startsWith('shot-image-'))!
  still.params.aspect = '99:1'
  ;(still.params as any).localPath = '/private/escape.png'
  still.inputs.push({ slot: 'references', sourceType: 'card', sourceId: 'foreign-image', priority: 9, purpose: '跨画布图片' })
  const audio = tampered.nodes.find((node) => node.kind === 'audio')!
  still.inputs.push({ slot: 'references', sourceType: 'planned-node', sourceId: audio.id, priority: 10, purpose: '非法音频输入' })
  still.dependsOn.push('missing-node')
  const compiled = compileAgentNodePlan(tampered, { snapshot: capability.snapshot, project, videoProvider })
  assert.equal(compiled.issues.some((issue) => issue.category === 'capability-mismatch' && issue.field === 'aspect'), true)
  assert.equal(compiled.issues.some((issue) => issue.category === 'input-missing' && /不属于当前画布/.test(issue.message)), true)
  assert.equal(compiled.issues.some((issue) => issue.category === 'capability-mismatch' && /不接受audio输入/.test(issue.message)), true, '音频不能连接到图片节点')
  assert.equal(compiled.issues.some((issue) => issue.category === 'plan-invalid' && /依赖不存在/.test(issue.message)), true)
  assert.equal(compiled.issues.some((issue) => issue.autoFixed && issue.field === 'localPath'), true)
  assert.equal(compiled.operations.some((operation) => operation.planNodeId === still.id), false, '无效节点及其生成操作不得进入执行白名单')
}

function testPlanSanitizationDropsExecutionAuthority() {
  const { plan } = fixture()
  const hostile: any = structuredClone(plan)
  hostile.command = 'delete_everything'
  hostile.x = 999
  hostile.providerUrl = 'https://evil.invalid'
  hostile.nodes[0].x = 123
  hostile.nodes[0].command = 'shell'
  hostile.nodes[0].params.localPath = '/private/file.png'
  hostile.nodes[0].params.baseURL = 'https://evil.invalid'
  const panorama = hostile.nodes.find((node: any) => node.kind === 'pano')
  panorama.params.aspect = '16:9'
  const clean = sanitizeAgentNodePlan(hostile, 'board-3')!
  assert.ok(clean)
  const serialized = JSON.stringify(clean)
  for (const forbidden of ['delete_everything', 'evil.invalid', '/private/file.png', '"x"', '"command"', 'localPath', 'baseURL']) assert.equal(serialized.includes(forbidden), false)
  assert.equal(clean.nodes.find((node) => node.kind === 'pano')?.params.aspect, undefined)
  assert.equal(sanitizeAgentNodePlan(hostile, 'another-board'), null, '计划不能跨画布恢复')
}

function testReadOnlyAndPrivateNodePermissions() {
  const { project, capability, plan } = fixture()
  const tampered = structuredClone(plan)
  tampered.nodes.push({
    id: 'agent-source', kind: 'source', intent: '非法创建素材', title: '素材', prompt: '', params: {}, inputs: [],
    expectedOutput: { quantity: 0, purpose: '非法' }, generationPolicy: 'materialize-only', dependsOn: []
  })
  tampered.nodes.push({
    id: 'agent-note', kind: 'note', intent: '非法创建便签', title: '便签', prompt: '', params: {}, inputs: [],
    expectedOutput: { quantity: 0, purpose: '非法' }, generationPolicy: 'materialize-only', dependsOn: []
  })
  const compiled = compileAgentNodePlan(tampered, { snapshot: capability.snapshot, project, videoProvider })
  assert.equal(compiled.issues.some((item) => item.nodeId === 'agent-source' && /不允许创建source节点/.test(item.message)), true)
  assert.equal(compiled.issues.some((item) => item.nodeId === 'agent-note' && /不允许节点类型 note/.test(item.message)), true)
  assert.equal(compiled.operations.some((operation) => operation.planNodeId === 'agent-source' || operation.planNodeId === 'agent-note'), false)
}

async function testRuntimeRecompilesProviderChanges() {
  const { project, run } = fixture()
  const first = await refreshAgentCompiledPlan(run, project, videoProvider)
  assert.equal(first.blocked, false)
  assert.ok(first.run.compiledPlan)
  const changedProvider: ProviderConfig = {
    ...videoProvider,
    capabilities: { ...videoProvider.capabilities, durations: [10] }
  }
  const changed = await refreshAgentCompiledPlan(first.run, project, changedProvider)
  assert.equal(changed.changed, true, 'Provider 能力变化必须触发新快照和重新编译')
  assert.notEqual(changed.run.capabilitySnapshotHash, first.run.capabilitySnapshotHash)
  const videoCreate = changed.run.compiledPlan?.operations.find((operation) => operation.type === 'create-owned-card' && operation.kind === 'video')
  assert.equal(videoCreate?.type === 'create-owned-card' ? videoCreate.resolvedParams.duration : undefined, 10)

  const incompatibleProvider: ProviderConfig = {
    ...videoProvider,
    capabilities: { ...videoProvider.capabilities, aspects: ['16:9'] }
  }
  const incompatible = await refreshAgentCompiledPlan(changed.run, project, incompatibleProvider)
  assert.equal(incompatible.blocked, true, 'Provider 不再支持计划画幅时必须在执行前阻断')
  assert.equal(incompatible.run.compiledPlan?.issues.some((issue) => issue.level === 'error' && issue.field === 'aspect'), true)
}

testProjectionAndDeterministicCompilation()
testCompilerRejectsInvalidAndCrossBoardInputs()
testPlanSanitizationDropsExecutionAuthority()
testReadOnlyAndPrivateNodePermissions()
await testRuntimeRecompilesProviderChanges()
console.log('agent plan compiler: projection, validation, isolation and sanitization assertions OK')

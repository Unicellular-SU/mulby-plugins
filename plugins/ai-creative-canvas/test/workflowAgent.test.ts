import assert from 'node:assert/strict'
import { createDefaultProject, useGraph } from '../src/ui/store/graphStore.ts'
import { executeAgentCommand, AGENT_COMMANDS } from '../src/ui/services/agentCommands.ts'
import { createWorkflowRun, fitShotsToTotalDuration, fixedWorkflowSteps, normalizeWorkflowBrief, planWorkflow, sanitizeWorkflowRuns } from '../src/ui/services/workflowPlanner.ts'
import { getWorkflowRecipe, WORKFLOW_RECIPES } from '../src/ui/services/workflowRecipes.ts'
import { coveringVideoDuration, plannedVideoClipDuration } from '../src/ui/services/videoSpecs.ts'
import { resumeWorkflow } from '../src/ui/services/workflowRunner.ts'
import { createStoryboardDoc, readStoryboardDoc } from '../src/ui/services/storyboardV2.ts'
import { buildMaterials } from '../src/ui/services/references.ts'
import { continuityLockWarnings, lockWorkflowContinuity, orderWorkflowContinuityCards, prepareWorkflowContinuity, refreshWorkflowContinuityInputs, visualContinuitySuggestions } from '../src/ui/services/workflowContinuity.ts'
import { materializeStoryboardShots, saveStoryboardDoc } from '../src/ui/services/storyboard.ts'
import { cardBoundsOverlap } from '../src/ui/services/cardPlacement.ts'
import type { AgentCommandName, WorkflowRun } from '../src/ui/types.ts'

;(globalThis as any).window = { mulby: { storage: { set: async () => undefined } } }

function reset() {
  useGraph.setState({ project: createDefaultProject(), selectedIds: [], boardHistories: {}, clipboard: { cards: [], edges: [] } })
}

function commandStep(run: WorkflowRun, command: AgentCommandName) {
  const step = run.steps.find((candidate) => candidate.command === command)
  if (!step) throw new Error(`missing workflow step: ${command}`)
  return step
}

function makeRun() {
  const graph = useGraph.getState()
  const sourceCardId = graph.addCard('text', { x: 0, y: 0 }, { title: '剧本', text: '女孩在雨夜找到一只受伤的小猫。' })
  const source = graph.getCard(sourceCardId)!
  const brief = normalizeWorkflowBrief({
    title: '雨夜相遇', summary: '一段温暖相遇', audience: '年轻观众', aspect: '16:9', totalDuration: 10, ending: '女孩抱起小猫',
    anchorSuggestions: [],
    shots: [
      { desc: '女孩走在雨巷', scene: '雨巷', character: '女孩', action: '行走', emotion: '孤独', shotSize: '全景', camera: '跟拍', duration: 5, imagePrompt: '黄色雨衣女孩走在雨巷', videoPrompt: '跟拍女孩缓慢行走', dialogue: '', sfx: '雨声' },
      { desc: '女孩发现小猫', scene: '雨巷', character: '女孩、小猫', action: '蹲下', emotion: '怜惜', shotSize: '近景', camera: '缓慢推进', duration: 5, imagePrompt: '女孩蹲下看见小猫', videoPrompt: '镜头推进，女孩蹲下', dialogue: '', sfx: '雨声' }
    ]
  })
  return createWorkflowRun({ sourceCard: source, sourceBoardId: graph.project.activeBoardId, goal: '做成短片' }, brief)
}

async function testWhitelistAndIdempotentMaterialization() {
  reset()
  const run = makeRun()
  assert.deepEqual(fixedWorkflowSteps().map((step) => step.command), [...AGENT_COMMANDS])
  assert.deepEqual(fixedWorkflowSteps('product-ad-film').map((step) => step.command), [...AGENT_COMMANDS])
  const signal = new AbortController().signal
  const saveStep = commandStep(run, 'save_storyboard')
  await executeAgentCommand(run, saveStep, signal)
  assert.equal(readStoryboardDoc(useGraph.getState().getCard(run.sourceCardId)!)?.shots.length, 2)
  const first = await executeAgentCommand(run, commandStep(run, 'materialize_images'), signal)
  const second = await executeAgentCommand(run, commandStep(run, 'materialize_images'), signal)
  assert.deepEqual(second, first)
  assert.equal(Object.values(useGraph.getState().getActiveBoard().cards).filter((card) => card.kind === 'image').length, 2)
  first.forEach((id) => useGraph.getState().updateCard(id, { status: 'done', assetUrl: `file:///${id}.png`, assetLocalPath: `/${id}.png` }))
  const withImages = { ...run, steps: run.steps.map((step) => step.command === 'materialize_images' ? { ...step, outputCardIds: first } : step) }
  const videos1 = await executeAgentCommand(withImages, commandStep(run, 'create_videos'), signal)
  const videos2 = await executeAgentCommand(withImages, commandStep(run, 'create_videos'), signal)
  assert.deepEqual(videos2, videos1)
  assert.equal(Object.values(useGraph.getState().getActiveBoard().cards).filter((card) => card.kind === 'video').length, 2)
}

async function testWorkflowAspectReachesImageAndVideoCards() {
  reset()
  const graph = useGraph.getState()
  const sourceCardId = graph.addCard('text', { x: 0, y: 0 }, { title: '方形广告', text: '十秒产品广告' })
  const source = graph.getCard(sourceCardId)!
  const brief = normalizeWorkflowBrief({
    title: '方形广告', summary: '', audience: '通用', aspect: '1:1', totalDuration: 10, ending: '产品定帧', anchorSuggestions: [],
    shots: Array.from({ length: 6 }, (_, index) => ({ desc: `镜头 ${index + 1}`, duration: 5 }))
  })
  const run = createWorkflowRun({ recipe: 'product-ad-film', sourceCard: source, sourceBoardId: graph.project.activeBoardId, goal: '生成方形广告' }, brief)
  const signal = new AbortController().signal
  await executeAgentCommand(run, commandStep(run, 'save_storyboard'), signal)
  const imageIds = await executeAgentCommand(run, commandStep(run, 'materialize_images'), signal)
  assert.equal(imageIds.every((id) => useGraph.getState().getCard(id)?.params.aspect === '1:1'), true)
  imageIds.forEach((id) => useGraph.getState().updateCard(id, { status: 'done', assetUrl: `file:///${id}.png`, assetLocalPath: `/${id}.png` }))
  const videoIds = await executeAgentCommand(run, commandStep(run, 'create_videos'), signal)
  assert.equal(videoIds.every((id) => useGraph.getState().getCard(id)?.params.aspect === '1:1'), true)
  assert.equal(Number(videoIds.reduce((sum, id) => sum + Number(useGraph.getState().getCard(id)?.params.plannedDuration || 0), 0).toFixed(1)), 10)
}

async function testCheckpointAndLoadRecovery() {
  reset()
  const run = makeRun()
  useGraph.getState().upsertWorkflowRun(run)
  await resumeWorkflow(run.id)
  const paused = useGraph.getState().project.workflowRuns?.[run.id]!
  assert.equal(paused.status, 'paused')
  assert.equal(paused.steps[0].status, 'checkpoint')

  const dirty = {
    ...useGraph.getState().project,
    workflowRuns: {
      [run.id]: { ...paused, status: 'running', steps: paused.steps.map((step, index) => index === 0 ? { ...step, status: 'running' } : step) },
      evil: { ...paused, id: 'evil', steps: [{ id: 'x', command: 'delete_everything', status: 'pending' }] }
    }
  } as any
  const clean = sanitizeWorkflowRuns(dirty)
  assert.equal(clean[run.id].status, 'paused')
  assert.equal(clean[run.id].steps[0].status, 'pending')
  assert.equal(clean.evil, undefined)

  const legacy = { ...run, steps: run.steps.filter((step) => !['materialize_continuity', 'generate_continuity', 'lock_continuity'].includes(step.command)) }
  const migrated = sanitizeWorkflowRuns({ ...dirty, workflowRuns: { [run.id]: legacy } } as any)[run.id]
  assert.deepEqual(migrated.steps.map((step) => step.command), [...AGENT_COMMANDS])
  assert.equal(commandStep(migrated, 'materialize_continuity').status, 'completed')
  assert.equal(commandStep(migrated, 'lock_continuity').approvedAt != null, true)
}

async function testContinuityReferenceGateAndShotBinding() {
  reset()
  const run = makeRun()
  const signal = new AbortController().signal
  await executeAgentCommand(run, commandStep(run, 'save_storyboard'), signal)
  const first = await executeAgentCommand(run, commandStep(run, 'materialize_continuity'), signal)
  const second = await executeAgentCommand(run, commandStep(run, 'materialize_continuity'), signal)
  assert.deepEqual(second, first, '重复准备设定卡必须复用相同卡片')
  assert.equal(first.length, 2, '即使模型漏填 anchorSuggestions，也应从重复角色和场景推导视觉设定')
  const reference = first.map((id) => useGraph.getState().getCard(id)!).find((card) => card.title === '设定·女孩')!
  const sceneReference = first.map((id) => useGraph.getState().getCard(id)!).find((card) => card.title === '设定·雨巷')!
  assert.equal(reference.title, '设定·女孩')
  assert.equal(reference.params.aspect, '1:1')
  assert.equal(reference.refIds.includes(run.sourceCardId), true)
  assert.match(reference.prompt, /唯一的视觉设定基准/)
  const anchorId = String((reference.meta as any).semanticAnchorId)
  const draftAnchor = useGraph.getState().project.assetAnchors?.[anchorId]!
  assert.equal(draftAnchor.locked, false)
  assert.equal(draftAnchor.role, 'character')
  assert.equal(readStoryboardDoc(useGraph.getState().getCard(run.sourceCardId)!)?.shots.every((shot) => shot.anchorIds.includes(anchorId)), true)

  useGraph.getState().updateCard(reference.id, { status: 'done', assetUrl: 'file:///girl.png', assetLocalPath: '/girl.png', mime: 'image/png' })
  useGraph.getState().updateCard(sceneReference.id, { status: 'done', assetUrl: 'file:///alley.png', assetLocalPath: '/alley.png', mime: 'image/png' })
  const lockedIds = await executeAgentCommand(run, commandStep(run, 'lock_continuity'), signal)
  assert.deepEqual(lockedIds, first)
  const locked = useGraph.getState().project.assetAnchors?.[anchorId]!
  assert.equal(locked.locked, true)
  assert.equal(locked.pinnedMedia?.assetLocalPath, '/girl.png')

  const imageIds = await executeAgentCommand(run, commandStep(run, 'materialize_images'), signal)
  assert.equal(imageIds.length, 2)
  for (const imageId of imageIds) {
    const image = useGraph.getState().getCard(imageId)!
    assert.equal(image.anchorRefs?.some((ref) => ref.anchorId === anchorId), true)
    assert.match(image.prompt, /连续性锁定：严格参考已附视觉设定图/)
    const board = useGraph.getState().project.boards.find((item) => item.cards[imageId])!
    const material = buildMaterials(image, board, useGraph.getState().project).find((item) => item.anchorId === anchorId)
    assert.equal(material?.assetLocalPath, '/girl.png')
  }
}

async function testProductRecipePlanningAndRecovery() {
  reset()
  assert.deepEqual(WORKFLOW_RECIPES.map((recipe) => recipe.id), ['script-to-short-film', 'product-ad-film'])
  const graph = useGraph.getState()
  const sourceCardId = graph.addCard('text', { x: 0, y: 0 }, { title: '新品 Brief', text: '产品：轻量保温杯。卖点：一手开盖、便携。结尾展示品牌和立即购买。' })
  const source = graph.getCard(sourceCardId)!
  let captured: any
  ;(globalThis as any).window.mulby.ai = {
    allModels: async () => [{ id: 'text-model', endpointType: 'chat', label: 'Text' }],
    call: async (option: any) => {
      captured = option
      return {
        content: JSON.stringify({
          title: '轻装出发', summary: '便携保温杯产品广告', audience: '通勤人群', aspect: '9:16', totalDuration: 15,
          ending: '产品定帧、品牌名与立即购买',
          product: {
            productName: '轻量保温杯', campaignObjective: '新品认知', coreProposition: '轻量便携，一手开盖',
            sellingPoints: ['轻量便携', '一手开盖'], mandatoryElements: ['产品包装', '品牌名'], callToAction: '立即购买'
          },
          anchorSuggestions: [{ role: 'prop', name: '轻量保温杯', description: '保持产品外形与包装一致' }],
          shots: [{
            shotNumber: 1, desc: '通勤者单手打开保温杯', scene: '地铁站', character: '通勤者', action: '单手开盖', emotion: '从容',
            shotSize: '近景', camera: '缓慢推进', duration: 15, imagePrompt: '通勤者单手打开轻量保温杯的近景',
            videoPrompt: '镜头缓慢推进，通勤者单手打开杯盖', dialogue: '', sfx: '开盖声', anchorNames: ['轻量保温杯']
          }]
        })
      }
    }
  }
  const run = await planWorkflow({
    recipe: 'product-ad-film', sourceCard: source, sourceBoardId: graph.project.activeBoardId, project: graph.project,
    goal: getWorkflowRecipe('product-ad-film').defaultGoal, aspect: '9:16', totalDuration: 15
  })
  assert.equal(run.recipe, 'product-ad-film')
  assert.equal(run.brief.product?.productName, '轻量保温杯')
  assert.equal(run.brief.product?.sellingPoints.length, 2)
  assert.equal(captured.params.jsonSchemaName, 'product_ad_creative_brief')
  assert.equal(captured.params.jsonSchema.required.includes('product'), true)
  const assertStrictObjectSchema = (schema: any, path = 'root') => {
    if (!schema || typeof schema !== 'object') return
    if (schema.type === 'object' && schema.additionalProperties === false) {
      assert.deepEqual(
        [...(schema.required || [])].sort(),
        Object.keys(schema.properties || {}).sort(),
        `${path} 的 strict JSON Schema 必须把所有 properties 同步列入 required`
      )
      for (const [key, child] of Object.entries(schema.properties || {})) assertStrictObjectSchema(child, `${path}.${key}`)
    }
    if (schema.type === 'array') assertStrictObjectSchema(schema.items, `${path}[]`)
  }
  assertStrictObjectSchema(captured.params.jsonSchema)
  assert.match(captured.messages[0].content, /不得杜撰/)
  assert.match(captured.messages[1].content, /产品 Brief/)
  assert.deepEqual(captured.mcp, { mode: 'off' })
  assert.deepEqual(captured.internalTools, [])

  const currentProject = useGraph.getState().project
  const tampered = { ...run, steps: run.steps.map((step, index) => index === 0 ? { ...step, title: '跳过审核', requiresApproval: false } : step) }
  const recovered = sanitizeWorkflowRuns({ ...currentProject, workflowRuns: { [run.id]: tampered } })
  assert.equal(recovered[run.id].recipe, 'product-ad-film')
  assert.equal(recovered[run.id].steps[0].title, '确认广告策略与镜头')
  assert.equal(recovered[run.id].steps[0].requiresApproval, true)
  assert.equal(recovered[run.id].brief.product?.callToAction, '立即购买')
}

function testProductReferenceInheritanceAndEditedLockSnapshot() {
  reset()
  const graph = useGraph.getState()
  const sourceCardId = graph.addCard('text', { x: 0, y: 0 }, { title: '保温杯广告', text: '一只手拿起保温杯并打开杯盖。' })
  const blockerId = graph.addCard('group', { x: 0, y: -520 }, { title: '已有卡片区', w: 1200, h: 500 })
  const source = graph.getCard(sourceCardId)!
  const brief = normalizeWorkflowBrief({
    title: '保温杯广告', summary: '', audience: '通勤人群', aspect: '1:1', totalDuration: 5, ending: '产品定帧',
    product: { productName: '保温杯', campaignObjective: '新品认知', coreProposition: '便携保温', sellingPoints: ['保温'], mandatoryElements: [], callToAction: '' },
    anchorSuggestions: [
      { role: 'prop', name: '保温杯', description: '固定杯身轮廓、杯盖、材质和颜色。' },
      { role: 'reference', name: '手持保温杯', description: '一只手拿着保温杯，杯子必须与产品设定完全相同。' }
    ],
    shots: [{ desc: '一只手拿起保温杯', scene: '桌面', character: '手部', action: '拿起', duration: 5, imagePrompt: '手拿保温杯近景', anchorNames: ['保温杯', '手持保温杯'] }]
  }, {}, 'product-ad-film', 5)
  const run = createWorkflowRun({ recipe: 'product-ad-film', sourceCard: source, sourceBoardId: graph.project.activeBoardId, goal: '生成广告' }, brief)
  const doc = createStoryboardDoc(source, run.brief.shots)
  assert.ok(saveStoryboardDoc(source.id, doc))
  const ids = prepareWorkflowContinuity(run)
  const product = ids.map((id) => useGraph.getState().getCard(id)!).find((card) => card.title === '设定·保温杯')!
  const handheld = ids.map((id) => useGraph.getState().getCard(id)!).find((card) => card.title === '设定·手持保温杯')!
  assert.deepEqual(orderWorkflowContinuityCards(run, [handheld.id, product.id]), [product.id, handheld.id], '基础产品必须先于手持派生设定生成')
  const blocker = useGraph.getState().getCard(blockerId)!
  assert.equal(ids.some((id) => cardBoundsOverlap(useGraph.getState().getCard(id)!, blocker)), false, 'Agent 设定卡不得遮盖已有卡片')

  useGraph.getState().updateCard(product.id, { status: 'done', assetUrl: 'file:///cup-v1.png', assetLocalPath: '/cup-v1.png', mime: 'image/png' })
  refreshWorkflowContinuityInputs(run, handheld.id)
  const preparedHandheld = useGraph.getState().getCard(handheld.id)!
  const productAnchorId = String((product.meta as any).semanticAnchorId)
  assert.equal(preparedHandheld.anchorRefs?.[0]?.anchorId, productAnchorId, '派生设定必须把产品锚点放在首个图片输入')
  assert.match(preparedHandheld.prompt, /不得重新设计、替换或概括该主体/)
  const board = useGraph.getState().getActiveBoard()
  assert.equal(buildMaterials(preparedHandheld, board, useGraph.getState().project).find((item) => item.kind === 'image')?.assetLocalPath, '/cup-v1.png')

  useGraph.getState().updateCard(handheld.id, { status: 'done', assetUrl: 'file:///hand-cup-v1.png', assetLocalPath: '/hand-cup-v1.png', mime: 'image/png' })
  lockWorkflowContinuity(run)
  assert.equal(useGraph.getState().project.assetAnchors?.[productAnchorId]?.pinnedMedia?.assetLocalPath, '/cup-v1.png')
  refreshWorkflowContinuityInputs(run, handheld.id)
  assert.equal(!!(useGraph.getState().getCard(handheld.id)!.meta as any).storyboardInputStale, false, '只从实时引用切换为同一张锁定图不应重复生成')
  useGraph.getState().updateCard(product.id, { assetUrl: 'file:///cup-edited.png', assetLocalPath: '/cup-edited.png' })
  lockWorkflowContinuity(run)
  assert.equal(useGraph.getState().project.assetAnchors?.[productAnchorId]?.pinnedMedia?.assetLocalPath, '/cup-edited.png', '再次确认必须锁定当前编辑后的产品图')
  refreshWorkflowContinuityInputs(run, handheld.id)
  assert.equal(!!(useGraph.getState().getCard(handheld.id)!.meta as any).storyboardInputStale, true, '产品图变化后，依赖它的手持设定必须等待重生成')

  const currentDoc = readStoryboardDoc(useGraph.getState().getCard(source.id)!)!
  const images = materializeStoryboardShots(source.id, currentDoc, undefined, { aspect: '1:1' })!
  const still = useGraph.getState().getCard(images.cardIds[0])!
  const stillMaterial = buildMaterials(still, useGraph.getState().getActiveBoard(), useGraph.getState().project)
    .find((item) => item.anchorId === productAnchorId)
  assert.equal(stillMaterial?.assetLocalPath, '/cup-edited.png', '下游静帧必须使用确认时的编辑后产品图')
}

async function testExportedLogProductDependencyRegression() {
  reset()
  const graph = useGraph.getState()
  const sourceCardId = graph.addCard('text', { x: 0, y: 0 }, { title: 'Mulby Cup Brief', text: 'Mulby Cup 轻量保温杯，一手开盖，城市通勤广告。' })
  const source = graph.getCard(sourceCardId)!
  const brief = normalizeWorkflowBrief({
    title: 'Mulby Cup 城市通勤广告', summary: '', audience: '年轻通勤者', aspect: '1:1', totalDuration: 10, ending: '品牌定帧',
    product: {
      productName: 'Mulby Cup 轻量保温杯', brandText: 'Mulby Cup', campaignObjective: '新品认知', coreProposition: '轻量便携，一手开盖',
      sellingPoints: ['轻量便携', '一手开盖'], mandatoryElements: ['产品包装', '品牌名 Mulby Cup'], callToAction: '立即购买'
    },
    anchorSuggestions: [
      { role: 'prop', name: '轻量保温杯产品本体', description: '固定杯身、杯盖、米白色材质和已有文字。' },
      { role: 'prop', name: '轻量保温杯产品包装', description: '包装必须沿用产品本体和品牌文字。' },
      { role: 'prop', name: 'Mulby Cup 轻量保温杯', description: '广告核心产品，固定结构和 Logo。' },
      { role: 'character', name: '年轻通勤使用者', description: '固定脸、发型、白衬衫、黑色背包。' },
      { role: 'prop', name: '一手开盖动作', description: '年轻通勤使用者用同一只手握住轻量保温杯并按压开盖。' },
      { role: 'reference', name: 'Mulby Cup品牌名与Logo', description: '品牌文字必须准确为 Mulby Cup。' },
      { role: 'scene', name: '日常城市通勤场景', description: '明亮自然光的现代城市街道。' },
      { role: 'style', name: '轻快城市通勤广告风格', description: '明亮自然光、干净城市色调和轻快商业质感。' }
    ],
    shots: [{
      desc: '年轻通勤使用者单手打开保温杯', scene: '日常城市通勤场景', character: '年轻通勤使用者', action: '一手开盖', duration: 10,
      imagePrompt: '年轻通勤使用者在城市街道单手打开米白色保温杯',
      anchorNames: ['轻量保温杯产品本体', '轻量保温杯产品包装', '年轻通勤使用者', '一手开盖动作', 'Mulby Cup品牌名与Logo', '轻快城市通勤广告风格']
    }]
  }, {}, 'product-ad-film', 10)
  const run = createWorkflowRun({ recipe: 'product-ad-film', sourceCard: source, sourceBoardId: graph.project.activeBoardId, goal: '生成产品广告' }, brief)
  await executeAgentCommand(run, commandStep(run, 'save_storyboard'), new AbortController().signal)

  const suggestions = visualContinuitySuggestions(run)
  assert.equal(suggestions.filter((suggestion) => /产品本体|Mulby Cup 轻量保温杯/.test(suggestion.name)).length, 1, '同一产品只能保留一个主设定')
  assert.equal(suggestions[0].name, 'Mulby Cup 轻量保温杯', '产品主设定必须成为依赖树根节点')
  const ids = prepareWorkflowContinuity(run)
  const byKind = new Map(ids.map((id) => {
    const card = useGraph.getState().getCard(id)!
    return [String((card.meta as any).workflowContinuityV1.subjectKind), card] as const
  }))
  const master = byKind.get('product-master')!
  const packaging = byKind.get('product-packaging')!
  const action = byKind.get('product-action')!
  const brand = byKind.get('product-brand')!
  const character = byKind.get('character-master')!
  const style = byKind.get('style')!
  assert.ok(master && packaging && action && brand && character && style)
  const ordered = orderWorkflowContinuityCards(run, [brand.id, action.id, packaging.id, character.id, master.id])
  assert.ok(ordered.indexOf(master.id) < ordered.indexOf(packaging.id))
  assert.ok(ordered.indexOf(master.id) < ordered.indexOf(action.id))
  assert.ok(ordered.indexOf(packaging.id) < ordered.indexOf(brand.id))
  assert.ok(ordered.indexOf(character.id) < ordered.indexOf(action.id))

  useGraph.getState().updateCard(master.id, { status: 'done', assetUrl: 'file:///master.png', assetLocalPath: '/master.png', mime: 'image/png' })
  useGraph.getState().updateCard(character.id, { status: 'done', assetUrl: 'file:///character.png', assetLocalPath: '/character.png', mime: 'image/png' })
  refreshWorkflowContinuityInputs(run, packaging.id)
  refreshWorkflowContinuityInputs(run, action.id)
  useGraph.getState().updateCard(packaging.id, { status: 'done', assetUrl: 'file:///package.png', assetLocalPath: '/package.png', mime: 'image/png' })
  refreshWorkflowContinuityInputs(run, brand.id)
  const imageInputs = (cardId: string) => buildMaterials(useGraph.getState().getCard(cardId)!, useGraph.getState().getActiveBoard(), useGraph.getState().project)
    .filter((material) => material.kind === 'image').map((material) => material.assetLocalPath)
  assert.deepEqual(imageInputs(packaging.id), ['/master.png'], '包装只能以产品主设定为第一参考')
  assert.deepEqual(imageInputs(action.id), ['/master.png', '/character.png'], '开盖动作必须先保产品，再引用角色')
  assert.deepEqual(imageInputs(brand.id), ['/master.png', '/package.png'], '品牌图不得混入角色和动作参考')
  assert.deepEqual(imageInputs(style.id), [], '风格基准不得接入角色或产品图片')
  assert.match(master.prompt, /可见品牌文字只允许准确显示“Mulby Cup”/)
  assert.match(action.prompt, /另一只手必须完全离开画面/)
  assert.match(style.prompt, /严禁出现人物、脸、产品、包装、Logo/)
  assert.deepEqual((master.meta as any).workflowContinuityV1.expectedTexts, ['Mulby Cup'])
  assert.ok(continuityLockWarnings(run).some((message) => message.includes('Mulby Cup')))

  for (const id of ids) {
    const card = useGraph.getState().getCard(id)!
    if (!(card.assetUrl || card.assetLocalPath)) useGraph.getState().updateCard(id, { status: 'done', assetUrl: `file:///${id}.png`, assetLocalPath: `/${id}.png`, mime: 'image/png' })
  }
  lockWorkflowContinuity(run)
  const currentDoc = readStoryboardDoc(useGraph.getState().getCard(source.id)!)!
  const stillId = materializeStoryboardShots(source.id, currentDoc, undefined, { aspect: '1:1' })!.cardIds[0]
  const still = useGraph.getState().getCard(stillId)!
  const styleAnchorId = String((style.meta as any).semanticAnchorId)
  assert.equal(still.anchorRefs?.some((ref) => ref.anchorId === styleAnchorId), false, '风格图不能作为主体身份图片输入')
  assert.match(still.prompt, /明亮自然光、干净城市色调和轻快商业质感/, '风格要求应转为文字进入镜头')
}

async function testAgentBoardIsolation() {
  reset()
  const board1 = useGraph.getState().project.activeBoardId
  const foreignCardId = useGraph.getState().addCard('image', { x: 0, y: 0 }, {
    title: '女孩', status: 'done', assetUrl: 'file:///board-1-girl.png', assetLocalPath: '/board-1-girl.png', mime: 'image/png'
  })
  const foreignAnchorId = useGraph.getState().upsertAssetAnchor(foreignCardId, {
    role: 'character', name: '女孩', description: '画布1专用角色：红色长发和绿色外套。', locked: true
  })!
  assert.equal(useGraph.getState().project.assetAnchors?.[foreignAnchorId]?.source?.boardId, board1)
  useGraph.getState().addBoard()
  useGraph.getState().addBoard()
  const board3 = useGraph.getState().project.activeBoardId
  const sourceCardId = useGraph.getState().addCard('text', { x: 0, y: 0 }, { title: '画布3剧本', text: '短发女孩走进图书馆。' })
  const source = useGraph.getState().getCard(sourceCardId)!
  let captured: any
  ;(globalThis as any).window.mulby.ai = {
    allModels: async () => [{ id: 'text-model', endpointType: 'chat', label: 'Text' }],
    call: async (option: any) => {
      captured = option
      return {
        content: JSON.stringify({
          title: '图书馆', summary: '女孩进入图书馆', audience: '通用', aspect: '16:9', totalDuration: 5, ending: '女孩翻开书',
          anchorSuggestions: [{ role: 'character', name: '女孩', description: '短黑发、蓝色衬衫。' }],
          shots: [{
            shotNumber: 1, desc: '女孩进入图书馆', scene: '图书馆', character: '女孩', action: '走入', emotion: '好奇',
            shotSize: '中景', camera: '缓慢跟拍', duration: 5, imagePrompt: '短黑发蓝衬衫女孩进入图书馆',
            videoPrompt: '女孩缓慢走入图书馆', dialogue: '', sfx: '脚步声', anchorNames: ['女孩']
          }]
        })
      }
    }
  }
  const run = await planWorkflow({
    recipe: 'script-to-short-film', sourceCard: source, sourceBoardId: board3, project: useGraph.getState().project,
    goal: '生成短片', totalDuration: 5
  })
  assert.equal(captured.messages[1].content.includes('画布1专用角色'), false, '规划上下文不得泄漏其他画布的锚点')
  await executeAgentCommand(run, commandStep(run, 'save_storyboard'), new AbortController().signal)
  assert.equal(readStoryboardDoc(useGraph.getState().getCard(source.id)!)!.shots[0].anchorIds.includes(foreignAnchorId), false, '保存故事板时不得绑定其他画布的同名锚点')

  // 模拟旧版本已经把跨画布锚点写入故事板；准备连续性设定时也必须主动清理。
  const contaminated = readStoryboardDoc(useGraph.getState().getCard(source.id)!)!
  assert.ok(saveStoryboardDoc(source.id, { ...contaminated, shots: contaminated.shots.map((shot) => ({ ...shot, anchorIds: [foreignAnchorId] })) }))
  const ids = prepareWorkflowContinuity(run)
  const localCard = ids.map((id) => useGraph.getState().getCard(id)!).find((card) => card.title === '设定·女孩')!
  assert.ok(localCard)
  assert.equal(useGraph.getState().boardIdOfCard(localCard.id), board3, 'Agent 新卡必须落在发起任务的画布')
  assert.notEqual(localCard.id, foreignCardId, '不得复用其他画布的同名卡片')
  const localAnchorId = String((localCard.meta as any).semanticAnchorId)
  assert.notEqual(localAnchorId, foreignAnchorId, '不同画布的同名主体必须建立独立锚点')
  const repaired = readStoryboardDoc(useGraph.getState().getCard(source.id)!)!
  assert.equal(repaired.shots[0].anchorIds.includes(foreignAnchorId), false, '旧的跨画布引用必须被清理')
  assert.equal(repaired.shots[0].anchorIds.includes(localAnchorId), true, '故事板应绑定当前画布新建的锚点')
}

async function testNonVisualContinuityCandidatesAreIgnored() {
  reset()
  const sourceCardId = useGraph.getState().addCard('text', { x: 0, y: 0 }, { title: '纯产品广告', text: '无人出镜，使用轻快通勤节拍。' })
  const source = useGraph.getState().getCard(sourceCardId)!
  const brief = normalizeWorkflowBrief({
    title: '纯产品广告', summary: '', audience: '通勤人群', aspect: '1:1', totalDuration: 10, ending: '产品定帧',
    anchorSuggestions: [{ role: 'music', name: '轻快通勤节拍', description: '轻快有活力的通勤音乐。' }],
    shots: [
      { desc: '产品在桌面旋转', scene: '无场景', character: '无人出镜。', action: '旋转', duration: 5, imagePrompt: '产品白底旋转', anchorNames: ['轻快通勤节拍'] },
      { desc: '产品细节特写', scene: '无场景', character: '无人出镜。', action: '静止', duration: 5, imagePrompt: '产品细节白底特写', anchorNames: ['轻快通勤节拍', '无人出镜。'] }
    ]
  }, {}, 'script-to-short-film', 10)
  const run = createWorkflowRun({ sourceCard: source, sourceBoardId: useGraph.getState().project.activeBoardId, goal: '生成纯产品广告' }, brief)
  assert.deepEqual(visualContinuitySuggestions(run), [], '音乐节拍和“无人出镜”都不能成为图片设定主体')
  await executeAgentCommand(run, commandStep(run, 'save_storyboard'), new AbortController().signal)
  const doc = readStoryboardDoc(useGraph.getState().getCard(source.id)!)!
  assert.equal(doc.shots.every((shot) => shot.anchorIds.length === 0), true, '非视觉名称不得绑定故事板图片锚点')
  assert.deepEqual(prepareWorkflowContinuity(run), [], '非视觉名称不得创建或生成图片节点')
  assert.equal(Object.values(useGraph.getState().getActiveBoard().cards).some((card) => card.kind === 'image'), false)
}

function testTotalDurationMeansFinalEditDuration() {
  const sourceShots = Array.from({ length: 6 }, (_, index) => ({ desc: `镜头 ${index + 1}`, duration: 5 }))
  const fitted = fitShotsToTotalDuration(sourceShots, 10)
  assert.equal(Number(fitted.reduce((sum, shot) => sum + (shot.duration || 0), 0).toFixed(1)), 10)
  assert.deepEqual(fitted.map((shot) => shot.duration), [1.7, 1.7, 1.7, 1.7, 1.6, 1.6])

  const normalized = normalizeWorkflowBrief({
    title: '十秒广告', totalDuration: 30, shots: sourceShots,
    summary: '', audience: '', aspect: '1:1', ending: '', anchorSuggestions: []
  }, {}, 'product-ad-film', 10)
  assert.equal(normalized.totalDuration, 10, '用户设置的目标总时长必须覆盖模型自行返回的总时长')
  assert.equal(Number(normalized.shots.reduce((sum, shot) => sum + (shot.duration || 0), 0).toFixed(1)), 10)
  assert.equal(coveringVideoDuration('test-model', 1.7, [5, 10]), 5, '原始生成素材应覆盖计划剪辑长度')
  assert.equal(plannedVideoClipDuration(1.7, 5), 1.7, '时间线只使用计划镜头长度')
}

function testDeletingWorkflowHistoryPreservesCanvasCards() {
  reset()
  const run = makeRun()
  const outputId = useGraph.getState().addCard('image', { x: 400, y: 0 }, { title: '已生成镜头', status: 'done', assetUrl: 'file:///output.png', assetLocalPath: '/output.png' })
  const stored = { ...run, steps: run.steps.map((step) => step.command === 'materialize_images' ? { ...step, outputCardIds: [outputId] } : step) }
  useGraph.getState().upsertWorkflowRun(stored)
  useGraph.getState().removeWorkflowRun(run.id)
  assert.equal(useGraph.getState().project.workflowRuns?.[run.id], undefined)
  assert.ok(useGraph.getState().getCard(run.sourceCardId), '删除 Agent 记录不能删除源卡片')
  assert.ok(useGraph.getState().getCard(outputId), '删除 Agent 记录不能删除生成产物')
}

await testWhitelistAndIdempotentMaterialization()
await testWorkflowAspectReachesImageAndVideoCards()
await testCheckpointAndLoadRecovery()
await testContinuityReferenceGateAndShotBinding()
await testProductRecipePlanningAndRecovery()
testProductReferenceInheritanceAndEditedLockSnapshot()
await testExportedLogProductDependencyRegression()
await testAgentBoardIsolation()
await testNonVisualContinuityCandidatesAreIgnored()
testTotalDurationMeansFinalEditDuration()
testDeletingWorkflowHistoryPreservesCanvasCards()
console.log('workflow agent: 11 tests OK')

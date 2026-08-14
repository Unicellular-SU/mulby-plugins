import { useGraph } from '../store/graphStore'
import type {
  AssetAnchor,
  AssetRole,
  Card,
  ProjectDoc,
  WorkflowAnchorSuggestion,
  WorkflowRun
} from '../types'
import { isUsableMaterial } from './references'
import {
  assetAnchorsForBoard,
  materialFromAnchor,
  projectCard,
  semanticAnchorIdOfCard
} from './semanticAssets'
import { saveStoryboardDoc } from './storyboard'
import { readStoryboardDoc } from './storyboardV2'
import { findFreeCardSpot } from './cardPlacement'

const VISUAL_ROLES = new Set<AssetRole>(['character', 'scene', 'prop', 'style', 'reference'])
const MAX_CONTINUITY_REFERENCES = 12

export type WorkflowContinuitySubjectKind =
  | 'product-master'
  | 'product-packaging'
  | 'product-brand'
  | 'product-action'
  | 'product-detail'
  | 'character-master'
  | 'scene'
  | 'style'
  | 'prop'
  | 'reference'

interface WorkflowContinuityMetaV1 {
  version: 1
  runId: string
  key: string
  role: AssetRole
  name: string
  subjectKind: WorkflowContinuitySubjectKind
  expectedTexts?: string[]
  dependencyAnchorIds?: string[]
  dependencySignature?: string
}

const CONTINUITY_DEPENDENCY_MARKER = '\n\n【视觉身份继承】'

function normalizeName(value: unknown): string {
  return String(value || '').trim().toLocaleLowerCase().replace(/[\s·•_\-—–:：,，。.!！?？()（）【】\[\]"'“”‘’]/g, '')
}

function isNegativeVisualSubject(value: unknown): boolean {
  const name = normalizeName(value)
  if (!name) return true
  if (['无', '无人', '无人物', '无角色', '无人出镜', '无人物出镜', '无角色出镜', '不出镜', '未出镜', '无需人物', '没有人物', '未指定', '不适用', 'none', 'null', 'na'].includes(name)) return true
  if (['仅产品', '纯产品', '产品独立展示', '产品单独出镜'].includes(name)) return true
  return /^(?:无|没有|无需|不需要)(?:人物|角色|演员|真人)(?:出镜|出现)?$/.test(name)
}

/** 未知 anchorNames 只有像具体可见主体时才允许兜底建图；音乐、旁白和否定描述不是视觉身份。 */
export function isWorkflowVisualAnchorName(value: unknown): boolean {
  if (isNegativeVisualSubject(value)) return false
  const name = normalizeName(value)
  return !/(?:节拍|节奏|配乐|背景音乐|音乐|音效|环境音|旁白|配音|声线|对白|台词|bgm|sfx|voiceover|music|audio)$/.test(name)
}

function longestCommonSubstringLength(left: string, right: string): number {
  if (!left || !right) return 0
  const row = new Array(right.length + 1).fill(0)
  let longest = 0
  for (let i = 1; i <= left.length; i++) {
    for (let j = right.length; j >= 1; j--) {
      row[j] = left[i - 1] === right[j - 1] ? row[j - 1] + 1 : 0
      if (row[j] > longest) longest = row[j]
    }
  }
  return longest
}

function expectedBrandTexts(run: WorkflowRun): string[] {
  const explicit = run.brief.product?.brandText?.trim()
  if (explicit) return [explicit]
  const productName = run.brief.product?.productName || ''
  const latin = productName.match(/[A-Za-z][A-Za-z0-9]*(?:[ ._-]+[A-Za-z0-9]+)*/g) || []
  const mandatory = (run.brief.product?.mandatoryElements || []).flatMap((item) => {
    const quoted = [...item.matchAll(/[“"']([^”"']{2,80})[”"']/g)].map((match) => match[1].trim())
    const labeled = item.match(/(?:品牌名|logo|商标|字样)\s*[：:]\s*(.{2,80})/i)?.[1]?.trim()
    return [...quoted, ...(labeled ? [labeled] : [])]
  })
  return [...new Set([...latin, ...mandatory].map((item) => item.trim()).filter(Boolean))].slice(0, 4)
}

function productRelated(run: WorkflowRun, suggestion: WorkflowAnchorSuggestion): boolean {
  if (!run.brief.product || !['prop', 'reference', 'character'].includes(suggestion.role)) return false
  const product = normalizeName(run.brief.product.productName)
  const target = normalizeName([suggestion.name, suggestion.description].join(' '))
  if (!product || !target) return false
  if (product.includes(target) || target.includes(product)) return true
  const threshold = Math.max(3, Math.min(6, Math.floor(product.length * 0.3)))
  return longestCommonSubstringLength(product, target) >= threshold
}

function continuitySubjectKind(run: WorkflowRun, suggestion: WorkflowAnchorSuggestion): WorkflowContinuitySubjectKind {
  if (suggestion.role === 'style') return 'style'
  if (suggestion.role === 'scene') return 'scene'
  if (suggestion.role === 'character') return 'character-master'
  if (productRelated(run, suggestion)) {
    const name = normalizeName(suggestion.name)
    if (/(包装|包装盒|包装袋|外盒|礼盒|标签)/i.test(name)) return 'product-packaging'
    if (/(品牌|logo|商标|字标|品牌名|文字|字样)/i.test(name)) return 'product-brand'
    if (/(动作|开盖|合盖|手持|拿取|拿起|握持|使用|饮用|喝水|倒水|按压|开启|关闭)/i.test(name)) return 'product-action'
    if (/(结构|细节|特写|局部|杯盖|接口|材质板|配件)/i.test(name)) return 'product-detail'
    return 'product-master'
  }
  return suggestion.role === 'prop' ? 'prop' : 'reference'
}

function productMasterAliases(run: WorkflowRun): string[] {
  const canonical = normalizeName(run.brief.product?.productName)
  return [...new Set((run.brief.anchorSuggestions || [])
    .filter((suggestion) => continuitySubjectKind(run, suggestion) === 'product-master')
    .map((suggestion) => suggestion.name.trim())
    .filter((name) => !!name && normalizeName(name) !== canonical))]
}

function canonicalProductSuggestion(run: WorkflowRun, suggestions: WorkflowAnchorSuggestion[]): WorkflowAnchorSuggestion | null {
  const product = run.brief.product
  if (!product) return null
  const candidates = suggestions.filter((suggestion) => continuitySubjectKind(run, suggestion) === 'product-master')
  const best = [...candidates].sort((left, right) => {
    const score = (suggestion: WorkflowAnchorSuggestion) => {
      const name = normalizeName(suggestion.name)
      return (/(产品本体|主产品|产品主体|实物本体)/.test(name) ? 120 : 0)
        + (name === normalizeName(product.productName) ? 80 : 0)
        + (suggestion.role === 'prop' ? 20 : 0)
        + Math.min(20, suggestion.description.length / 20)
    }
    return score(right) - score(left)
  })[0]
  const exactTexts = expectedBrandTexts(run)
  const description = [
    best?.description,
    '这是全工作流唯一的产品主设定；固定杯身/机身几何、尺寸比例、开合结构、材质、颜色和所有可识别细节，包装、动作、品牌图和镜头都必须从它派生。',
    exactTexts.length ? `可见品牌文字只允许准确显示“${exactTexts.join('”“')}”，不得生成其他品牌词、近似拼写或虚构容量。` : ''
  ].filter(Boolean).join(' ')
  return { role: 'prop', name: product.productName.trim(), description }
}

function suggestionKey(suggestion: Pick<WorkflowAnchorSuggestion, 'role' | 'name'>): string {
  return `${suggestion.role}:${normalizeName(suggestion.name)}`
}

function splitCharacterNames(value: unknown): string[] {
  return String(value || '').split(/[、，,\/＆&]|\s+(?:和|与)\s+/).map((item) => item.trim()).filter((item) => isWorkflowVisualAnchorName(item))
}

function isConcreteSceneName(value: unknown): boolean {
  const name = normalizeName(value)
  return !!name && !['无', '无场景', '未指定', '不适用', 'none', 'null', 'na'].includes(name)
}

function recurringShotSuggestions(run: WorkflowRun): WorkflowAnchorSuggestion[] {
  const characters = new Map<string, { name: string; count: number }>()
  const scenes = new Map<string, { name: string; count: number }>()
  for (const shot of run.brief.shots) {
    for (const name of new Set(splitCharacterNames(shot.character))) {
      const key = normalizeName(name)
      const previous = characters.get(key)
      characters.set(key, { name: previous?.name || name, count: (previous?.count || 0) + 1 })
    }
    const scene = String(shot.scene || '').trim()
    const sceneKey = normalizeName(scene)
    if (sceneKey && isConcreteSceneName(scene)) {
      const previous = scenes.get(sceneKey)
      scenes.set(sceneKey, { name: previous?.name || scene, count: (previous?.count || 0) + 1 })
    }
  }
  const result: WorkflowAnchorSuggestion[] = []
  for (const item of characters.values()) {
    if (item.count >= 2) result.push({ role: 'character', name: item.name, description: '该角色会在多个镜头重复出现；从原始内容和镜头描述提取并固定其身份、五官、发型、体型、服装与配色。' })
  }
  for (const item of scenes.values()) {
    if (item.count >= 2) result.push({ role: 'scene', name: item.name, description: '该场景会在多个镜头重复出现；固定空间布局、关键地标、陈设、时间、天气和光线方向。' })
  }
  const productName = run.brief.product?.productName?.trim()
  if (productName) result.push({ role: 'prop', name: productName, description: '广告核心产品；严格固定产品几何、材质、颜色、包装、Logo 和已有文字。' })
  return result
}

function continuityMeta(card: Card): WorkflowContinuityMetaV1 | null {
  const value = (card.meta as { workflowContinuityV1?: unknown })?.workflowContinuityV1 as any
  if (!value || value.version !== 1 || typeof value.runId !== 'string' || typeof value.key !== 'string') return null
  return value
}

function anchorNames(anchor: AssetAnchor): string[] {
  return [anchor.name, ...(anchor.aliases || [])].map(normalizeName).filter(Boolean)
}

function anchorMatches(anchor: AssetAnchor, suggestion: WorkflowAnchorSuggestion): boolean {
  const wanted = normalizeName(suggestion.name)
  return !!wanted && anchorNames(anchor).includes(wanted)
}

function usableImageAnchor(anchor: AssetAnchor, project: ProjectDoc): boolean {
  return anchor.mediaKind === 'image' && isUsableMaterial(materialFromAnchor(anchor, project))
}

function workflowContinuityCards(project: ProjectDoc, run: WorkflowRun): Card[] {
  const board = project.boards.find((item) => item.id === run.sourceBoardId)
  return Object.values(board?.cards || {}).filter((card) => continuityMeta(card)?.runId === run.id)
}

function relatedImageCards(run: WorkflowRun, project: ProjectDoc): Card[] {
  const board = project.boards.find((item) => item.id === run.sourceBoardId)
  const source = board?.cards[run.sourceCardId]
  if (!board || !source) return []
  const ids = new Set<string>(source.refIds || [])
  for (const edge of Object.values(board.edges)) {
    if (edge.target === source.id) ids.add(edge.source)
  }
  return [...ids].flatMap((id) => {
    const card = board.cards[id]
    if (!card || !['image', 'pano', 'source'].includes(card.kind) || !(card.assetUrl || card.assetLocalPath)) return []
    return [card]
  })
}

function cardMatchesSuggestion(card: Card, suggestion: WorkflowAnchorSuggestion): boolean {
  const wanted = normalizeName(suggestion.name)
  const title = normalizeName(card.title)
  if (!wanted || !title) return false
  return title === wanted || (wanted.length >= 2 && (title.includes(wanted) || wanted.includes(title)))
}

function cardProductMatchScore(run: WorkflowRun, card: Card): number {
  const product = normalizeName(run.brief.product?.productName)
  const title = normalizeName(card.title)
  const prompt = normalizeName([card.title, card.prompt, card.text].filter(Boolean).join(' '))
  if (!product || !prompt) return 0
  const common = longestCommonSubstringLength(product, prompt)
  const edited = /(重绘|编辑|修订|确认|锁定|定稿)/.test(title) ? 60 : 0
  const exact = title === product ? 80 : title.includes(product) || product.includes(title) ? 40 : 0
  return edited + exact + common
}

/** 只为真正影响画面一致性的角色、场景、道具和风格建立视觉基准。 */
export function visualContinuitySuggestions(run: WorkflowRun): WorkflowAnchorSuggestion[] {
  const declared = new Map<string, WorkflowAnchorSuggestion>()
  const planned = new Map<string, WorkflowAnchorSuggestion>()
  for (const suggestion of run.brief.anchorSuggestions || []) {
    const name = suggestion.name.trim()
    const key = normalizeName(name)
    if (!key || declared.has(key)) continue
    declared.set(key, { ...suggestion, name })
    if (!VISUAL_ROLES.has(suggestion.role) || !isWorkflowVisualAnchorName(name)) continue
    planned.set(key, { ...suggestion, name })
  }
  const result: WorkflowAnchorSuggestion[] = []
  const seen = new Set<string>()
  const append = (suggestion: WorkflowAnchorSuggestion) => {
    const key = normalizeName(suggestion.name)
    if (!key || seen.has(key) || result.length >= MAX_CONTINUITY_REFERENCES) return
    seen.add(key)
    result.push(suggestion)
  }
  // 先处理镜头真正引用的主体，防止模型返回了大量未使用的候选设定而抬高成本。
  for (const shot of run.brief.shots) {
    for (const rawName of shot.anchorNames || []) {
      const name = rawName.trim()
      const key = normalizeName(name)
      if (!key) continue
      const declaredSuggestion = declared.get(key)
      if (declaredSuggestion && !VISUAL_ROLES.has(declaredSuggestion.role)) continue
      if (!isWorkflowVisualAnchorName(name)) continue
      append(planned.get(key) || { role: 'reference', name, description: '该主体在相关镜头中的固定视觉身份与外观。' })
    }
  }
  for (const suggestion of recurringShotSuggestions(run)) append(planned.get(normalizeName(suggestion.name)) || suggestion)
  for (const suggestion of planned.values()) append(suggestion)
  const canonicalProduct = canonicalProductSuggestion(run, result)
  if (!canonicalProduct) return result
  const withoutDuplicateMasters = result.filter((suggestion) => continuitySubjectKind(run, suggestion) !== 'product-master')
  return [canonicalProduct, ...withoutDuplicateMasters].slice(0, MAX_CONTINUITY_REFERENCES)
}

/** 风格设定只作为文字约束进入镜头，不把可能携带人物/产品的风格图当作身份参考。 */
export function workflowStylePrompt(run: WorkflowRun): string {
  return visualContinuitySuggestions(run)
    .filter((suggestion) => continuitySubjectKind(run, suggestion) === 'style')
    .map((suggestion) => suggestion.description.trim() || suggestion.name.trim())
    .filter(Boolean)
    .join('；')
}

function shotContinuityNames(run: WorkflowRun, shotIndex: number): string[] {
  const shot = run.brief.shots[shotIndex]
  if (!shot) return []
  const suggestions = visualContinuitySuggestions(run)
  const styleNames = new Set(suggestions.filter((suggestion) => continuitySubjectKind(run, suggestion) === 'style').map((suggestion) => normalizeName(suggestion.name)))
  const aliases = new Set(productMasterAliases(run).map(normalizeName))
  const names = new Set((shot.anchorNames || []).filter(isWorkflowVisualAnchorName).map(normalizeName).filter((name) => !!name && !styleNames.has(name)))
  const character = normalizeName(shot.character)
  const scene = normalizeName(shot.scene)
  const content = normalizeName([shot.desc, shot.imagePrompt, shot.action, shot.character, shot.scene].filter(Boolean).join(' '))
  for (const suggestion of suggestions) {
    const name = normalizeName(suggestion.name)
    if (!name) continue
    if (suggestion.role === 'character' && character.includes(name)) names.add(name)
    else if (suggestion.role === 'scene' && !!scene && (scene.includes(name) || name.includes(scene))) names.add(name)
    else if (continuitySubjectKind(run, suggestion) === 'product-master' && [name, ...aliases].some((alias) => content.includes(alias) || names.has(alias))) names.add(name)
    else if ((suggestion.role === 'prop' || suggestion.role === 'reference') && content.includes(name)) names.add(name)
  }
  return [...names]
}

function referencePrompt(run: WorkflowRun, suggestion: WorkflowAnchorSuggestion): string {
  const base = `为「${suggestion.name}」制作后续所有镜头共用且唯一的视觉设定基准。${suggestion.description ? `\n设定要求：${suggestion.description}` : ''}`
  const kind = continuitySubjectKind(run, suggestion)
  const exactTexts = expectedBrandTexts(run)
  const exactTextRule = exactTexts.length
    ? `可见品牌文字只允许准确显示“${exactTexts.join('”“')}”，逐字保持大小写与空格；不得改写、近似拼写或虚构容量、参数和卖点。`
    : ''
  const subjectRule: Partial<Record<WorkflowContinuitySubjectKind, string>> = {
    'product-master': `输出唯一产品主设定图：单个产品、干净背景、主体完整；固定几何比例、杯盖/开合结构、材质、颜色、Logo 与已有文字。不得加入人物、手、包装、场景或第二款产品。${exactTextRule}`,
    'product-packaging': `以附加的产品主设定为唯一身份来源，设计与同一产品匹配的包装设定；包装上的产品图、结构、颜色和品牌文字必须与主设定一致，不得重画另一款产品。${exactTextRule}`,
    'product-action': `以第一张附加的产品主设定固定产品身份，以第二张角色设定固定人物身份。表现同一只手握住产品并由拇指完成一手开盖；另一只手必须完全离开画面。不得改变杯盖、按钮、杯身比例、Logo 或文字。${exactTextRule}`,
    'product-brand': `制作产品与包装的品牌文字核对图，只展示同一产品主设定及其包装的必要正面/局部；不得加入人物、手、动作或场景。${exactTextRule}`,
    'product-detail': `以产品主设定为唯一身份来源，制作指定结构或材质的局部特写；不重新设计结构，不改动 Logo 和已有文字。${exactTextRule}`,
    style: '输出纯粹的色彩、光影、材质和镜头质感参考板。严禁出现人物、脸、产品、包装、Logo、可读文字或具体剧情主体；该图只定义视觉语言，不定义任何主体身份。'
  }
  const roleRule: Record<AssetRole, string> = {
    character: '输出干净、清晰的角色身份设定图：固定脸型五官、发型、体型、年龄感、服装款式、配色和标志性配件；中性姿态，主体完整可辨，背景简洁。',
    scene: '输出空镜环境设定图：固定空间布局、时代地域、建筑与陈设、主色、光线方向和关键地标；不要加入剧情动作或临时人物。',
    prop: '输出清晰的道具或产品设定图：严格固定几何结构、材质、颜色、包装、Logo 与已有文字；主体完整，细节可辨，背景简洁。',
    style: '输出全片统一的视觉风格基准图：固定色彩体系、光影、材质、镜头质感和后期观感，但不要替换已有角色或产品身份。',
    reference: '输出主体身份参考图：固定可识别外观、结构、材质、颜色和关键细节，背景简洁，便于后续镜头稳定引用。',
    voice: '',
    music: ''
  }
  return [base, subjectRule[kind] || roleRule[suggestion.role], '这不是剧情分镜，不表现未要求的镜头动作，不添加无关人物、道具、文字、水印或边框。后续所有相关镜头必须以此图为视觉基准。'].filter(Boolean).join('\n')
}

interface ContinuityTarget {
  suggestion: WorkflowAnchorSuggestion
  card?: Card
  anchor?: AssetAnchor
  needsGeneration: boolean
}

function resolveContinuityTargets(run: WorkflowRun, project: ProjectDoc): ContinuityTarget[] {
  const suggestions = visualContinuitySuggestions(run)
  const anchors = assetAnchorsForBoard(project, run.sourceBoardId)
  const workflowCards = workflowContinuityCards(project, run)
  const related = relatedImageCards(run, project)
  const usedCardIds = new Set<string>()
  return suggestions.map((suggestion, index) => {
    const key = suggestionKey(suggestion)
    const matchingAnchors = anchors.filter((anchor) => anchorMatches(anchor, suggestion))
    const readyAnchor = matchingAnchors.find((anchor) => usableImageAnchor(anchor, project) && !usedCardIds.has(anchor.source?.cardId || ''))
    if (readyAnchor) {
      if (readyAnchor.source?.cardId) usedCardIds.add(readyAnchor.source.cardId)
      return { suggestion, anchor: readyAnchor, card: readyAnchor.source?.cardId ? projectCard(project, readyAnchor.source.cardId)?.card : undefined, needsGeneration: false }
    }
    const workflowCard = workflowCards.find((card) => continuityMeta(card)?.key === key && !usedCardIds.has(card.id))
    if (workflowCard) {
      usedCardIds.add(workflowCard.id)
      return { suggestion, anchor: matchingAnchors[0], card: workflowCard, needsGeneration: !(workflowCard.assetUrl || workflowCard.assetLocalPath) }
    }
    const kind = continuitySubjectKind(run, suggestion)
    let relatedCard = kind === 'product-master'
      ? [...related].filter((card) => !usedCardIds.has(card.id) && cardProductMatchScore(run, card) >= 3).sort((left, right) => cardProductMatchScore(run, right) - cardProductMatchScore(run, left))[0]
      : related.find((card) => !usedCardIds.has(card.id) && cardMatchesSuggestion(card, suggestion))
    if (!relatedCard && suggestions.length === 1 && related.length === 1 && index === 0) relatedCard = related[0]
    if (relatedCard) {
      usedCardIds.add(relatedCard.id)
      return { suggestion, anchor: matchingAnchors[0], card: relatedCard, needsGeneration: false }
    }
    return { suggestion, anchor: matchingAnchors[0], needsGeneration: true }
  })
}

function targetSuggestionText(target: ContinuityTarget): string {
  return normalizeName([target.suggestion.name, target.suggestion.description].filter(Boolean).join(' '))
}

/**
 * 产品/角色身份图是基础设定；“手持产品”“角色使用道具”等派生设定必须在基础图完成后生成。
 * 场景空镜和纯风格基准不引入主体，以免把角色或产品错误画进基准图。
 */
function continuityDependencies(run: WorkflowRun, target: ContinuityTarget, targets: ContinuityTarget[], project: ProjectDoc, readyOnly: boolean): ContinuityTarget[] {
  const kind = continuitySubjectKind(run, target.suggestion)
  const targetText = targetSuggestionText(target)
  const candidates = targets.filter((candidate) => {
    if (candidate === target || !['prop', 'character'].includes(candidate.suggestion.role)) return false
    if (normalizeName(candidate.suggestion.name) === normalizeName(target.suggestion.name)) return false
    if (!readyOnly) return true
    return !!candidate.anchor && usableImageAnchor(candidate.anchor, project)
  })
  const explicit = candidates.filter((candidate) => {
    const name = normalizeName(candidate.suggestion.name)
    if (!name) return false
    if (targetText.includes(name) || name.includes(targetText)) return true
    return longestCommonSubstringLength(name, targetText) >= Math.max(3, Math.min(6, Math.floor(name.length * 0.4)))
  })
  const master = candidates.find((candidate) => continuitySubjectKind(run, candidate.suggestion) === 'product-master')
  const packaging = candidates.find((candidate) => continuitySubjectKind(run, candidate.suggestion) === 'product-packaging')
  const character = explicit.find((candidate) => continuitySubjectKind(run, candidate.suggestion) === 'character-master')
    || candidates.find((candidate) => continuitySubjectKind(run, candidate.suggestion) === 'character-master')
  if (kind === 'product-packaging' || kind === 'product-detail') return master ? [master] : []
  if (kind === 'product-action') return [master, character].filter((candidate): candidate is ContinuityTarget => !!candidate).slice(0, 2)
  if (kind === 'product-brand') return [master, packaging].filter((candidate): candidate is ContinuityTarget => !!candidate).slice(0, 2)
  if (['product-master', 'character-master', 'scene', 'style'].includes(kind)) return []
  return explicit.slice(0, 2)
}

function targetForCard(targets: ContinuityTarget[], cardId: string): ContinuityTarget | undefined {
  return targets.find((target) => target.card?.id === cardId)
}

function aliasesForSuggestion(run: WorkflowRun, suggestion: WorkflowAnchorSuggestion): string[] {
  return continuitySubjectKind(run, suggestion) === 'product-master' ? productMasterAliases(run) : []
}

function initialRelatedReferenceIds(run: WorkflowRun, target: ContinuityTarget, related: Card[]): string[] {
  const kind = continuitySubjectKind(run, target.suggestion)
  if (['style', 'scene', 'character-master', 'product-packaging', 'product-action', 'product-brand', 'product-detail'].includes(kind)) return []
  if (kind === 'product-master') {
    return [...related]
      .filter((card) => cardProductMatchScore(run, card) >= 3)
      .sort((left, right) => cardProductMatchScore(run, right) - cardProductMatchScore(run, left))
      .slice(0, 1)
      .map((card) => card.id)
  }
  return related.filter((card) => cardMatchesSuggestion(card, target.suggestion)).slice(0, 2).map((card) => card.id)
}

/** 基础产品/角色先生成，依赖它们的姿态或组合参考图随后顺序生成。 */
export function orderWorkflowContinuityCards(run: WorkflowRun, cardIds: string[]): string[] {
  const unique = [...new Set(cardIds)].filter((id) => !!useGraph.getState().getCard(id))
  const targets = resolveContinuityTargets(run, useGraph.getState().project)
  const remaining = new Set(unique)
  const result: string[] = []
  const originalIndex = new Map(unique.map((id, index) => [id, index]))
  const priority: Record<AssetRole, number> = { prop: 0, character: 1, reference: 2, scene: 3, style: 4, voice: 5, music: 5 }
  while (remaining.size) {
    const available = [...remaining].filter((id) => {
      const target = targetForCard(targets, id)
      if (!target) return true
      const dependencies = continuityDependencies(run, target, targets, useGraph.getState().project, false)
      return dependencies.every((dependency) => !dependency.card || !remaining.has(dependency.card.id))
    })
    const pool = available.length ? available : [...remaining]
    pool.sort((left, right) => {
      const leftTarget = targetForCard(targets, left)
      const rightTarget = targetForCard(targets, right)
      const subjectPriority: Record<WorkflowContinuitySubjectKind, number> = {
        'product-master': 0, 'character-master': 1, 'product-packaging': 2, 'product-detail': 2,
        'product-action': 3, 'product-brand': 4, scene: 5, style: 6, prop: 7, reference: 8
      }
      const leftPriority = leftTarget ? subjectPriority[continuitySubjectKind(run, leftTarget.suggestion)] : priority.reference
      const rightPriority = rightTarget ? subjectPriority[continuitySubjectKind(run, rightTarget.suggestion)] : priority.reference
      return leftPriority - rightPriority || (originalIndex.get(left) || 0) - (originalIndex.get(right) || 0)
    })
    const next = pool[0]
    remaining.delete(next)
    result.push(next)
  }
  return result
}

/**
 * 在每张派生设定图生成前刷新其身份引用。锚点排在普通素材之前，因此图片编辑模型会把当前产品/角色设定图作为主图输入。
 */
export function refreshWorkflowContinuityInputs(run: WorkflowRun, cardId: string): void {
  const graph = useGraph.getState()
  const card = graph.getCard(cardId)
  if (!card) return
  const project = graph.project
  const targets = resolveContinuityTargets(run, project)
  const target = targetForCard(targets, cardId)
  if (!target) return
  const continuity = continuityMeta(card)
  // 复用的用户素材只作为只读锚点，不能被工作流偷偷改写提示词或依赖。
  if (!continuity || continuity.runId !== run.id) return
  const dependencies = continuityDependencies(run, target, targets, project, true)
  const dependencyRefs = dependencies.flatMap((dependency) => {
    const anchor = dependency.anchor
    if (!anchor) return []
    const previous = (card.anchorRefs || []).find((ref) => ref.anchorId === anchor.id)
    return [{ anchorId: anchor.id, mention: anchor.name, acceptedAt: previous?.acceptedAt || Date.now() }]
  })
  const previousDependencyIds = new Set(continuity?.dependencyAnchorIds || [])
  const nextDependencyIds = new Set(dependencyRefs.map((ref) => ref.anchorId))
  const dependencySignature = dependencies.map((dependency) => {
    const anchor = dependency.anchor!
    const material = materialFromAnchor(anchor, project)
    return `${anchor.id}:${material.assetLocalPath || material.assetUrl || ''}`
  }).join('|')
  const retained = (card.anchorRefs || []).filter((ref) => !previousDependencyIds.has(ref.anchorId) && !nextDependencyIds.has(ref.anchorId))
  const anchorRefs = [...dependencyRefs, ...retained]
  const basePrompt = (card.prompt || '').split(CONTINUITY_DEPENDENCY_MARKER, 1)[0].trim()
  const kind = continuitySubjectKind(run, target.suggestion)
  const exactTexts = continuity.expectedTexts || expectedBrandTexts(run)
  const hierarchy = kind === 'product-action' && dependencies.length >= 2
    ? `第一张「${dependencies[0].suggestion.name}」是产品身份主参考，第二张「${dependencies[1].suggestion.name}」只用于人物身份；产品结构与文字冲突时一律以第一张为准。`
    : kind === 'product-brand' && dependencies.length >= 2
      ? `第一张「${dependencies[0].suggestion.name}」是产品身份主参考，第二张「${dependencies[1].suggestion.name}」是包装参考；不得混入角色或动作。`
      : ''
  const dependencyPrompt = dependencyRefs.length
    ? `${CONTINUITY_DEPENDENCY_MARKER}${hierarchy}必须严格沿用已附设定图中的「${dependencies.map((dependency) => dependency.suggestion.name).join('」「')}」：完整复刻其身份、几何结构、材质、颜色、Logo、已有文字和关键细节。只改变当前要求中的姿态、手部关系、视角或构图，不得重新设计、替换或概括该主体。${exactTexts.length ? `所有可见品牌文字必须逐字保持为“${exactTexts.join('”“')}”。` : ''}`
    : ''
  const meta = {
    ...(card.meta || {}),
    workflowContinuityV1: {
      ...continuity,
      subjectKind: continuitySubjectKind(run, target.suggestion),
      expectedTexts: continuity.expectedTexts || expectedBrandTexts(run),
      dependencyAnchorIds: [...nextDependencyIds],
      dependencySignature
    }
  }
  if ((card.assetUrl || card.assetLocalPath) && continuity?.dependencySignature !== dependencySignature) {
    ;(meta as Record<string, unknown>).storyboardInputStale = true
  }
  const prompt = `${basePrompt}${dependencyPrompt}`
  if (JSON.stringify(card.anchorRefs || []) !== JSON.stringify(anchorRefs) || card.prompt !== prompt || JSON.stringify(card.meta) !== JSON.stringify(meta)) {
    graph.updateCard(card.id, { anchorRefs, prompt, meta })
  }
}

/** 供生成计划显示新增的设定图任务；已存在或可复用的媒体不重复计费。 */
export function continuityNeedsGeneration(run: WorkflowRun, project: ProjectDoc = useGraph.getState().project): WorkflowAnchorSuggestion[] {
  return resolveContinuityTargets(run, project).filter((target) => target.needsGeneration).map((target) => target.suggestion)
}

function moveAnchorSource(anchor: AssetAnchor | undefined, targetCardId: string): void {
  const oldSourceId = anchor?.source?.cardId
  if (!oldSourceId || oldSourceId === targetCardId) return
  const old = useGraph.getState().getCard(oldSourceId)
  if (!old || semanticAnchorIdOfCard(old) !== anchor.id) return
  const meta = { ...(old.meta || {}) }
  delete meta.semanticAnchorId
  useGraph.getState().updateCard(old.id, { meta })
}

function upsertContinuityAnchor(cardId: string, suggestion: WorkflowAnchorSuggestion, previous?: AssetAnchor, locked = false, aliases: string[] = []): string {
  moveAnchorSource(previous, cardId)
  const anchorId = useGraph.getState().upsertAssetAnchor(cardId, {
    ...(previous ? { id: previous.id, tags: previous.tags } : {}),
    aliases: [...new Set([...(previous?.aliases || []), ...aliases].map((alias) => alias.trim()).filter((alias) => !!alias && normalizeName(alias) !== normalizeName(suggestion.name)))],
    role: suggestion.role,
    name: suggestion.name,
    description: suggestion.description,
    locked
  })
  if (!anchorId) throw new Error(`无法为「${suggestion.name}」创建视觉锚点`)
  return anchorId
}

function bindStoryboardAnchors(run: WorkflowRun): void {
  const owner = useGraph.getState().getCard(run.sourceCardId)
  const doc = owner ? readStoryboardDoc(owner) : null
  if (!owner || !doc) throw new Error('故事板尚未保存')
  const anchors = assetAnchorsForBoard(useGraph.getState().project, run.sourceBoardId)
  const styleNames = new Set(visualContinuitySuggestions(run)
    .filter((suggestion) => continuitySubjectKind(run, suggestion) === 'style')
    .map((suggestion) => normalizeName(suggestion.name)))
  const shots = doc.shots.map((shot, index) => {
    const plannedIndex = run.brief.shots.findIndex((candidate) => candidate.shotNumber === shot.shotNumber)
    const wanted = new Set(shotContinuityNames(run, plannedIndex >= 0 ? plannedIndex : index))
    const retained = shot.anchorIds.filter((anchorId) => {
      const anchor = anchors.find((candidate) => candidate.id === anchorId)
      if (!anchor) return false
      if (!isWorkflowVisualAnchorName(anchor.name)) return false
      if (anchor && anchorNames(anchor).some((name) => styleNames.has(name))) return false
      return !anchorNames(anchor).some((name) => wanted.has(name))
    })
    const resolved = [...wanted].flatMap((name) => {
      const matches = anchors.filter((anchor) => anchorNames(anchor).includes(name))
      const preferred = matches.find((anchor) => usableImageAnchor(anchor, useGraph.getState().project)) || matches.find((anchor) => anchor.mediaKind === 'image') || matches[0]
      return preferred ? [preferred.id] : []
    })
    return { ...shot, anchorIds: [...new Set([...retained, ...resolved])] }
  })
  if (!saveStoryboardDoc(owner.id, { ...doc, shots, updatedAt: Date.now() })) throw new Error('连续性锚点写入故事板失败')
}

/** 复用已有视觉素材，并幂等创建设定图卡。 */
export function prepareWorkflowContinuity(run: WorkflowRun): string[] {
  const graph = useGraph.getState()
  const source = graph.getCard(run.sourceCardId)
  const board = graph.project.boards.find((item) => item.id === run.sourceBoardId)
  if (!source || !board) throw new Error('工作流源卡片或画布已不存在')
  const targets = resolveContinuityTargets(run, graph.project)
  if (!targets.length) {
    bindStoryboardAnchors(run)
    return []
  }
  const related = relatedImageCards(run, graph.project)
  const created = new Map<string, string>()
  graph.applyGraphTransaction('准备连续性设定卡', (tx) => {
    const pending = targets.filter((target) => !target.card)
    const columns = Math.min(4, Math.max(1, pending.length))
    const rows = Math.ceil(pending.length / columns)
    const W = 280
    const H = 320
    const gapX = 40
    const gapY = 40
    const totalW = columns * W + Math.max(0, columns - 1) * gapX
    const totalH = rows * H + Math.max(0, rows - 1) * gapY
    const spot = pending.length
      ? findFreeCardSpot(board, totalW, totalH, source.x + source.w / 2, source.y - 120 - totalH / 2)
      : null
    pending.forEach((target, index) => {
      const col = index % columns
      const row = Math.floor(index / columns)
      const centerX = spot!.x - totalW / 2 + col * (W + gapX) + W / 2
      const centerY = spot!.y - totalH / 2 + row * (H + gapY) + H / 2
      const extraRefs = initialRelatedReferenceIds(run, target, related)
      const key = suggestionKey(target.suggestion)
      const cardId = tx.createCard('image', { x: centerX, y: centerY }, {
        title: `设定·${target.suggestion.name}`,
        prompt: referencePrompt(run, target.suggestion),
        refIds: [...new Set([source.id, ...extraRefs])],
        params: { aspect: '1:1', resolution: '1K', count: 1 },
        meta: {
          workflowContinuityV1: {
            version: 1,
            runId: run.id,
            key,
            role: target.suggestion.role,
            name: target.suggestion.name,
            subjectKind: continuitySubjectKind(run, target.suggestion),
            expectedTexts: ['product-master', 'product-packaging', 'product-brand', 'product-action', 'product-detail'].includes(continuitySubjectKind(run, target.suggestion))
              ? expectedBrandTexts(run)
              : []
          } satisfies WorkflowContinuityMetaV1
        }
      })
      tx.ensureEdge(source.id, cardId, 'ref')
      created.set(key, cardId)
    })
  }, run.sourceBoardId)

  const outputIds: string[] = []
  for (const target of targets) {
    const cardId = target.card?.id || created.get(suggestionKey(target.suggestion))
    if (!cardId) continue
    // 已被用户锁定的工程锚点继续使用原固定快照；准备新工作流不能把它悄悄解锁为源卡当前版本。
    upsertContinuityAnchor(cardId, target.suggestion, target.anchor, !!target.anchor?.locked, aliasesForSuggestion(run, target.suggestion))
    outputIds.push(cardId)
  }
  for (const cardId of orderWorkflowContinuityCards(run, outputIds)) refreshWorkflowContinuityInputs(run, cardId)
  bindStoryboardAnchors(run)
  return [...new Set(outputIds)]
}

/** 用户确认后固定当前媒体快照；后续镜头不再各自猜测角色、产品或道具外观。 */
export function lockWorkflowContinuity(run: WorkflowRun): string[] {
  const project = useGraph.getState().project
  const targets = resolveContinuityTargets(run, project)
  const missing = targets.filter((target) => !target.card || !(target.card.assetUrl || target.card.assetLocalPath))
  if (missing.length) throw new Error(`以下视觉设定尚未生成或导入：${missing.map((target) => target.suggestion.name).join('、')}`)
  const outputIds: string[] = []
  for (const target of targets) {
    const cardId = target.card!.id
    const current = target.anchor || Object.values(useGraph.getState().project.assetAnchors || {}).find((anchor) => anchorMatches(anchor, target.suggestion) && anchor.source?.cardId === cardId)
    // 用户可能在上次锁定后重新选择版本或局部编辑；确认时先解锁，再从当前主图重新固定快照。
    if (current?.locked) upsertContinuityAnchor(cardId, target.suggestion, current, false, aliasesForSuggestion(run, target.suggestion))
    const latest = Object.values(useGraph.getState().project.assetAnchors || {}).find((anchor) => anchor.id === current?.id)
    upsertContinuityAnchor(cardId, target.suggestion, latest || current, true, aliasesForSuggestion(run, target.suggestion))
    outputIds.push(cardId)
  }
  bindStoryboardAnchors(run)
  return [...new Set(outputIds)]
}

/** 锁定前向用户暴露生成模型无法自动保证的品牌字样与结构核对项。 */
export function continuityLockWarnings(run: WorkflowRun): string[] {
  if (!run.brief.product) return []
  const messages = ['请确认产品主设定与所有派生图中的外形比例、杯盖/按钮/接口结构、材质和颜色完全一致。']
  const texts = expectedBrandTexts(run)
  if (texts.length) messages.unshift(`请逐字核对产品、包装和品牌图中的可见文字必须为“${texts.join('”“')}”；图片模型可能产生近似拼写，确认锁定即表示采用当前结果。`)
  return messages
}

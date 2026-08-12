/**
 * 连续性台账 + 新版连续性报告自测。
 *
 * 覆盖重点：外观继承推导、唯一的形态告警规则、以及旧版 7 个形态码坍缩后
 * 那些场景（跨集回退、跨集切换、场景内漂移、有可用形态却用主形象）现在
 * 都收敛到同一条 unexplained_appearance_change，且**声明了变更点就不再告警**。
 */
import {
  buildContinuityLedger,
  clearAppearanceChange,
  declareAppearanceChange,
  episodeCastRequirements,
  expectedVariantId,
  revertToInheritedAppearance,
  variantDerivationBase,
  variantBaseUses,
  ambiguousVariantBases,
} from '../../domain/continuityLedger'
import { buildContinuityReport, isProductionBlocking } from './continuityReport'
import { syncCastRefsToLedger } from './episodeProduction'
import type { AppearanceChange, Asset, Episode, NovelChapter, ProjectDoc, ProjectMeta, Storyboard } from '../../domain/types'

let failures = 0

function check(name: string, condition: boolean, detail: string) {
  if (condition) console.log(`  OK ${name}`)
  else {
    failures += 1
    console.error(`  FAIL ${name}: ${detail}`)
  }
}

function meta(): ProjectMeta {
  return { id: 'p1', name: 'series', artStyle: 'cinematic', videoRatio: '16:9', createdAt: 0, updatedAt: 0 }
}

function chapter(id: string, index: number): NovelChapter {
  return { id, index, title: `Chapter ${index + 1}`, text: `chapter ${index + 1}` }
}

function storyboard(id: string, index: number, castRefs: Storyboard['castRefs'], patch: Partial<Storyboard> = {}): Storyboard {
  return {
    id,
    index,
    track: 'main',
    videoDesc: `shot ${index + 1}`,
    duration: 4,
    associateAssetIds: castRefs?.map((ref) => ref.assetId) ?? [],
    castRefs,
    shouldGenerateImage: true,
    state: 'idle',
    ...patch,
  }
}

function episode(id: string, index: number, patch: Partial<Episode> = {}): Episode {
  return { id, index, title: `Episode ${index + 1}`, scripts: [], storyboards: [], clips: [], track: [], createdAt: 0, updatedAt: 0, ...patch }
}

function hero(variantIds: string[] = []): Asset {
  return {
    id: 'a-hero',
    type: 'role',
    name: '女主',
    refImageId: 'img-hero',
    state: 'done',
    variants: variantIds.map((id) => ({ id, label: id, refImageId: `img-${id}`, state: 'done' as const })),
  }
}

function doc(patch: Partial<ProjectDoc>): ProjectDoc {
  return { meta: meta(), novel: [], scripts: [], assets: [], storyboards: [], clips: [], track: [], memory: [], ...patch }
}

function change(assetId: string, toVariantId: string | undefined, reason = '剧情变化'): AppearanceChange {
  return { assetId, toVariantId, reason }
}

const codesOf = (report: ReturnType<typeof buildContinuityReport>) => report.issues.map((issue) => issue.code)

// —— 1. 台账推导：没有变更点时形态一路继承 ——
{
  const e1 = episode('ep1', 0, { storyboards: [storyboard('sb1', 0, [{ assetId: 'a-hero' }]), storyboard('sb2', 1, [{ assetId: 'a-hero' }])] })
  const e2 = episode('ep2', 1, { storyboards: [storyboard('sb3', 0, [{ assetId: 'a-hero' }])] })
  const d = doc({ assets: [hero()], episodes: [e1, e2], currentEpisodeId: 'ep-none' })
  const ledger = buildContinuityLedger(d)
  check('ledger flattens all episodes in order', ledger.shots.map((shot) => shot.storyboardId).join(',') === 'sb1,sb2,sb3', JSON.stringify(ledger.shots.map((s) => s.storyboardId)))
  check('no change point means main appearance everywhere', ledger.shots.every((shot) => expectedVariantId(shot, 'a-hero') === undefined), 'expected all undefined')
  check('inheritance alone produces no issues', buildContinuityReport(d).issues.length === 0, JSON.stringify(codesOf(buildContinuityReport(d))))
}

// —— 2. 变更点之后的镜头自动继承新形态，跨集也一样 ——
{
  const e1 = episode('ep1', 0, {
    storyboards: [
      storyboard('sb1', 0, [{ assetId: 'a-hero' }]),
      storyboard('sb2', 1, [{ assetId: 'a-hero', variantId: 'injured' }], { stateChanges: [change('a-hero', 'injured', '左脸被划伤')] }),
    ],
  })
  const e2 = episode('ep2', 1, { storyboards: [storyboard('sb3', 0, [{ assetId: 'a-hero', variantId: 'injured' }])] })
  const d = doc({ assets: [hero(['injured'])], episodes: [e1, e2], currentEpisodeId: 'ep-none' })
  const ledger = buildContinuityLedger(d)
  check('shot before the change stays on main', expectedVariantId(ledger.byStoryboardId.get('sb1')!, 'a-hero') === undefined, 'sb1 should inherit main')
  check('change point applies from its own shot', expectedVariantId(ledger.byStoryboardId.get('sb2')!, 'a-hero') === 'injured', 'sb2 should be injured')
  check('next episode inherits across the boundary', expectedVariantId(ledger.byStoryboardId.get('sb3')!, 'a-hero') === 'injured', 'sb3 should inherit injured')
  check('declared change produces no warning', buildContinuityReport(d).issues.length === 0, JSON.stringify(codesOf(buildContinuityReport(d))))
}

// —— 3. 唯一的形态规则：变了但没声明 → 一条告警（旧版这是 asset_state_changed_variant）——
{
  const e1 = episode('ep1', 0, { storyboards: [storyboard('sb1', 0, [{ assetId: 'a-hero' }])] })
  const e2 = episode('ep2', 1, { storyboards: [storyboard('sb2', 0, [{ assetId: 'a-hero', variantId: 'gala' }])] })
  const d = doc({ assets: [hero(['gala'])], episodes: [e1, e2], currentEpisodeId: 'ep-none' })
  const report = buildContinuityReport(d)
  const issue = report.issues.find((item) => item.code === 'unexplained_appearance_change')
  check('undeclared switch raises exactly one appearance warning', report.issues.filter((i) => i.code === 'unexplained_appearance_change').length === 1, JSON.stringify(codesOf(report)))
  check('warning carries the inherited target for the quick fix', issue?.expectedVariantId === undefined && issue?.variantId === 'gala', JSON.stringify(issue))
  check('appearance warnings never block production', !report.issues.some(isProductionBlocking), JSON.stringify(codesOf(report)))
}

// —— 4. 旧版 asset_state_regressed_to_main：用回主形象同样只报这一条 ——
{
  const e1 = episode('ep1', 0, {
    storyboards: [storyboard('sb1', 0, [{ assetId: 'a-hero', variantId: 'injured' }], { stateChanges: [change('a-hero', 'injured', '受伤')] })],
  })
  const e2 = episode('ep2', 1, { storyboards: [storyboard('sb2', 0, [{ assetId: 'a-hero' }])] })
  const d = doc({ assets: [hero(['injured'])], episodes: [e1, e2], currentEpisodeId: 'ep-none' })
  const report = buildContinuityReport(d)
  const issue = report.issues.find((item) => item.code === 'unexplained_appearance_change')
  check('regression to main raises the same single code', report.issues.filter((i) => i.code === 'unexplained_appearance_change').length === 1, JSON.stringify(codesOf(report)))
  check('regression warning knows it should have stayed injured', issue?.expectedVariantId === 'injured', JSON.stringify(issue))
}

// —— 5. 场景内形态漂移（旧版 scene_group_variant_mismatch）也归到同一条 ——
{
  const e1 = episode('ep1', 0, {
    storyboards: [
      storyboard('sb1', 0, [{ assetId: 'a-hero' }], { sceneId: 'hall' }),
      storyboard('sb2', 1, [{ assetId: 'a-hero', variantId: 'gala' }], { sceneId: 'hall' }),
    ],
  })
  const d = doc({ assets: [hero(['gala'])], episodes: [e1], currentEpisodeId: 'ep-none' })
  const report = buildContinuityReport(d)
  check('in-scene drift reuses the appearance code', codesOf(report).filter((code) => code === 'unexplained_appearance_change').length === 1, JSON.stringify(codesOf(report)))
}

// —— 6. 变更点写入/撤销 ——
{
  const e1 = episode('ep1', 0, { storyboards: [storyboard('sb1', 0, [{ assetId: 'a-hero' }]), storyboard('sb2', 1, [{ assetId: 'a-hero', variantId: 'gala' }])] })
  const d = doc({ assets: [hero(['gala'])], episodes: [e1], currentEpisodeId: 'ep1', storyboards: e1.storyboards })
  check('report warns before the change is declared', buildContinuityReport(d).issues.some((i) => i.code === 'unexplained_appearance_change'), 'expected a warning')

  check('declareAppearanceChange reports a write', declareAppearanceChange(d, 'sb2', change('a-hero', 'gala', '换上宴会礼服')), 'expected true')
  check('declaring silences the warning', !buildContinuityReport(d).issues.some((i) => i.code === 'unexplained_appearance_change'), JSON.stringify(codesOf(buildContinuityReport(d))))
  check('declaring twice with identical data is a no-op', !declareAppearanceChange(d, 'sb2', change('a-hero', 'gala', '换上宴会礼服')), 'expected false')

  check('clearAppearanceChange removes the point', clearAppearanceChange(d, 'sb2', 'a-hero'), 'expected true')
  check('warning comes back after clearing', buildContinuityReport(d).issues.some((i) => i.code === 'unexplained_appearance_change'), 'expected the warning again')

  check('revertToInheritedAppearance realigns the castRef', revertToInheritedAppearance(d, 'sb2', 'a-hero'), 'expected true')
  check('revert clears the variant binding', d.storyboards[1].castRefs?.[0].variantId === undefined, JSON.stringify(d.storyboards[1].castRefs))
  check('revert silences the warning', !buildContinuityReport(d).issues.some((i) => i.code === 'unexplained_appearance_change'), JSON.stringify(codesOf(buildContinuityReport(d))))
}

// —— 7. 阻断项只剩两个：悬空引用 + 缺参考图 ——
{
  const e1 = episode('ep1', 0, {
    storyboards: [
      storyboard('sb1', 0, [{ assetId: 'a-ghost' }]),
      storyboard('sb2', 1, [{ assetId: 'a-hero', variantId: 'nope' }]),
      storyboard('sb3', 2, [{ assetId: 'a-noimg' }]),
    ],
  })
  const noImage: Asset = { id: 'a-noimg', type: 'prop', name: '玉佩', state: 'idle' }
  const d = doc({ assets: [hero(), noImage], episodes: [e1], currentEpisodeId: 'ep-none' })
  const report = buildContinuityReport(d)
  const blocking = report.issues.filter(isProductionBlocking)
  check('dangling asset and variant both map to dangling_ref', blocking.filter((i) => i.code === 'dangling_ref').length === 2, JSON.stringify(blocking.map((i) => i.code)))
  check('missing reference image blocks', blocking.some((i) => i.code === 'missing_ref_image' && i.assetId === 'a-noimg'), JSON.stringify(blocking.map((i) => i.code)))
  check('every blocking issue is an error', blocking.every((i) => i.severity === 'error'), JSON.stringify(blocking.map((i) => i.severity)))
}

// —— 8. 身份重复：一组只报一条，不再每个资产各报一条 ——
{
  const a: Asset = { id: 'a1', type: 'role', name: '阿箬', refImageId: 'i1', state: 'done' }
  const b: Asset = { id: 'a2', type: 'role', name: '小箬', aliases: ['阿箬'], refImageId: 'i2', state: 'done' }
  const c: Asset = { id: 'a3', type: 'role', name: '阿箬', refImageId: 'i3', state: 'done' }
  const d = doc({ assets: [a, b, c] })
  const duplicates = buildContinuityReport(d).issues.filter((issue) => issue.code === 'duplicate_identity')
  check('one issue per colliding group, not per asset', duplicates.length === 1, JSON.stringify(duplicates.map((i) => [i.assetId, i.relatedAssetIds])))
  check('duplicate issue lists the other members', (duplicates[0]?.relatedAssetIds?.length ?? 0) === 2, JSON.stringify(duplicates[0]))
}

// —— 9. 同场景资产：整组一条，附带涉及的分镜 ——
{
  const heroAsset = hero()
  const hall: Asset = { id: 'a-hall', type: 'scene', name: '正殿', refImageId: 'i-hall', state: 'done' }
  const e1 = episode('ep1', 0, {
    storyboards: [
      storyboard('sb1', 0, [{ assetId: 'a-hall' }, { assetId: 'a-hero' }], { sceneId: 'hall' }),
      storyboard('sb2', 1, [{ assetId: 'a-hero' }], { sceneId: 'hall' }),
    ],
  })
  const d = doc({ assets: [heroAsset, hall], episodes: [e1], currentEpisodeId: 'ep-none' })
  const sceneIssues = buildContinuityReport(d).issues.filter((issue) => issue.code === 'scene_asset_inconsistent')
  check('scene group reports once', sceneIssues.length === 1, JSON.stringify(sceneIssues))
  check('scene issue points at the shots missing the scene asset', sceneIssues[0]?.storyboardIds?.join(',') === 'sb2', JSON.stringify(sceneIssues[0]?.storyboardIds))
}

// —— 10. 章节覆盖 ——
{
  const e1 = episode('ep1', 0, { novelChapterIds: ['c1'], storyboards: [] })
  const e2 = episode('ep2', 1, { novelChapterIds: ['c1'], storyboards: [] })
  const e3 = episode('ep3', 2, { storyboards: [] })
  const d = doc({ novel: [chapter('c1', 0), chapter('c2', 1)], episodes: [e1, e2, e3], currentEpisodeId: 'ep-none' })
  const coverage = buildContinuityReport(d).issues.filter((issue) => issue.code === 'chapter_coverage')
  check('unassigned / duplicated / empty all use one code', coverage.length === 3, JSON.stringify(coverage.map((i) => i.message)))
  check('chapter coverage never blocks', !coverage.some(isProductionBlocking), JSON.stringify(coverage.map((i) => i.category)))
}

// —— 11. 未引用资产降级为提示 ——
{
  const heroAsset = hero()
  const spare: Asset = { id: 'a-spare', type: 'prop', name: '备用道具', refImageId: 'i-s', state: 'done' }
  const e1 = episode('ep1', 0, { storyboards: [storyboard('sb1', 0, [{ assetId: 'a-hero' }])] })
  const d = doc({ assets: [heroAsset, spare], episodes: [e1], currentEpisodeId: 'ep-none' })
  const hints = buildContinuityReport(d).issues.filter((issue) => issue.code === 'unused_project_asset')
  check('unused asset is an info hint', hints.length === 1 && hints[0].severity === 'info' && hints[0].category === 'hint', JSON.stringify(hints))
}

// —— 12. 本集出场需求从分镜反推（取代 requiredAssetIds 勾选）——
{
  const e1 = episode('ep1', 0, {
    storyboards: [
      storyboard('sb1', 0, [{ assetId: 'a-hero' }]),
      storyboard('sb2', 1, [{ assetId: 'a-hero', variantId: 'gala' }], { stateChanges: [change('a-hero', 'gala', '换装')] }),
    ],
  })
  const d = doc({ assets: [hero(['gala'])], episodes: [e1], currentEpisodeId: 'ep-none' })
  const requirements = episodeCastRequirements(d, 'ep1')
  check('requirements derive from storyboards', requirements.length === 1 && requirements[0].assetId === 'a-hero', JSON.stringify(requirements))
  check('requirements capture both appearances used in the episode', requirements[0].variantIds.length === 2, JSON.stringify(requirements[0].variantIds))
}

// —— 13. 全部问题码都在收敛后的集合内 ——
{
  const ALLOWED = new Set([
    'dangling_ref',
    'missing_ref_image',
    'unexplained_appearance_change',
    'duplicate_identity',
    'scene_asset_inconsistent',
    'chapter_coverage',
    'unused_project_asset',
  ])
  const heroAsset = hero(['gala'])
  const spare: Asset = { id: 'a-spare', type: 'prop', name: '备用', state: 'idle' }
  const e1 = episode('ep1', 0, { novelChapterIds: [], storyboards: [storyboard('sb1', 0, [{ assetId: 'a-hero' }, { assetId: 'a-ghost' }], { sceneId: 's' })] })
  const e2 = episode('ep2', 1, { storyboards: [storyboard('sb2', 0, [{ assetId: 'a-hero', variantId: 'gala' }], { sceneId: 's' })] })
  const d = doc({ novel: [chapter('c1', 0)], assets: [heroAsset, spare], episodes: [e1, e2], currentEpisodeId: 'ep-none' })
  const codes = [...new Set(codesOf(buildContinuityReport(d)))]
  check('no code escapes the 7-code set', codes.every((code) => ALLOWED.has(code)), JSON.stringify(codes))
}

// —— 14. 回归：一个悬空 variantId 不得沿台账扩散成整集报错 ——
// 曾经 agentVariantId 用 `?? text` 兜底，Agent 提到一个尚不存在的形态就会写进标签原文当 id。
// 台账把它继承给后面每一镜，一处笔误变成几十条 dangling_ref。
{
  const e1 = episode('ep1', 0, {
    storyboards: [
      storyboard('s1', 0, [{ assetId: 'a-hero' }]),
      // 变更点指向一个不存在的形态 id（模拟旧 bug 落盘的脏数据）
      storyboard('s2', 1, [{ assetId: 'a-hero', variantId: '受伤' }], { stateChanges: [change('a-hero', '受伤', '被划伤')] }),
      storyboard('s3', 2, [{ assetId: 'a-hero', variantId: '受伤' }]),
      storyboard('s4', 3, [{ assetId: 'a-hero', variantId: '受伤' }]),
    ],
  })
  const d = doc({ assets: [hero()], episodes: [e1], currentEpisodeId: 'ep-none' })
  const dangling = buildContinuityReport(d).issues.filter((issue) => issue.code === 'dangling_ref')
  check('a dangling variant is reported on the shots that reference it', dangling.length === 3, JSON.stringify(dangling.map((i) => i.storyboardId)))
  check(
    'the dangling variant never becomes an inherited state',
    buildContinuityLedger(d).shots.every((shot) => expectedVariantId(shot, 'a-hero') === undefined || hero(['受伤']).variants?.some((v) => v.id === expectedVariantId(shot, 'a-hero'))),
    JSON.stringify(buildContinuityLedger(d).shots.map((s) => expectedVariantId(s, 'a-hero'))),
  )
}

// —— 15. 自动补建的形态：应报"缺参考图"（可行动）而不是"引用了已删除的形态"（死路）——
{
  const heroWithAuto: Asset = {
    id: 'a-hero',
    type: 'role',
    name: '四叔',
    refImageId: 'img-hero',
    state: 'done',
    variants: [{ id: 'v-auto', label: '受伤', state: 'idle' }], // 分镜自动补建，还没出图
  }
  const e1 = episode('ep1', 0, {
    storyboards: [storyboard('s1', 0, [{ assetId: 'a-hero', variantId: 'v-auto' }], { stateChanges: [change('a-hero', 'v-auto', '被划伤')] })],
  })
  const d = doc({ assets: [heroWithAuto], episodes: [e1], currentEpisodeId: 'ep-none' })
  const codes = codesOf(buildContinuityReport(d))
  check('an auto-created variant is not a dangling ref', !codes.includes('dangling_ref'), JSON.stringify(codes))
  check('an auto-created variant asks for an image instead', codes.includes('missing_ref_image'), JSON.stringify(codes))
}

// —— 16. 派生底图：换装应以"当时穿的那身"为底，而不是永远从主图重来 ——
{
  const heroWithLooks: Asset = {
    id: 'a-hero',
    type: 'role',
    name: '四叔',
    refImageId: 'img-main',
    state: 'done',
    variants: [
      { id: 'v-daily', label: '常服', refImageId: 'img-daily', state: 'done' },
      { id: 'v-hurt', label: '受伤', state: 'idle' },
      { id: 'v-gala', label: '礼服', state: 'idle' },
    ],
  }
  const e1 = episode('ep1', 0, {
    storyboards: [
      storyboard('s1', 0, [{ assetId: 'a-hero', variantId: 'v-daily' }], { stateChanges: [change('a-hero', 'v-daily', '换上常服')] }),
      storyboard('s2', 1, [{ assetId: 'a-hero', variantId: 'v-hurt' }], { stateChanges: [change('a-hero', 'v-hurt', '左脸被划伤')] }),
    ],
  })
  const d = doc({ assets: [heroWithLooks], episodes: [e1], currentEpisodeId: 'ep-none' })

  check('a look that follows another derives from that one', variantDerivationBase(d, 'a-hero', 'v-hurt') === 'v-daily', String(variantDerivationBase(d, 'a-hero', 'v-hurt')))
  check('the first look derives from the main image', variantDerivationBase(d, 'a-hero', 'v-daily') === undefined, String(variantDerivationBase(d, 'a-hero', 'v-daily')))
  check('a never-used look falls back to the main image', variantDerivationBase(d, 'a-hero', 'v-gala') === undefined, String(variantDerivationBase(d, 'a-hero', 'v-gala')))

  // 手工指定的父形态优先于推导
  const withExplicit = doc({
    assets: [{ ...heroWithLooks, variants: heroWithLooks.variants!.map((v) => (v.id === 'v-hurt' ? { ...v, parentVariantId: 'v-gala' } : v)) }],
    episodes: [e1],
    currentEpisodeId: 'ep-none',
  })
  check('an explicit parentVariantId wins over derivation', variantDerivationBase(withExplicit, 'a-hero', 'v-hurt') === 'v-gala', String(variantDerivationBase(withExplicit, 'a-hero', 'v-hurt')))

  // 指向已删除的父形态时忽略它，退回推导
  const staleParent = doc({
    assets: [{ ...heroWithLooks, variants: heroWithLooks.variants!.map((v) => (v.id === 'v-hurt' ? { ...v, parentVariantId: 'gone' } : v)) }],
    episodes: [e1],
    currentEpisodeId: 'ep-none',
  })
  check('a dangling parentVariantId is ignored', variantDerivationBase(staleParent, 'a-hero', 'v-hurt') === 'v-daily', String(variantDerivationBase(staleParent, 'a-hero', 'v-hurt')))

  // 自我指向不构成底图
  const selfRef = doc({
    assets: [heroWithLooks],
    episodes: [episode('ep1', 0, { storyboards: [storyboard('s1', 0, [{ assetId: 'a-hero', variantId: 'v-hurt' }], { stateChanges: [change('a-hero', 'v-hurt', 'x')] })] })],
    currentEpisodeId: 'ep-none',
  })
  check('a look that changes into itself falls back to the main image', variantDerivationBase(selfRef, 'a-hero', 'v-hurt') === undefined, String(variantDerivationBase(selfRef, 'a-hero', 'v-hurt')))
}

// —— 17. 同一形态从多种状态变来 → 提示拆分（一张参考图承载不了两种外观）——
{
  const hero4: Asset = {
    id: 'a-hero',
    type: 'role',
    name: '四叔',
    refImageId: 'img-main',
    state: 'done',
    variants: [
      { id: 'v-daily', label: '常服', refImageId: 'i1', state: 'done' },
      { id: 'v-gala', label: '礼服', refImageId: 'i2', state: 'done' },
      { id: 'v-hurt', label: '受伤', refImageId: 'i3', state: 'done' },
    ],
  }
  // 真正的歧义要求两个底图是**兄弟**：常服和礼服都从主形象派生，受伤先后从这两身衣服变来。
  // 一张「受伤」图没法同时穿常服和礼服。
  const d = doc({
    assets: [hero4],
    currentEpisodeId: 'ep-none',
    episodes: [
      episode('ep1', 0, {
        storyboards: [
          storyboard('s1', 0, [{ assetId: 'a-hero', variantId: 'v-daily' }], { stateChanges: [change('a-hero', 'v-daily', '换常服')] }),
          storyboard('s2', 1, [{ assetId: 'a-hero', variantId: 'v-hurt' }], { stateChanges: [change('a-hero', 'v-hurt', '被划伤')] }),
        ],
      }),
      episode('ep2', 1, {
        storyboards: [
          storyboard('s3', 0, [{ assetId: 'a-hero', variantId: 'v-daily' }], { stateChanges: [change('a-hero', 'v-daily', '伤好了，换回常服')] }),
          storyboard('s4', 1, [{ assetId: 'a-hero', variantId: 'v-gala' }], { stateChanges: [change('a-hero', 'v-gala', '换礼服赴宴')] }),
          storyboard('s5', 2, [{ assetId: 'a-hero', variantId: 'v-hurt' }], { stateChanges: [change('a-hero', 'v-hurt', '宴会上再次挂彩')] }),
        ],
      }),
    ],
  })

  const uses = variantBaseUses(d, 'a-hero', 'v-hurt')
  check('base uses record every change into the variant', uses.length === 2, JSON.stringify(uses))
  check('base uses capture the differing bases', ambiguousVariantBases(d, 'a-hero', 'v-hurt', uses).join(',') === 'v-daily,v-gala', JSON.stringify(ambiguousVariantBases(d, 'a-hero', 'v-hurt', uses)))

  const ambiguous = buildContinuityReport(d).issues.filter((issue) => issue.code === 'ambiguous_variant_base')
  check('an ambiguous variant is flagged once', ambiguous.length === 1, JSON.stringify(ambiguous.map((i) => i.variantId)))
  check('the warning names both bases', ambiguous[0]?.baseVariantLabels?.join(',') === '常服,礼服', JSON.stringify(ambiguous[0]?.baseVariantLabels))
  check('the warning explains which base wins', ambiguous[0].message.includes('按第一次（常服）派生'), ambiguous[0].message)
  check('an ambiguous variant never blocks production', !ambiguous.some(isProductionBlocking), JSON.stringify(ambiguous.map((i) => i.category)))

  // 单一底图不该报
  const single = doc({
    assets: [hero4],
    currentEpisodeId: 'ep-none',
    episodes: [episode('ep1', 0, { storyboards: [storyboard('s1', 0, [{ assetId: 'a-hero', variantId: 'v-hurt' }], { stateChanges: [change('a-hero', 'v-hurt', '受伤')] })] })],
  })
  check('a single-base variant is not flagged', !codesOf(buildContinuityReport(single)).includes('ambiguous_variant_base'), JSON.stringify(codesOf(buildContinuityReport(single))))

  // 同一底图重复变更（换回来又换过去）不算歧义
  const repeated = doc({
    assets: [hero4],
    currentEpisodeId: 'ep-none',
    episodes: [
      episode('ep1', 0, {
        storyboards: [
          storyboard('s1', 0, [{ assetId: 'a-hero', variantId: 'v-daily' }], { stateChanges: [change('a-hero', 'v-daily', 'a')] }),
          storyboard('s2', 1, [{ assetId: 'a-hero', variantId: 'v-hurt' }], { stateChanges: [change('a-hero', 'v-hurt', 'b')] }),
          storyboard('s3', 2, [{ assetId: 'a-hero', variantId: 'v-daily' }], { stateChanges: [change('a-hero', 'v-daily', 'c')] }),
          storyboard('s4', 3, [{ assetId: 'a-hero', variantId: 'v-hurt' }], { stateChanges: [change('a-hero', 'v-hurt', 'd')] }),
        ],
      }),
    ],
  })
  check('changing back and forth from the same base is not ambiguous', !codesOf(buildContinuityReport(repeated)).includes('ambiguous_variant_base'), JSON.stringify(codesOf(buildContinuityReport(repeated))))
}

// —— 18. 拆分：把歧义形态按底图拆开后，告警消失且下游继承自动重算 ——
// 这里复刻 store.splitVariantByBase 的核心逻辑（store 依赖宿主，自测里不引），
// 验证的是"拆完之后台账自洽"这个契约。
{
  const hero5: Asset = {
    id: 'a-hero',
    type: 'role',
    name: '四叔',
    refImageId: 'img-main',
    state: 'done',
    variants: [
      { id: 'v-daily', label: '常服', refImageId: 'i1', state: 'done' },
      { id: 'v-gala', label: '礼服', refImageId: 'i2', state: 'done' },
      { id: 'v-hurt', label: '受伤', refImageId: 'i3', state: 'done' },
    ],
  }
  const d = doc({
    assets: [hero5],
    currentEpisodeId: 'ep-none',
    episodes: [
      episode('ep1', 0, {
        storyboards: [
          storyboard('s1', 0, [{ assetId: 'a-hero', variantId: 'v-daily' }], { stateChanges: [change('a-hero', 'v-daily', '换常服')] }),
          storyboard('s2', 1, [{ assetId: 'a-hero', variantId: 'v-hurt' }], { stateChanges: [change('a-hero', 'v-hurt', '被划伤')] }),
          storyboard('s3', 2, [{ assetId: 'a-hero', variantId: 'v-hurt' }]),
        ],
      }),
      episode('ep2', 1, {
        storyboards: [
          storyboard('s4', 0, [{ assetId: 'a-hero', variantId: 'v-daily' }], { stateChanges: [change('a-hero', 'v-daily', '换回常服')] }),
          storyboard('s5', 1, [{ assetId: 'a-hero', variantId: 'v-gala' }], { stateChanges: [change('a-hero', 'v-gala', '换礼服')] }),
          storyboard('s6', 2, [{ assetId: 'a-hero', variantId: 'v-hurt' }], { stateChanges: [change('a-hero', 'v-hurt', '再次挂彩')] }),
          storyboard('s7', 3, [{ assetId: 'a-hero', variantId: 'v-hurt' }]),
        ],
      }),
    ],
  })

  const uses = variantBaseUses(d, 'a-hero', 'v-hurt')
  const bases = ambiguousVariantBases(d, 'a-hero', 'v-hurt', uses)
  const [, ...extra] = bases
  const newIdByBase = new Map<string, string>()
  for (const baseId of extra) {
    const id = `v-hurt-${baseId}`
    newIdByBase.set(baseId ?? '', id)
    hero5.variants!.push({ id, label: `受伤（${baseId}）`, state: 'idle', parentVariantId: baseId })
  }
  const ambiguousKeys = new Set(bases.map((baseId) => baseId ?? ''))
  const all = [...(d.episodes ?? []).flatMap((episode) => episode.storyboards)]
  for (const use of uses) {
    if (!ambiguousKeys.has(use.baseVariantId ?? '')) continue
    const nextId = newIdByBase.get(use.baseVariantId ?? '')
    if (!nextId) continue
    const change = all.find((item) => item.id === use.storyboardId)?.stateChanges?.find((item) => item.toVariantId === 'v-hurt')
    if (change) change.toVariantId = nextId
  }
  syncCastRefsToLedger(d)

  check('splitting creates one variant per extra base', newIdByBase.size === 1, JSON.stringify([...newIdByBase]))
  check('the first base keeps the original variant', all.find((s) => s.id === 's2')?.stateChanges?.[0].toVariantId === 'v-hurt', JSON.stringify(all.find((s) => s.id === 's2')?.stateChanges))
  check('the later base points at the new variant', all.find((s) => s.id === 's6')?.stateChanges?.[0].toVariantId === 'v-hurt-v-gala', JSON.stringify(all.find((s) => s.id === 's6')?.stateChanges))
  check('downstream shots re-inherit without manual edits', all.find((s) => s.id === 's7')?.castRefs?.[0].variantId === 'v-hurt-v-gala', JSON.stringify(all.find((s) => s.id === 's7')?.castRefs))
  check('shots under the original base are untouched', all.find((s) => s.id === 's3')?.castRefs?.[0].variantId === 'v-hurt', JSON.stringify(all.find((s) => s.id === 's3')?.castRefs))
  check('the ambiguity warning is gone after splitting', !codesOf(buildContinuityReport(d)).includes('ambiguous_variant_base'), JSON.stringify(codesOf(buildContinuityReport(d))))
  check('the new variant now needs its own image', buildContinuityReport(d).issues.some((issue) => issue.code === 'missing_ref_image' && issue.variantId === 'v-hurt-v-gala'), JSON.stringify(codesOf(buildContinuityReport(d))))
}

console.log(failures ? `\ncontinuityReport selftest: ${failures} FAILED` : '\ncontinuityReport selftest: ALL PASSED')
if (failures) process.exit(1)

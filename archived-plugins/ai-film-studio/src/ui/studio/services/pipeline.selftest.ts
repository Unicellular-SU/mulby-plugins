/**
 * 主线流水线自测：阶段顺序、断点续传（已有产物跳过）、失败即停、中断、force 重跑，
 * 以及分集断点归一化（模型漏章/重复章的兜底）。
 */
import { inspectPipeline, resolveTargetEpisodeCount, runNovelToFilmPipeline, PIPELINE_STAGES, type PipelineActions } from './pipeline'
import { evenEpisodeBreaks, normalizeEpisodeBreaks } from '../../domain/episodeBreaks'
import { mergeBiblePart, storyBibleIsStale, formatStoryBible } from '../../domain/storyBibleFormat'
import type { Episode, NovelChapter, ProjectDoc, ProjectMeta, Script, Storyboard } from '../../domain/types'

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
function chapter(index: number, event?: string): NovelChapter {
  return { id: `c${index}`, index, title: `第 ${index + 1} 章`, text: `chapter ${index} body`, event }
}
function script(content: string): Script {
  return { id: `s-${content}`, name: 'x', content, createdAt: 0, updatedAt: 0 }
}
function storyboard(id: string, index: number): Storyboard {
  return { id, index, track: 'main', videoDesc: 'shot', duration: 4, associateAssetIds: [], shouldGenerateImage: true, state: 'idle' }
}
function episode(id: string, index: number, patch: Partial<Episode> = {}): Episode {
  return { id, index, title: `E${index + 1}`, scripts: [], storyboards: [], clips: [], track: [], createdAt: 0, updatedAt: 0, ...patch }
}
function doc(patch: Partial<ProjectDoc>): ProjectDoc {
  return { meta: meta(), novel: [], scripts: [], assets: [], storyboards: [], clips: [], track: [], memory: [], ...patch }
}

/** 一个记录调用顺序的假 actions；每个动作直接改 doc，让 inspectPipeline 能观察到进展 */
function makeHarness(initial: ProjectDoc, overrides: Partial<PipelineActions> = {}) {
  const state = { doc: initial, aborted: false }
  const calls: string[] = []
  const actions: PipelineActions = {
    getDoc: () => state.doc,
    isAborted: () => state.aborted,
    onStatus: () => {},
    extractAllEvents: async () => {
      calls.push('extractAllEvents')
      state.doc.novel = state.doc.novel.map((item) => ({ ...item, event: item.event ?? `event ${item.index}` }))
    },
    ensureStoryBible: async () => {
      calls.push('ensureStoryBible')
      state.doc.storyBible = { characters: [{ name: '女主', desc: '红衣' }], locations: [], props: [], sourceChapterCount: state.doc.novel.length, extractedAt: 1 }
    },
    planEpisodeBreaks: async (targetCount) => {
      calls.push(`planEpisodeBreaks:${targetCount}`)
      return evenEpisodeBreaks(state.doc.novel.length, targetCount)
    },
    createEpisodes: (count) => {
      calls.push(`createEpisodes:${count}`)
      const created: string[] = []
      state.doc.episodes ??= []
      for (let i = 0; i < count; i += 1) {
        const ep = episode(`ep${state.doc.episodes.length + 1}`, state.doc.episodes.length)
        state.doc.episodes.push(ep)
        created.push(ep.id)
      }
      state.doc.currentEpisodeId ??= state.doc.episodes[0]?.id
      return created
    },
    setEpisodeNovelChapters: (episodeId, chapterIds) => {
      const ep = state.doc.episodes?.find((item) => item.id === episodeId)
      if (ep) ep.novelChapterIds = chapterIds
    },
    renameEpisode: (episodeId, title) => {
      const ep = state.doc.episodes?.find((item) => item.id === episodeId)
      if (ep) ep.title = title
    },
    updateEpisodePlan: (episodeId, patch) => {
      const ep = state.doc.episodes?.find((item) => item.id === episodeId)
      if (ep) ep.plan = { ...(ep.plan ?? {}), ...patch }
    },
    switchEpisode: (episodeId) => {
      calls.push(`switchEpisode:${episodeId}`)
      state.doc.currentEpisodeId = episodeId
      const ep = state.doc.episodes?.find((item) => item.id === episodeId)
      state.doc.scripts = ep?.scripts ?? []
      state.doc.storyboards = ep?.storyboards ?? []
    },
    runAgentStage: async (stage) => {
      calls.push(`runAgentStage:${stage}:${state.doc.currentEpisodeId}`)
      const ep = state.doc.episodes?.find((item) => item.id === state.doc.currentEpisodeId)
      if (stage === 'script' && ep) {
        ep.scripts = [script(`script for ${ep.id}`)]
        state.doc.scripts = ep.scripts
      }
      if (stage === 'assets') state.doc.assets = [{ id: 'a1', type: 'role', name: '女主', state: 'idle' }]
      if (stage === 'storyboard' && ep) {
        ep.storyboards = [storyboard(`${ep.id}-sb`, 0)]
        state.doc.storyboards = ep.storyboards
      }
    },
    generateAllAssets: async () => {
      calls.push('generateAllAssets')
      state.doc.assets = state.doc.assets.map((asset) => ({ ...asset, refImageId: asset.refImageId ?? `img-${asset.id}` }))
    },
    produceCurrentEpisode: async () => {
      calls.push(`produce:${state.doc.currentEpisodeId}`)
      const ep = state.doc.episodes?.find((item) => item.id === state.doc.currentEpisodeId)
      if (ep) ep.filmPath = `/films/${ep.id}.mp4`
    },
    ...overrides,
  }
  return { state, calls, actions }
}

// —— 1. 全新项目跑完整条链 ——
{
  const h = makeHarness(doc({ novel: [chapter(0), chapter(1), chapter(2), chapter(3)], seriesBible: { plannedEpisodeCount: 2 } }))
  const result = await runNovelToFilmPipeline(h.actions)
  check('runs every stage to completion', result.completed && result.stages.every((stage) => stage.state === 'done' || stage.state === 'skipped'), JSON.stringify(result.stages.map((s) => [s.id, s.state])))
  check('stage order follows the declared pipeline', result.stages.map((s) => s.id).join(',') === PIPELINE_STAGES.map((s) => s.id).join(','), JSON.stringify(result.stages.map((s) => s.id)))
  check('builds the story bible right after chapter events', h.calls.indexOf('ensureStoryBible') === h.calls.indexOf('extractAllEvents') + 1, JSON.stringify(h.calls.slice(0, 4)))
  check('splits into the planned number of episodes', (h.state.doc.episodes?.length ?? 0) === 2, JSON.stringify(h.state.doc.episodes?.map((e) => [e.id, e.novelChapterIds])))
  check('assigns every chapter to some episode', new Set((h.state.doc.episodes ?? []).flatMap((e) => e.novelChapterIds ?? [])).size === 4, JSON.stringify(h.state.doc.episodes?.map((e) => e.novelChapterIds)))
  check('produces a film for every episode', (h.state.doc.episodes ?? []).every((e) => !!e.filmPath), JSON.stringify(h.state.doc.episodes?.map((e) => e.filmPath)))
}

// —— 2. 资产只在第一集提炼一次（否则每集都会新建同名资产）——
{
  const h = makeHarness(doc({ novel: [chapter(0), chapter(1), chapter(2)], seriesBible: { plannedEpisodeCount: 3 } }))
  await runNovelToFilmPipeline(h.actions)
  const assetStageCalls = h.calls.filter((call) => call.startsWith('runAgentStage:assets'))
  check('asset extraction runs exactly once for the whole series', assetStageCalls.length === 1, JSON.stringify(assetStageCalls))
  check('script and storyboard run per episode', h.calls.filter((c) => c.startsWith('runAgentStage:script')).length === 3 && h.calls.filter((c) => c.startsWith('runAgentStage:storyboard')).length === 3, JSON.stringify(h.calls))
}

// —— 3. 断点续传：已有产物的阶段跳过 ——
{
  const ep1 = episode('ep1', 0, { novelChapterIds: ['c0'], scripts: [script('done')], storyboards: [storyboard('sb1', 0)], filmPath: '/films/ep1.mp4' })
  const resumeDoc = doc({
    novel: [chapter(0, 'event 0')],
    assets: [{ id: 'a1', type: 'role', name: '女主', refImageId: 'img', state: 'done' }],
    episodes: [ep1],
    currentEpisodeId: 'ep1',
    scripts: ep1.scripts,
    storyboards: ep1.storyboards,
    storyBible: { characters: [], locations: [], props: [], sourceChapterCount: 1, extractedAt: 1 },
  })
  const h = makeHarness(resumeDoc)
  const result = await runNovelToFilmPipeline(h.actions)
  check('fully produced project skips every stage', result.stages.every((stage) => stage.state === 'skipped'), JSON.stringify(result.stages.map((s) => [s.id, s.state])))
  check('skipping costs no model calls', h.calls.length === 0, JSON.stringify(h.calls))
}

// —— 4. 部分完成：只补缺的那几段 ——
{
  const ep1 = episode('ep1', 0, { novelChapterIds: ['c0'], scripts: [script('done')] })
  const partialDoc = doc({
    novel: [chapter(0, 'event 0')],
    assets: [{ id: 'a1', type: 'role', name: '女主', refImageId: 'img', state: 'done' }],
    episodes: [ep1],
    currentEpisodeId: 'ep1',
    scripts: ep1.scripts,
    storyBible: { characters: [], locations: [], props: [], sourceChapterCount: 1, extractedAt: 1 },
  })
  const h = makeHarness(partialDoc)
  const result = await runNovelToFilmPipeline(h.actions)
  const byId = new Map(result.stages.map((stage) => [stage.id, stage.state]))
  check('done upstream stages stay skipped', byId.get('events') === 'skipped' && byId.get('script') === 'skipped' && byId.get('assets') === 'skipped', JSON.stringify([...byId]))
  check('missing stages actually run', byId.get('storyboard') === 'done' && byId.get('media') === 'done', JSON.stringify([...byId]))
  check('only the storyboard agent stage is invoked', h.calls.filter((c) => c.startsWith('runAgentStage:')).join(',') === 'runAgentStage:storyboard:ep1', JSON.stringify(h.calls))
}

// —— 5. force 无视既有产物全部重跑 ——
{
  const ep1 = episode('ep1', 0, { novelChapterIds: ['c0'], scripts: [script('done')], storyboards: [storyboard('sb1', 0)], filmPath: '/films/ep1.mp4' })
  const h = makeHarness(doc({
    novel: [chapter(0, 'event 0')],
    assets: [{ id: 'a1', type: 'role', name: '女主', refImageId: 'img', state: 'done' }],
    episodes: [ep1],
    currentEpisodeId: 'ep1',
    scripts: ep1.scripts,
    storyboards: ep1.storyboards,
    storyBible: { characters: [], locations: [], props: [], sourceChapterCount: 1, extractedAt: 1 },
  }))
  const result = await runNovelToFilmPipeline(h.actions, { force: true })
  check('force reruns every stage', result.stages.every((stage) => stage.state === 'done'), JSON.stringify(result.stages.map((s) => [s.id, s.state])))
}

// —— 6. 阶段失败即停，不硬跑下游 ——
{
  const h = makeHarness(doc({ novel: [chapter(0)], seriesBible: { plannedEpisodeCount: 1 } }), {
    runAgentStage: async (stage) => {
      if (stage === 'script') throw new Error('文本模型未配置')
      return undefined
    },
  })
  const result = await runNovelToFilmPipeline(h.actions)
  const byId = new Map(result.stages.map((stage) => [stage.id, stage.state]))
  check('failing stage is marked failed', byId.get('script') === 'failed', JSON.stringify([...byId]))
  check('pipeline reports incomplete', !result.completed, JSON.stringify(result))
  check('downstream stages stay pending after a failure', byId.get('assets') === 'pending' && byId.get('media') === 'pending', JSON.stringify([...byId]))
  check('failure message surfaces the root cause', result.stages.find((s) => s.id === 'script')?.error === '文本模型未配置', JSON.stringify(result.stages.find((s) => s.id === 'script')))
}

// —— 7. 缺原著时 chapters 阶段就拦住，给出可操作提示 ——
{
  const h = makeHarness(doc({}))
  const result = await runNovelToFilmPipeline(h.actions)
  const stage = result.stages.find((item) => item.id === 'chapters')
  check('missing novel fails at the first stage', stage?.state === 'failed' && !!stage.error?.includes('导入原著'), JSON.stringify(stage))
}

// —— 8. 中断在阶段边界生效 ——
{
  const h = makeHarness(doc({ novel: [chapter(0), chapter(1)], seriesBible: { plannedEpisodeCount: 1 } }))
  h.state.aborted = true
  const result = await runNovelToFilmPipeline(h.actions)
  check('abort stops before the first stage', result.abortedAt === 'chapters' && !result.completed, JSON.stringify(result))
}

// —— 9. stopAfter 支持分步确认 ——
{
  const h = makeHarness(doc({ novel: [chapter(0), chapter(1)], seriesBible: { plannedEpisodeCount: 1 } }))
  const result = await runNovelToFilmPipeline(h.actions, { stopAfter: 'episodes' })
  const byId = new Map(result.stages.map((stage) => [stage.id, stage.state]))
  check('stopAfter halts at the requested stage', byId.get('episodes') === 'done' && byId.get('script') === 'pending', JSON.stringify([...byId]))
  check('stopAfter still reports success', result.completed, JSON.stringify(result))
}

// —— 10. 目标集数解析 ——
{
  check('explicit target wins', resolveTargetEpisodeCount(doc({ seriesBible: { plannedEpisodeCount: 5 } }), 3) === 3, 'expected 3')
  check('series bible is next', resolveTargetEpisodeCount(doc({ seriesBible: { plannedEpisodeCount: 5 } })) === 5, 'expected 5')
  check('falls back to ~3 chapters per episode', resolveTargetEpisodeCount(doc({ novel: [chapter(0), chapter(1), chapter(2), chapter(3), chapter(4), chapter(5), chapter(6)] })) === 3, 'expected 3')
}

// —— 11. inspectPipeline 是纯推导（进度不额外存状态）——
{
  const empty = inspectPipeline(doc({}))
  check('empty project satisfies nothing', Object.values(empty).every((value) => value === false), JSON.stringify(empty))
  const noNovel = inspectPipeline(doc({ episodes: [episode('ep1', 0, { scripts: [script('x')], storyboards: [storyboard('a', 0)] })], currentEpisodeId: 'ep-other' }))
  check('原创项目（无原著）不要求章节分配', noNovel.episodes === true, JSON.stringify(noNovel))
}

// —— 12. 分集断点归一化：模型漏章 / 重复章 / 越界都要兜住 ——
{
  const messy = normalizeEpisodeBreaks(
    [
      { title: 'A', summary: '', chapterIndexes: [0, 1] },
      { title: 'B', summary: '', chapterIndexes: [1, 2] }, // 1 与上一集重叠
      { title: 'C', summary: '', chapterIndexes: [99] }, // 越界
    ],
    5, // 共 5 章，模型漏了 3 和 4
  )
  const assigned = messy.flatMap((item) => item.chapterIndexes)
  check('breaks drop overlapping chapters', new Set(assigned).size === assigned.length, JSON.stringify(messy))
  check('breaks cover every chapter', new Set(assigned).size === 5, JSON.stringify(messy))
  check('breaks drop out-of-range indexes', assigned.every((index) => index >= 0 && index < 5), JSON.stringify(messy))
  check('breaks stay in chapter order', messy.every((item, i) => i === 0 || item.chapterIndexes[0] > messy[i - 1].chapterIndexes[0]), JSON.stringify(messy))

  const even = evenEpisodeBreaks(7, 3)
  check('even split covers all chapters without overlap', even.flatMap((e) => e.chapterIndexes).join(',') === '0,1,2,3,4,5,6', JSON.stringify(even))
  check('even split never creates empty episodes', even.every((e) => e.chapterIndexes.length > 0), JSON.stringify(even))
}

// —— 13. 故事圣经合并与失效判断 ——
{
  const merged = mergeBiblePart(
    [{ name: '女主', aliases: ['阿箬'], desc: '红衣' }],
    [{ name: '女主', aliases: ['箬儿'], desc: '一身红衣，左脸有痣' }, { name: '男主', desc: '玄袍' }],
  )
  const heroine = merged.find((item) => item.name === '女主')
  check('merge unions aliases', heroine?.aliases?.join(',') === '阿箬,箬儿', JSON.stringify(heroine))
  check('merge keeps the richer description', heroine?.desc === '一身红衣，左脸有痣', JSON.stringify(heroine))
  check('merge appends new entries', merged.length === 2, JSON.stringify(merged))

  check('bible is stale when chapters grew', storyBibleIsStale({ characters: [], locations: [], props: [], sourceChapterCount: 3, extractedAt: 1 }, 5), 'expected stale')
  check('bible is fresh when chapter count matches', !storyBibleIsStale({ characters: [], locations: [], props: [], sourceChapterCount: 5, extractedAt: 1 }, 5), 'expected fresh')
  check('missing bible with no chapters is not stale', !storyBibleIsStale(undefined, 0), 'expected not stale')

  const text = formatStoryBible({ characters: [{ name: '女主', aliases: ['阿箬'], desc: '红衣' }], locations: [], props: [], sourceChapterCount: 1, extractedAt: 1 })
  check('formatted bible carries names and aliases', text.includes('女主') && text.includes('阿箬'), text)
  check('empty bible formats to nothing', formatStoryBible(undefined) === '', 'expected empty string')
}

console.log(failures ? `\npipeline selftest: ${failures} FAILED` : '\npipeline selftest: ALL PASSED')
if (failures) process.exit(1)

/**
 * 连续性台账（Continuity Ledger）。
 *
 * 取代旧的「变体适用范围声明」（AssetVariant.appliesToEpisodeIds/SceneIds/StoryboardIds）
 * 与「单集必需资产/形态勾选」（EpisodePlan.requiredAssetIds/requiredVariantIds）。
 *
 * 模型：把全项目的分镜按 (episode.index, storyboard.index) 串成一条时间轴，逐镜推进一份
 * 「资产 → 当前形态」的运行状态。资产的形态默认**继承上一镜**，只有分镜显式写了
 * `stateChanges` 变更点才会切换。于是：
 *   - 「这个形态适用于哪几集/场/镜」不需要声明，是推导结果；
 *   - 连续性检查坍缩成一条规则：本镜实际形态 ≠ 继承形态，且本镜没有变更点。
 *
 * 这正是场记连续性记录的工作方式：只记录变化，不枚举范围。
 */
import { castRefsForStoryboard } from './castRefs'
import type { AppearanceChange, Asset, Episode, ProjectDoc, Storyboard } from './types'

/** 时间轴上一个镜头的坐标 */
export interface ShotPosition {
  episodeId: string
  episodeIndex: number
  episodeTitle: string
  storyboard: Storyboard
  storyboardId: string
  storyboardIndex: number
  sceneId?: string
}

export interface LedgerEntry extends ShotPosition {
  /** 进入本镜时的继承状态（不含本镜变更点）：assetId → variantId（undefined = 主形象） */
  inherited: Map<string, string | undefined>
  /** 本镜声明的形态变更点 */
  changes: AppearanceChange[]
  /** 离开本镜时的状态（inherited 应用 changes 后） */
  resulting: Map<string, string | undefined>
}

export interface ContinuityLedger {
  shots: LedgerEntry[]
  byStoryboardId: Map<string, LedgerEntry>
}

/** 某资产在某镜「本该」呈现的形态：本镜有变更点取变更点，否则继承上一镜 */
export function expectedVariantId(entry: LedgerEntry, assetId: string): string | undefined {
  const change = entry.changes.find((item) => item.assetId === assetId)
  if (change) return change.toVariantId
  return entry.inherited.get(assetId)
}

function episodeList(doc: ProjectDoc): Episode[] {
  const episodes = [...(doc.episodes ?? [])].sort((a, b) => a.index - b.index)
  if (episodes.length) return episodes
  return [
    {
      id: doc.currentEpisodeId ?? 'current',
      index: 0,
      title: '当前集',
      scripts: doc.scripts,
      storyboards: doc.storyboards,
      storyboardTable: doc.storyboardTable,
      clips: doc.clips,
      track: doc.track,
      createdAt: doc.meta.createdAt,
      updatedAt: doc.meta.updatedAt,
    },
  ]
}

/** 当前集的分镜以工作区镜像为准（多集迁移期约定），其余集读 episode.storyboards */
export function storyboardsOf(doc: ProjectDoc, episode: Episode): Storyboard[] {
  return episode.id === doc.currentEpisodeId ? doc.storyboards : episode.storyboards
}

/** 全项目分镜按 (集序, 镜序) 展平成一条时间轴 */
export function orderedShotPositions(doc: ProjectDoc): ShotPosition[] {
  const positions: ShotPosition[] = []
  for (const episode of episodeList(doc)) {
    const storyboards = [...storyboardsOf(doc, episode)].sort((a, b) => a.index - b.index)
    for (const storyboard of storyboards) {
      positions.push({
        episodeId: episode.id,
        episodeIndex: episode.index,
        episodeTitle: episode.title,
        storyboard,
        storyboardId: storyboard.id,
        storyboardIndex: storyboard.index,
        sceneId: storyboard.sceneId?.trim() || undefined,
      })
    }
  }
  return positions
}

/** 只有会出镜的资产类型参与形态追踪；音色/素材片段没有"长相" */
function tracksAppearance(asset: Asset | undefined): boolean {
  return !!asset && asset.type !== 'audio' && asset.type !== 'clip'
}

export function buildContinuityLedger(doc: ProjectDoc): ContinuityLedger {
  const assets = new Map(doc.assets.map((asset) => [asset.id, asset]))
  const running = new Map<string, string | undefined>()
  const shots: LedgerEntry[] = []

  for (const position of orderedShotPositions(doc)) {
    const inherited = new Map(running)
    const changes = (position.storyboard.stateChanges ?? []).filter(
      (change) => change?.assetId && tracksAppearance(assets.get(change.assetId)),
    )
    for (const change of changes) running.set(change.assetId, change.toVariantId)
    // 首次出场且未声明变更点的资产：以主形象进入台账，供后续镜头继承
    for (const ref of castRefsForStoryboard(position.storyboard)) {
      if (!tracksAppearance(assets.get(ref.assetId))) continue
      if (!running.has(ref.assetId)) running.set(ref.assetId, undefined)
    }
    shots.push({ ...position, inherited, changes, resulting: new Map(running) })
  }

  return { shots, byStoryboardId: new Map(shots.map((shot) => [shot.storyboardId, shot])) }
}

/**
 * 某形态该以谁为底图派生。
 *
 * 派生形态是 img2img：底图决定了"哪些特征被保留"。一直拿主图当底，等于每次换装都从
 * 默认造型重来——四叔穿着常服被划伤，生成出来会是默认造型 + 伤口，常服丢了。
 *
 * 正确答案在时间轴上：这个形态**第一次被声明变更**的那一镜，角色当时继承的是什么形态，
 * 那个就是底。和形态的适用范围一样，这是推导出来的，不需要谁去声明。
 *
 * 返回 undefined 表示"以主形象为底"。
 */
export function variantDerivationBase(doc: ProjectDoc, assetId: string, variantId: string): string | undefined {
  const asset = doc.assets.find((item) => item.id === assetId)
  // 用户显式指定过父形态就尊重它——手工设定优先于推导
  const explicit = asset?.variants?.find((item) => item.id === variantId)?.parentVariantId
  if (explicit && asset?.variants?.some((item) => item.id === explicit)) return explicit

  const ledger = buildContinuityLedger(doc)
  for (const shot of ledger.shots) {
    const change = shot.changes.find((item) => item.assetId === assetId && item.toVariantId === variantId)
    if (!change) continue
    const inherited = shot.inherited.get(assetId)
    // 继承的就是自己（重复声明）时没有意义，退回主形象
    return inherited && inherited !== variantId ? inherited : undefined
  }
  return undefined
}

export interface VariantBaseUse {
  /** 变更发生时角色继承的形态；undefined = 从主形象变来 */
  baseVariantId?: string
  storyboardId: string
  episodeId: string
  episodeIndex: number
  storyboardIndex: number
  reason: string
}

/**
 * 这个形态在时间轴上一共从几种状态变来过。
 *
 * 一个形态只有一张参考图。如果「受伤」在 E1 从常服变来、在 E5 从礼服变来，两处会共用
 * 按 E1（常服）派生的那张图——E5 的礼服就丢了。这说明「受伤」其实承载了两种外观，
 * 应该拆成两个形态，而不是指望一张图同时正确。
 */
export function variantBaseUses(doc: ProjectDoc, assetId: string, variantId: string): VariantBaseUse[] {
  const ledger = buildContinuityLedger(doc)
  const uses: VariantBaseUse[] = []
  for (const shot of ledger.shots) {
    const change = shot.changes.find((item) => item.assetId === assetId && item.toVariantId === variantId)
    if (!change) continue
    const baseVariantId = shot.inherited.get(assetId)
    uses.push({
      baseVariantId: baseVariantId === variantId ? undefined : baseVariantId,
      storyboardId: shot.storyboardId,
      episodeId: shot.episodeId,
      episodeIndex: shot.episodeIndex,
      storyboardIndex: shot.storyboardIndex,
      reason: change.reason,
    })
  }
  return uses
}

/** 去重后的底图种类。注意：判断"是否歧义"要用 ambiguousVariantBases，它会排掉换回原样的环。 */
export function distinctVariantBases(uses: VariantBaseUse[]): (string | undefined)[] {
  const seen = new Set<string>()
  const bases: (string | undefined)[] = []
  for (const use of uses) {
    const key = use.baseVariantId ?? ''
    if (seen.has(key)) continue
    seen.add(key)
    bases.push(use.baseVariantId)
  }
  return bases
}

/** 某形态的派生祖先链（第一次变更时的底图，一路往上）；带环保护 */
function derivationAncestors(doc: ProjectDoc, assetId: string, variantId: string): Set<string> {
  const chain = new Set<string>()
  let current: string | undefined = variantId
  for (let guard = 0; guard < 32 && current; guard += 1) {
    const base: string | undefined = variantDerivationBase(doc, assetId, current)
    if (!base || chain.has(base)) break
    chain.add(base)
    current = base
  }
  return chain
}

/**
 * 真正构成歧义的底图种类。
 *
 * 排掉「换回原样」造成的环：`常服 → 受伤 → 常服` 里，常服的第二个底图是受伤，
 * 而受伤本来就是从常服派生的——那不是两种平行外观，只是绕回来了，原图依然正确。
 * 要抓的是 `常服 → 受伤` 与 `礼服 → 受伤` 这种**兄弟底图**：同一张受伤图没法同时穿两身衣服。
 */
export function ambiguousVariantBases(doc: ProjectDoc, assetId: string, variantId: string, uses: VariantBaseUse[]): (string | undefined)[] {
  return distinctVariantBases(uses).filter((baseId) => {
    if (!baseId) return true // 主形象永远是合法底图
    return !derivationAncestors(doc, assetId, baseId).has(variantId)
  })
}

/** 某资产最近一次形态变更发生在哪一镜（供承接面板展示"上一次换装在 E2 #14"） */
export function lastAppearanceChangeBefore(
  ledger: ContinuityLedger,
  assetId: string,
  storyboardId: string,
): { entry: LedgerEntry; change: AppearanceChange } | undefined {
  const cutoff = ledger.shots.findIndex((shot) => shot.storyboardId === storyboardId)
  const scan = cutoff < 0 ? ledger.shots : ledger.shots.slice(0, cutoff)
  for (let i = scan.length - 1; i >= 0; i -= 1) {
    const change = scan[i].changes.find((item) => item.assetId === assetId)
    if (change) return { entry: scan[i], change }
  }
  return undefined
}

export interface EpisodeCastRequirement {
  assetId: string
  /** 本集实际用到的形态集合（undefined 成员代表用到了主形象） */
  variantIds: (string | undefined)[]
}

/**
 * 从分镜反推「本集需要哪些资产/形态」——取代 EpisodePlan.requiredAssetIds/requiredVariantIds。
 * 分镜是事实，计划勾选只是声明；两套数据并存必然漂移，所以只保留事实。
 */
export function episodeCastRequirements(doc: ProjectDoc, episodeId: string): EpisodeCastRequirement[] {
  const ledger = buildContinuityLedger(doc)
  const byAsset = new Map<string, Set<string>>()
  for (const shot of ledger.shots) {
    if (shot.episodeId !== episodeId) continue
    for (const ref of castRefsForStoryboard(shot.storyboard)) {
      const variantId = ref.variantId ?? expectedVariantId(shot, ref.assetId)
      const set = byAsset.get(ref.assetId) ?? new Set<string>()
      set.add(variantId ?? '')
      byAsset.set(ref.assetId, set)
    }
  }
  return [...byAsset.entries()].map(([assetId, variantIds]) => ({
    assetId,
    variantIds: [...variantIds].map((id) => id || undefined),
  }))
}

// —— 变更点写入（唯一的一致性写入口）——

function findStoryboard(doc: ProjectDoc, storyboardId: string): Storyboard | undefined {
  const inCurrent = doc.storyboards.find((item) => item.id === storyboardId)
  if (inCurrent) return inCurrent
  for (const episode of doc.episodes ?? []) {
    const found = episode.storyboards.find((item) => item.id === storyboardId)
    if (found) return found
  }
  return undefined
}

/** 在某镜声明一个形态变更点（同一资产重复声明则覆盖）。返回是否有实际改动。 */
export function declareAppearanceChange(
  doc: ProjectDoc,
  storyboardId: string,
  change: AppearanceChange,
): boolean {
  const storyboard = findStoryboard(doc, storyboardId)
  if (!storyboard || !change.assetId) return false
  const next = [...(storyboard.stateChanges ?? [])]
  const index = next.findIndex((item) => item.assetId === change.assetId)
  if (index >= 0) {
    if (next[index].toVariantId === change.toVariantId && next[index].reason === change.reason) return false
    next[index] = change
  } else next.push(change)
  storyboard.stateChanges = next
  // castRefs 的 variantId 是台账的缓存投影，声明变更点时同步回填，避免两处不一致
  const ref = storyboard.castRefs?.find((item) => item.assetId === change.assetId)
  if (ref) ref.variantId = change.toVariantId
  return true
}

/** 撤销某镜上某资产的变更点，让它回到继承状态。返回是否有实际改动。 */
export function clearAppearanceChange(doc: ProjectDoc, storyboardId: string, assetId: string): boolean {
  const storyboard = findStoryboard(doc, storyboardId)
  const current = storyboard?.stateChanges
  if (!storyboard || !current?.length) return false
  const next = current.filter((item) => item.assetId !== assetId)
  if (next.length === current.length) return false
  storyboard.stateChanges = next.length ? next : undefined
  return true
}

/**
 * 把某镜某资产的实际形态对齐到继承状态（一致性抽屉的「沿用上一形态」快速修复）。
 * 与 declareAppearanceChange 互为一对：一个承认变化，一个否认变化。
 */
export function revertToInheritedAppearance(doc: ProjectDoc, storyboardId: string, assetId: string): boolean {
  const storyboard = findStoryboard(doc, storyboardId)
  if (!storyboard) return false
  const cleared = clearAppearanceChange(doc, storyboardId, assetId)
  const entry = buildContinuityLedger(doc).byStoryboardId.get(storyboardId)
  const inheritedVariantId = entry?.inherited.get(assetId)
  const ref = storyboard.castRefs?.find((item) => item.assetId === assetId)
  if (ref && ref.variantId !== inheritedVariantId) {
    ref.variantId = inheritedVariantId
    return true
  }
  return cleared
}

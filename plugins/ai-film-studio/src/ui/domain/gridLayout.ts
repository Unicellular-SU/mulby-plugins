/**
 * 宫格分镜板的布局计算（纯函数，无宿主依赖）。
 *
 * 为什么要宫格：跨镜一致性最强的手段不是提示词约束，而是**让多个镜头在同一次生成里出现**。
 * 同一张图里的人物长相、光线方向、色调、材质天然一致——这是模型自己保证的，不需要我们
 * 用 "keep the same character" 之类的咒语去求。副作用是省钱：6 个镜头从 6 次图像调用压成 1 次。
 *
 * 代价是单格分辨率下降，所以格数要有上限（9），且只把**同一场景组**的连续镜头放进同一张宫格
 * ——跨场景塞进一张图会互相污染。
 */

export type GridSize = 'grid_4' | 'grid_6' | 'grid_9'

export interface GridLayout {
  size: GridSize
  cols: number
  rows: number
  /** 格子总数；实际镜头数可能少于它，尾部留空 */
  cells: number
}

export const GRID_LAYOUTS: Record<GridSize, GridLayout> = {
  grid_4: { size: 'grid_4', cols: 2, rows: 2, cells: 4 },
  grid_6: { size: 'grid_6', cols: 3, rows: 2, cells: 6 },
  grid_9: { size: 'grid_9', cols: 3, rows: 3, cells: 9 },
}

/** 宫格模式的下限：少于 2 镜没有合并意义，直接单张生成 */
export const MIN_GRID_SHOTS = 2
export const MAX_GRID_SHOTS = 9

/** 按镜头数选最小够用的宫格；空格越少单格分辨率越高 */
export function pickGridLayout(shotCount: number): GridLayout | null {
  if (shotCount < MIN_GRID_SHOTS) return null
  if (shotCount <= 4) return GRID_LAYOUTS.grid_4
  if (shotCount <= 6) return GRID_LAYOUTS.grid_6
  if (shotCount <= 9) return GRID_LAYOUTS.grid_9
  return null
}

export interface GridCellRect {
  index: number
  col: number
  row: number
  /** 归一化到 [0,1] 的裁剪框，切割时乘以实际像素尺寸 */
  x: number
  y: number
  width: number
  height: number
}

/** 每格在整图中的归一化位置，按行优先编号 */
export function gridCellRects(layout: GridLayout): GridCellRect[] {
  const width = 1 / layout.cols
  const height = 1 / layout.rows
  return Array.from({ length: layout.cells }, (_, index) => {
    const col = index % layout.cols
    const row = Math.floor(index / layout.cols)
    return { index, col, row, x: col * width, y: row * height, width, height }
  })
}

/**
 * 宫格整图的像素尺寸：单格保持目标画幅比例，整图 = 单格 × 列/行。
 * 上限用于避免超出图像模型的最大边长；超了就整体等比缩小。
 */
export function gridImageSize(layout: GridLayout, cellRatio: number, maxEdge = 2048): { width: number; height: number; cellWidth: number; cellHeight: number } {
  // 以单格宽 1024 起算（大多数模型的舒适区），再按比例定高
  let cellWidth = 1024
  let cellHeight = Math.round(cellWidth / cellRatio)
  let width = cellWidth * layout.cols
  let height = cellHeight * layout.rows
  const longest = Math.max(width, height)
  if (longest > maxEdge) {
    const scale = maxEdge / longest
    cellWidth = Math.round((cellWidth * scale) / 8) * 8
    cellHeight = Math.round((cellHeight * scale) / 8) * 8
    width = cellWidth * layout.cols
    height = cellHeight * layout.rows
  }
  return { width, height, cellWidth, cellHeight }
}

/** '16:9' → 1.777…；解析不了就按 16:9 */
export function ratioValue(ratio: string | undefined): number {
  const match = /^(\d+(?:\.\d+)?)\s*[:：/]\s*(\d+(?:\.\d+)?)$/.exec((ratio ?? '').trim())
  if (!match) return 16 / 9
  const w = Number(match[1])
  const h = Number(match[2])
  if (!Number.isFinite(w) || !Number.isFinite(h) || h <= 0) return 16 / 9
  return w / h
}

export interface GridShotLike {
  id: string
  index: number
  sceneId?: string
}

export interface GridGroup {
  /** 同一 sceneId 的连续镜头；跨场景不合并 */
  sceneId?: string
  shots: GridShotLike[]
  layout: GridLayout
}

/**
 * 把分镜切成可宫格化的组。
 *
 * 只合并**同一 sceneId 的连续镜头**：宫格的价值来自"同一次生成里共享环境和光线"，
 * 把两个不同场景塞进一张图反而会让模型把两边的元素混在一起。没有 sceneId 的镜头
 * 各自独立（不知道它跟谁同场，就不冒险合并）。
 */
export function planGridGroups(shots: GridShotLike[]): { groups: GridGroup[]; singles: GridShotLike[] } {
  const sorted = [...shots].sort((a, b) => a.index - b.index)
  const runs: GridShotLike[][] = []
  for (const shot of sorted) {
    const sceneId = shot.sceneId?.trim()
    const last = runs[runs.length - 1]
    const lastSceneId = last?.[0]?.sceneId?.trim()
    if (!sceneId) {
      runs.push([shot])
      continue
    }
    if (last && lastSceneId === sceneId && last.length < MAX_GRID_SHOTS) last.push(shot)
    else runs.push([shot])
  }

  const groups: GridGroup[] = []
  const singles: GridShotLike[] = []
  for (const run of runs) {
    const layout = pickGridLayout(run.length)
    if (!layout) singles.push(...run)
    else groups.push({ sceneId: run[0].sceneId?.trim(), shots: run, layout })
  }
  return { groups, singles }
}

/** 给模型的分格说明：明确每格画什么、编号怎么数，否则它会自己乱排 */
export function buildGridPrompt(
  layout: GridLayout,
  shotPrompts: string[],
  options: { styleAnchor?: string; sceneHint?: string } = {},
): string {
  const cellLines = shotPrompts.map((prompt, index) => `Cell ${index + 1}: ${prompt}`)
  const blanks = layout.cells - shotPrompts.length
  const blankLine = blanks > 0
    ? `Cells ${shotPrompts.length + 1}-${layout.cells}: leave as plain neutral background, no subject.`
    : ''
  return [
    `A ${layout.cols}x${layout.rows} storyboard contact sheet containing ${layout.cells} separate film frames in a strict grid.`,
    'Number the cells left-to-right, then top-to-bottom. Each cell is an independent camera setup from the SAME scene: identical characters, wardrobe, location, lighting direction and color grade across all cells.',
    'Separate cells with thin black gutters. No captions, no numbers, no watermarks drawn inside the image.',
    options.sceneHint ? `Scene: ${options.sceneHint}` : '',
    ...cellLines,
    blankLine,
    options.styleAnchor ?? '',
  ]
    .filter(Boolean)
    .join('\n')
}

/**
 * 宫格切出的单格用作视频首帧后，相邻两格可以互为首/尾帧：
 * cell i 是第 i 镜的首帧，cell i+1 同时是第 i 镜的尾帧目标和第 i+1 镜的首帧。
 * 这样同一场景组内的视频段之间自然衔接。
 */
export function frameChainForGroup(group: GridGroup): { storyboardId: string; firstCell: number; lastCell?: number }[] {
  return group.shots.map((shot, index) => ({
    storyboardId: shot.id,
    firstCell: index,
    lastCell: index + 1 < group.shots.length ? index + 1 : undefined,
  }))
}

/** 宫格布局/分组的纯逻辑自测 */
import {
  buildGridPrompt,
  frameChainForGroup,
  GRID_LAYOUTS,
  gridCellRects,
  gridImageSize,
  pickGridLayout,
  planGridGroups,
  ratioValue,
} from './gridLayout'

let failures = 0
function check(name: string, condition: boolean, detail: string) {
  if (condition) console.log(`  OK ${name}`)
  else {
    failures += 1
    console.error(`  FAIL ${name}: ${detail}`)
  }
}

// —— 布局选择：取最小够用的宫格，空格越少单格分辨率越高 ——
{
  check('single shot is not worth a grid', pickGridLayout(1) === null, 'expected null')
  check('2-4 shots use grid_4', pickGridLayout(2)?.size === 'grid_4' && pickGridLayout(4)?.size === 'grid_4', JSON.stringify([pickGridLayout(2), pickGridLayout(4)]))
  check('5-6 shots use grid_6', pickGridLayout(5)?.size === 'grid_6' && pickGridLayout(6)?.size === 'grid_6', JSON.stringify(pickGridLayout(5)))
  check('7-9 shots use grid_9', pickGridLayout(7)?.size === 'grid_9' && pickGridLayout(9)?.size === 'grid_9', JSON.stringify(pickGridLayout(7)))
  check('beyond 9 shots falls back to single frames', pickGridLayout(10) === null, 'expected null')
}

// —— 格子矩形：行优先、无重叠、铺满整图 ——
{
  const rects = gridCellRects(GRID_LAYOUTS.grid_6)
  check('grid_6 yields 6 cells', rects.length === 6, JSON.stringify(rects.length))
  check('cells are numbered left-to-right then top-to-bottom', rects.map((r) => `${r.row}${r.col}`).join(',') === '00,01,02,10,11,12', rects.map((r) => `${r.row}${r.col}`).join(','))
  check('cells tile the whole image', Math.abs(rects.reduce((sum, r) => sum + r.width * r.height, 0) - 1) < 1e-9, 'area sum should be 1')
  check('no cell escapes the canvas', rects.every((r) => r.x >= 0 && r.y >= 0 && r.x + r.width <= 1 + 1e-9 && r.y + r.height <= 1 + 1e-9), JSON.stringify(rects))
}

// —— 整图尺寸：单格保持画幅比例，超长边时整体缩放 ——
{
  const wide = gridImageSize(GRID_LAYOUTS.grid_4, 16 / 9, 4096)
  check('cell keeps the target aspect ratio', Math.abs(wide.cellWidth / wide.cellHeight - 16 / 9) < 0.02, JSON.stringify(wide))
  check('image is cell size times the grid', wide.width === wide.cellWidth * 2 && wide.height === wide.cellHeight * 2, JSON.stringify(wide))

  const clamped = gridImageSize(GRID_LAYOUTS.grid_9, 16 / 9, 2048)
  check('oversized grids are scaled down to the max edge', Math.max(clamped.width, clamped.height) <= 2048, JSON.stringify(clamped))
  check('scaled cells stay on the aspect ratio', Math.abs(clamped.cellWidth / clamped.cellHeight - 16 / 9) < 0.06, JSON.stringify(clamped))

  const portrait = gridImageSize(GRID_LAYOUTS.grid_4, 9 / 16, 4096)
  check('portrait ratio produces taller cells', portrait.cellHeight > portrait.cellWidth, JSON.stringify(portrait))
}

// —— 画幅解析 ——
{
  check('parses 16:9', Math.abs(ratioValue('16:9') - 16 / 9) < 1e-9, 'x')
  check('parses 9:16', Math.abs(ratioValue('9:16') - 9 / 16) < 1e-9, 'x')
  check('parses full-width colon', Math.abs(ratioValue('4：3') - 4 / 3) < 1e-9, 'x')
  check('falls back to 16:9 on garbage', Math.abs(ratioValue('nonsense') - 16 / 9) < 1e-9, 'x')
  check('falls back to 16:9 on zero height', Math.abs(ratioValue('16:0') - 16 / 9) < 1e-9, 'x')
}

// —— 分组：只合并同一 sceneId 的连续镜头 ——
{
  const shots = [
    { id: 'a', index: 0, sceneId: 'hall' },
    { id: 'b', index: 1, sceneId: 'hall' },
    { id: 'c', index: 2, sceneId: 'hall' },
    { id: 'd', index: 3, sceneId: 'street' },
    { id: 'e', index: 4, sceneId: 'street' },
    { id: 'f', index: 5 },
  ]
  const { groups, singles } = planGridGroups(shots)
  check('same-scene runs become grid groups', groups.length === 2, JSON.stringify(groups.map((g) => g.shots.map((s) => s.id))))
  check('grid group keeps its scene id', groups[0].sceneId === 'hall' && groups[1].sceneId === 'street', JSON.stringify(groups.map((g) => g.sceneId)))
  check('shots without a scene id stay single', singles.map((s) => s.id).join(',') === 'f', JSON.stringify(singles))

  const interleaved = planGridGroups([
    { id: 'a', index: 0, sceneId: 'hall' },
    { id: 'b', index: 1, sceneId: 'street' },
    { id: 'c', index: 2, sceneId: 'hall' },
  ])
  check('non-adjacent same-scene shots are not merged', interleaved.groups.length === 0 && interleaved.singles.length === 3, JSON.stringify(interleaved))

  const lonely = planGridGroups([{ id: 'a', index: 0, sceneId: 'hall' }, { id: 'b', index: 1, sceneId: 'street' }])
  check('a one-shot scene is not gridded', lonely.groups.length === 0 && lonely.singles.length === 2, JSON.stringify(lonely))

  const long = planGridGroups(Array.from({ length: 14 }, (_, i) => ({ id: `s${i}`, index: i, sceneId: 'hall' })))
  check('runs longer than 9 split into multiple grids', long.groups.length === 2, JSON.stringify(long.groups.map((g) => g.shots.length)))
  check('no grid exceeds 9 cells', long.groups.every((g) => g.shots.length <= 9), JSON.stringify(long.groups.map((g) => g.shots.length)))
  check('every shot lands in a grid or a single', long.groups.flatMap((g) => g.shots).length + long.singles.length === 14, JSON.stringify([long.groups.map((g) => g.shots.length), long.singles.length]))

  const unordered = planGridGroups([
    { id: 'b', index: 1, sceneId: 'hall' },
    { id: 'a', index: 0, sceneId: 'hall' },
  ])
  check('grouping sorts by shot index', unordered.groups[0]?.shots.map((s) => s.id).join('') === 'ab', JSON.stringify(unordered.groups))
}

// —— prompt：分格说明必须明确，否则模型会自己乱排 ——
{
  const layout = GRID_LAYOUTS.grid_4
  const prompt = buildGridPrompt(layout, ['wide shot of the hall', 'close-up on the letter'], { styleAnchor: 'cinematic', sceneHint: '正殿' })
  check('prompt states the grid shape', prompt.includes('2x2') && prompt.includes('4 separate film frames'), prompt)
  check('prompt fixes the cell numbering order', prompt.includes('left-to-right, then top-to-bottom'), prompt)
  check('prompt demands cross-cell consistency', prompt.includes('identical characters') && prompt.includes('lighting direction'), prompt)
  check('prompt lists each cell', prompt.includes('Cell 1: wide shot of the hall') && prompt.includes('Cell 2: close-up on the letter'), prompt)
  check('prompt tells the model to leave spare cells empty', prompt.includes('Cells 3-4'), prompt)
  check('prompt forbids baked-in captions', prompt.includes('No captions'), prompt)
  check('prompt carries the style anchor and scene hint', prompt.includes('cinematic') && prompt.includes('正殿'), prompt)

  const full = buildGridPrompt(GRID_LAYOUTS.grid_4, ['a', 'b', 'c', 'd'])
  check('a full grid has no blank-cell instruction', !full.includes('leave as plain neutral background'), full)
}

// —— 首尾帧链：相邻格互为首/尾帧，让同场景视频段自然衔接 ——
{
  const group = { sceneId: 'hall', layout: GRID_LAYOUTS.grid_4, shots: [{ id: 'a', index: 0 }, { id: 'b', index: 1 }, { id: 'c', index: 2 }] }
  const chain = frameChainForGroup(group)
  check('each shot starts on its own cell', chain.map((c) => c.firstCell).join(',') === '0,1,2', JSON.stringify(chain))
  check('each shot ends on the next cell', chain[0].lastCell === 1 && chain[1].lastCell === 2, JSON.stringify(chain))
  check('the last shot has no end frame', chain[2].lastCell === undefined, JSON.stringify(chain))
}

console.log(failures ? `\ngridLayout selftest: ${failures} FAILED` : '\ngridLayout selftest: ALL PASSED')
if (failures) process.exit(1)

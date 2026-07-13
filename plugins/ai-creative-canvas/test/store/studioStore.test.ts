// studioStore 会话态单测（脱 React，直接驱动 zustand store）
// 覆盖计划 WS1-T4 要求：拖拽(updateOpLive×N)+commitLive 后 undo 一步回到拖拽前，不逐帧回放；
// 以及 B11 修复：点击滑块未拖动(commitLive 无变化)不产生重复 undo 步；history 有上限。
import assert from 'node:assert/strict'
import { useStudio } from '../../src/ui/store/studioStore.ts'
import type { ColorParams, EditRecipe } from '../../src/ui/services/videoEdit/types.ts'

function colorRecipe(brightness = 0): EditRecipe {
  return { version: 1, baseDuration: 10, ops: [{ id: 'c1', kind: 'color', enabled: true, params: { brightness } }] as never }
}
function brightnessOf(): number {
  const st = useStudio.getState().stack!
  const op = st.ops.find((o) => o.id === 'c1')!
  return (op.params as ColorParams).brightness ?? 0
}

function testDragThenUndoIsOneStep() {
  const s = useStudio.getState()
  s.open('card1', { duration: 10, w: 1920, h: 1080 }, colorRecipe(0))
  assert.equal(useStudio.getState().history.length, 1, 'open → 1 history entry')
  assert.equal(useStudio.getState().cursor, 0)

  // 模拟拖拽滑块：多帧 updateOpLive（不入历史）
  s.updateOpLive('c1', { brightness: 0.1 })
  s.updateOpLive('c1', { brightness: 0.2 })
  s.updateOpLive('c1', { brightness: 0.3 })
  assert.equal(useStudio.getState().history.length, 1, 'live updates do not push history')
  assert.equal(brightnessOf(), 0.3, 'live value applied to stack')

  // 松手：commitLive 压入一步
  s.commitLive()
  assert.equal(useStudio.getState().history.length, 2, 'commitLive pushes exactly one step')
  assert.equal(useStudio.getState().cursor, 1)

  // undo 一步 → 回到拖拽前（0），而非逐帧回放 0.2/0.1
  useStudio.getState().undo()
  assert.equal(useStudio.getState().cursor, 0)
  assert.equal(brightnessOf(), 0, 'single undo returns to pre-drag value')
}

function testClickNoDragNoDuplicateStep() {
  const s = useStudio.getState()
  s.open('card2', { duration: 10, w: 1920, h: 1080 }, colorRecipe(0.5))
  const before = useStudio.getState().history.length
  // 点击滑块但未改值：onPointerUp / onKeyUp 触发 commitLive，stack 未变
  s.commitLive()
  s.commitLive()
  assert.equal(useStudio.getState().history.length, before, 'commitLive without change pushes nothing')
}

function testHistoryCap() {
  const s = useStudio.getState()
  s.open('card3', { duration: 10, w: 1920, h: 1080 }, colorRecipe(0))
  for (let i = 1; i <= 150; i++) {
    s.updateOpLive('c1', { brightness: i / 1000 })
    s.commitLive()
  }
  const h = useStudio.getState().history
  assert.ok(h.length <= 100, `history capped at 100, got ${h.length}`)
  // 上限后 cursor 仍指向末项，undo 可用
  assert.equal(useStudio.getState().cursor, h.length - 1)
  assert.ok(useStudio.getState().canUndo(), 'can still undo after cap')
}

function main() {
  testDragThenUndoIsOneStep()
  testClickNoDragNoDuplicateStep()
  testHistoryCap()
  console.log('studioStore: 3 tests OK')
}

main()

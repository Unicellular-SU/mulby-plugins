// graphStore 撤销栈单测（脱 React，直接驱动 zustand store）
// 覆盖 C1 修复的核心不变量：调用方在离散编辑前 pushHistory() 后，
//   ① resize 类改动(pushHistory + updateCard) 可被 undo 一步回到原值；
//   ② undo 后再做一次新编辑(pushHistory 清 future)，redo 不再覆盖新改动。
// resize/重命名/便签/折叠/换色 的真实修复在各 View 调用方，这里锁定 store 层被依赖的语义。
import assert from 'node:assert/strict'
import { useGraph, createDefaultProject } from '../../src/ui/store/graphStore.ts'

function reset() {
  useGraph.setState({ project: createDefaultProject(), selectedIds: [], past: [], future: [] })
}

function testResizeThenUndo() {
  reset()
  const g = useGraph.getState()
  const id = g.addCard('note', { x: 0, y: 0 }, { w: 280, h: 200 })
  assert.equal(useGraph.getState().getCard(id)!.w, 280)

  // 模拟 resize 提交：先 pushHistory（捕获原尺寸）再 updateCard（新尺寸）——即 CardView.startCardResize 首帧的行为
  useGraph.getState().pushHistory()
  useGraph.getState().updateCard(id, { w: 600, h: 500 })
  assert.equal(useGraph.getState().getCard(id)!.w, 600)

  useGraph.getState().undo()
  assert.equal(useGraph.getState().getCard(id)!.w, 280, 'undo restores original width in one step')
  assert.equal(useGraph.getState().getCard(id)!.h, 200)
}

function testUndoThenEditDoesNotClobberOnRedo() {
  reset()
  const g = useGraph.getState()
  const id = g.addCard('note', { x: 0, y: 0 }, { w: 280, h: 200 })

  // 编辑 A：宽 → 600
  useGraph.getState().pushHistory()
  useGraph.getState().updateCard(id, { w: 600 })
  // 撤销 A：回到 280，future 存有 A 态
  useGraph.getState().undo()
  assert.equal(useGraph.getState().getCard(id)!.w, 280)
  assert.equal(useGraph.getState().canRedo(), true, 'future populated after undo')

  // 编辑 B（新的 resize）：pushHistory 必须清空 future，否则 redo 会用旧快照覆盖 B
  useGraph.getState().pushHistory()
  useGraph.getState().updateCard(id, { w: 700 })
  assert.equal(useGraph.getState().canRedo(), false, 'new edit clears redo branch')

  // redo 无效（future 已清），B 不被覆盖
  useGraph.getState().redo()
  assert.equal(useGraph.getState().getCard(id)!.w, 700, 'redo does not clobber the post-undo edit')
}

function main() {
  testResizeThenUndo()
  testUndoThenEditDoesNotClobberOnRedo()
  console.log('graphStore: 2 tests OK')
}

main()

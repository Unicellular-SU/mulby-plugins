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

function testCopyGroupCarriesMembersAndEdges() {
  reset()
  const g = useGraph.getState()
  // 编组：两张卡 + 一条连线，都在组内
  const a = g.addCard('image', { x: 0, y: 0 })
  const b = g.addCard('text', { x: 100, y: 0 })
  g.addEdgeBetween(a, b)
  const board0 = useGraph.getState().getActiveBoard()
  const edgeCount0 = Object.keys(board0.edges).length
  assert.equal(edgeCount0, 1, 'one edge created')
  g.setSelection([a, b])
  g.groupSelection()
  // 找到刚建的组（selectedIds 变为 [groupId]）
  const groupId = useGraph.getState().selectedIds[0]
  assert.ok(groupId, 'group created and selected')

  // 只选中组 → 复制 → 粘贴
  const cardCountBefore = Object.keys(useGraph.getState().getActiveBoard().cards).length
  useGraph.getState().setSelection([groupId])
  useGraph.getState().copySelection()
  useGraph.getState().paste(40, 40)

  const board = useGraph.getState().getActiveBoard()
  const cardCountAfter = Object.keys(board.cards).length
  // 原 3 张(组+2成员) → 粘贴应再加 3 张，而非只加 1 个空组框
  assert.equal(cardCountAfter - cardCountBefore, 3, 'paste carries group + both members (not empty frame)')
  // 连线也应复制（内部两端都在剪贴板内）
  assert.equal(Object.keys(board.edges).length, 2, 'internal edge duplicated on paste')
}

function main() {
  testResizeThenUndo()
  testUndoThenEditDoesNotClobberOnRedo()
  testCopyGroupCarriesMembersAndEdges()
  console.log('graphStore: 3 tests OK')
}

main()

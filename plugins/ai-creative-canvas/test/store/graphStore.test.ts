// graphStore 撤销栈单测（脱 React，直接驱动 zustand store）
// 覆盖 C1 修复的核心不变量：调用方在离散编辑前 pushHistory() 后，
//   ① resize 类改动(pushHistory + updateCard) 可被 undo 一步回到原值；
//   ② undo 后再做一次新编辑(pushHistory 清 future)，redo 不再覆盖新改动。
// resize/重命名/便签/折叠/换色 的真实修复在各 View 调用方，这里锁定 store 层被依赖的语义。
import assert from 'node:assert/strict'
import { useGraph, createDefaultProject } from '../../src/ui/store/graphStore.ts'

function reset() {
  useGraph.setState({ project: createDefaultProject(), selectedIds: [], boardHistories: {} })
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

function testCreateConnectedNodeSkipsNoteSource() {
  reset()
  const g = useGraph.getState()
  const note = g.addCard('note', { x: 0, y: 0 })
  const img = g.addCard('image', { x: 200, y: 0 })
  // 从 [便签, 图片] 连出一个新文本节点：便签源应被 canConnect 过滤，仅图片建边
  const newId = useGraph.getState().createConnectedNode('text', { x: 400, y: 0 }, [note, img])
  const edges = Object.values(useGraph.getState().getActiveBoard().edges)
  const toNew = edges.filter((e) => e.target === newId)
  assert.equal(toNew.length, 1, 'only the image source connects; note source is skipped')
  assert.equal(toNew[0].source, img, 'the surviving edge is from the image card')
}

function testPerBoardHistorySurvivesSwitch() {
  reset()
  const g = useGraph.getState()
  const boardA = useGraph.getState().project.activeBoardId
  const a = g.addCard('note', { x: 0, y: 0 }, { w: 280 })
  g.pushHistory()
  g.updateCard(a, { w: 600 })
  assert.equal(useGraph.getState().canUndo(), true, 'board A has undo history')

  // 新建并切到画布 B：A 的历史不应被清空
  g.addBoard()
  const boardB = useGraph.getState().project.activeBoardId
  assert.notEqual(boardA, boardB)
  assert.equal(useGraph.getState().canUndo(), false, 'new board B starts with empty history')

  // 切回 A：撤销仍可用，且能回退尺寸
  useGraph.getState().setActiveBoard(boardA)
  assert.equal(useGraph.getState().canUndo(), true, 'board A history preserved across switch')
  useGraph.getState().undo()
  assert.equal(useGraph.getState().getCard(a)!.w, 280, 'undo on board A still works after switching away and back')
}

function main() {
  testResizeThenUndo()
  testUndoThenEditDoesNotClobberOnRedo()
  testCopyGroupCarriesMembersAndEdges()
  testCreateConnectedNodeSkipsNoteSource()
  testPerBoardHistorySurvivesSwitch()
  console.log('graphStore: 5 tests OK')
}

main()

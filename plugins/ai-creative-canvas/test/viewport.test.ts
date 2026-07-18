import assert from 'node:assert/strict'
import { classifyWheel, zoomAt, type WheelSample } from '../src/ui/canvas/viewport.ts'

function wheel(patch: Partial<WheelSample>): WheelSample {
  return { deltaX: 0, deltaY: 0, deltaMode: 0, ctrlKey: false, metaKey: false, ...patch }
}

// 捏合（ctrlKey + 小 deltaY）→ 缩放，方向正确
function testPinchZoom() {
  const pinchIn = classifyWheel(wheel({ ctrlKey: true, deltaY: 10 }))
  assert.equal(pinchIn.kind, 'zoom')
  if (pinchIn.kind === 'zoom') assert.ok(pinchIn.factor < 1) // 正 deltaY = 缩小
  const spreadOut = classifyWheel(wheel({ ctrlKey: true, deltaY: -10 }))
  if (spreadOut.kind === 'zoom') assert.ok(spreadOut.factor > 1) // 负 deltaY = 放大
}

// Cmd+滚轮 → 缩放，走小步长（比捏合灵敏度低）
function testModifierWheelZoom() {
  const pinch = classifyWheel(wheel({ ctrlKey: true, deltaY: 40 }))
  const cmd = classifyWheel(wheel({ metaKey: true, deltaY: 40 }))
  assert.equal(pinch.kind, 'zoom')
  assert.equal(cmd.kind, 'zoom')
  // 同为缩小(factor<1)，捏合灵敏度更高 → 更接近 0（缩得更多）
  if (pinch.kind === 'zoom' && cmd.kind === 'zoom') assert.ok(pinch.factor < cmd.factor)
}

// 普通 wheel（无修饰键）→ 平移，方向取负（内容跟手）——触控板两指滑动与鼠标滚轮同此路径
function testPlainWheelPans() {
  const twoFinger = classifyWheel(wheel({ deltaX: 12, deltaY: 8 }))
  assert.equal(twoFinger.kind, 'pan')
  if (twoFinger.kind === 'pan') {
    assert.equal(twoFinger.dx, -12)
    assert.equal(twoFinger.dy, -8)
  }
  // 鼠标滚轮 chunky 整数 deltaY 同样平移（不再猜测设备类型）
  const mouseNotch = classifyWheel(wheel({ deltaY: 120 }))
  assert.equal(mouseNotch.kind, 'pan')
  if (mouseNotch.kind === 'pan') assert.equal(mouseNotch.dy, -120)
  // 细腻/非整 deltaY（触控板惯性帧）也平移
  assert.equal(classifyWheel(wheel({ deltaY: 3.5 })).kind, 'pan')
}

// 行/页模式（老式鼠标）平移换算成像素步长，避免一格滚过头
function testDeltaModeScaling() {
  const lines = classifyWheel(wheel({ deltaY: 3, deltaMode: 1 })) // 3 行
  assert.equal(lines.kind, 'pan')
  if (lines.kind === 'pan') assert.equal(lines.dy, -48) // 3 * 16px
  const pages = classifyWheel(wheel({ deltaY: 1, deltaMode: 2 })) // 1 页
  if (pages.kind === 'pan') assert.equal(pages.dy, -400)
}

// Shift+滚轮：浏览器把 deltaY 挪到 deltaX → 横向平移（无需特殊处理，deltaX 直接进平移）
function testShiftWheelHorizontalPan() {
  const r = classifyWheel(wheel({ deltaX: 100 }))
  assert.equal(r.kind, 'pan')
  if (r.kind === 'pan') {
    assert.equal(r.dx, -100)
    assert.equal(r.dy + 0, 0) // +0 归一化 -0（-0 无害，仅 strictEqual 不认）
  }
}

// zoomAt 朝光标缩放保持光标处世界点不动
function testZoomAtAnchor() {
  const v = { x: 0, y: 0, zoom: 1 }
  const out = zoomAt(v, 200, 150, 2)
  assert.equal((200 - out.x) / out.zoom, (200 - v.x) / v.zoom)
  assert.equal((150 - out.y) / out.zoom, (150 - v.y) / v.zoom)
}

testPinchZoom()
testModifierWheelZoom()
testPlainWheelPans()
testDeltaModeScaling()
testShiftWheelHorizontalPan()
testZoomAtAnchor()
console.log('viewport: 6 tests OK')

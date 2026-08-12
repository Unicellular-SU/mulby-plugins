import assert from 'node:assert/strict'
import { buildInpaintInstruction, normalizedAnnotationTexts } from '../src/ui/services/inpaintGuidance.ts'

function testMaskedRepaintWithAnnotations() {
  const instruction = buildInpaintInstruction({
    op: 'repaint',
    prompt: '保持人物姿势',
    hasMask: true,
    hasAnnotations: true,
    annotationTexts: [' 换成红色外套 ', '换成红色外套']
  })
  assert.match(instruction, /透明.*待修改区域/)
  assert.match(instruction, /换成红色外套/)
  assert.match(instruction, /保持人物姿势/)
  assert.match(instruction, /最终结果必须完全移除箭头、标注框和标注文字/)
  assert.equal((instruction.match(/换成红色外套/g) || []).length, 1, '重复的图上文字应去重')
}

function testAnnotationOnlyRepaint() {
  const instruction = buildInpaintInstruction({
    op: 'repaint',
    prompt: '',
    hasMask: false,
    hasAnnotations: true,
    annotationTexts: ['把这里改成玻璃窗']
  })
  assert.match(instruction, /箭头和文字标注定位待修改区域/)
  assert.match(instruction, /把这里改成玻璃窗/)
  assert.doesNotMatch(instruction, /透明（被挖空）/)
}

function testAnnotationOnlyRemove() {
  const instruction = buildInpaintInstruction({
    op: 'remove',
    prompt: '补齐墙面纹理',
    hasMask: false,
    hasAnnotations: true,
    annotationTexts: []
  })
  assert.match(instruction, /移除被指示的物体或内容/)
  assert.match(instruction, /补齐墙面纹理/)
  assert.match(instruction, /其余区域严格保持与原图一致/)
}

assert.deepEqual(normalizedAnnotationTexts([' A ', '', 'A', 'B']), ['A', 'B'])
testMaskedRepaintWithAnnotations()
testAnnotationOnlyRepaint()
testAnnotationOnlyRemove()
console.log('inpaint guidance: 12 assertions OK')

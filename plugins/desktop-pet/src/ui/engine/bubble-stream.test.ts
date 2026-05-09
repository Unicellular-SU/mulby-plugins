import {
  buildBubbleDetailState,
  buildBubblePreviewState,
  estimateBubbleWindowSize,
  normalizeBubbleStreamPayload,
} from './bubble-stream'

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message)
}

function assertEqual<T>(actual: T, expected: T) {
  if (actual !== expected) {
    throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

function testPreviewUsesTailOfLongReasoning() {
  const reasoning = Array.from({ length: 9 }, (_, i) => `推理第 ${i + 1} 行`).join('\n')
  const preview = buildBubblePreviewState({ reply: '', reasoning })

  assertEqual(preview.reply, '')
  assertEqual(preview.hasReasoning, true)
  assertEqual(preview.reasoningChars, reasoning.length)
  assertEqual(preview.reasoningPreview, '推理第 6 行\n推理第 7 行\n推理第 8 行\n推理第 9 行')
  assertEqual(preview.statusLabel, '思考中')
}

function testPreviewKeepsReplyVisibleWhenReasoningExists() {
  const preview = buildBubblePreviewState({
    reply: '最终回复在这里。',
    reasoning: '第一步\n第二步\n第三步\n第四步\n第五步',
  })

  assertEqual(preview.reply, '最终回复在这里。')
  assertEqual(preview.hasReasoning, true)
  assertEqual(preview.reasoningPreview, '')
  assertEqual(preview.statusLabel, '已思考')
}

function testPreviewCapsSingleLongReasoningLine() {
  const preview = buildBubblePreviewState({
    reply: '',
    reasoning: '这是一段没有换行的推理'.repeat(80),
  })

  assert(preview.reasoningPreview.length <= 180, `preview should stay compact, got ${preview.reasoningPreview.length}`)
  assert(preview.reasoningPreview.endsWith('...'), 'truncated preview should end with ellipsis')
}

function testDetailKeepsFullStreamingContent() {
  const reasoning = 'A'.repeat(9000)
  const detail = buildBubbleDetailState({ reply: '最终回复', reasoning })

  assertEqual(detail.reply, '最终回复')
  assertEqual(detail.reasoning, reasoning)
  assertEqual(detail.reasoningChars, reasoning.length)
}

function testNormalizeAcceptsLegacyStringPayload() {
  const normalized = normalizeBubbleStreamPayload('普通气泡')

  assertEqual(normalized.reply, '普通气泡')
  assertEqual(normalized.reasoning, '')
}

function testWindowSizeCoversReasoningSummaryReplyAndHint() {
  const size = estimateBubbleWindowSize({
    reply: '收到啦。',
    reasoning: '第一步：观察上下文。',
  })

  assert(size.height >= 70, `reasoning reply bubble needs room for summary, reply and hint, got ${size.height}`)
}

testPreviewUsesTailOfLongReasoning()
testPreviewKeepsReplyVisibleWhenReasoningExists()
testPreviewCapsSingleLongReasoningLine()
testDetailKeepsFullStreamingContent()
testNormalizeAcceptsLegacyStringPayload()
testWindowSizeCoversReasoningSummaryReplyAndHint()

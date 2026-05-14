import {
  ACTION_LIST,
  EMOTION_LIST,
  extractStageDirectionIntents,
  extractInlineEmotionIntents,
  inferPresentationFromText,
  normalizePresentationToolCall,
  presentationIntentForAction,
  stripPresentationMarkers,
  stripInlineEmotionMarkers,
} from './presentation'

function assertEqual<T>(actual: T, expected: T) {
  if (actual !== expected) {
    throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

function assertDeepEqual(actual: unknown, expected: unknown) {
  const actualJson = JSON.stringify(actual)
  const expectedJson = JSON.stringify(expected)
  if (actualJson !== expectedJson) {
    throw new Error(`Expected ${expectedJson}, got ${actualJson}`)
  }
}

function testStripInlineEmotionMarkers() {
  const input = '[surprised]噗--你说啥？[excited]好好好！[happy]慢慢讲。'
  const actual = stripInlineEmotionMarkers(input)
  assertEqual(actual, '噗--你说啥？好好好！慢慢讲。')
}

function testExtractInlineExpressionAliases() {
  const input = '[surprised]喂喂喂！\n\n[excited]左摇右晃。\n\n[curious]我看看。\n\n[focused]该认真了。'
  assertDeepEqual(extractInlineEmotionIntents(input), [
    { face: 'surprised', emotion: 'surprise' },
    { face: 'excited', emotion: 'excitement' },
    { face: 'curious', emotion: 'curiosity' },
    { face: 'focused', emotion: 'focus' },
  ])
}

function testNormalizeToolCalls() {
  assertDeepEqual(
    normalizePresentationToolCall('pet_show_expression', { expression: 'happy', emotion: 'joy' }),
    { face: 'happy', emotion: 'joy' }
  )
  assertDeepEqual(
    normalizePresentationToolCall('pet_perform_action', { action: 'jump', emotion: 'excitement', durationMs: 3000 }),
    { face: 'excited', pose: 'jump', emotion: 'excitement', animation: 'ascend', durationMs: 3000 }
  )
  assertDeepEqual(
    normalizePresentationToolCall('pet_update_mood', { emotion: 'anger' }),
    { face: 'angry', emotion: 'anger' }
  )
  assertDeepEqual(
    normalizePresentationToolCall('pet_update_mood', { emotion: 'proud' }),
    { face: 'proud', emotion: 'pride' }
  )
  assertDeepEqual(
    normalizePresentationToolCall('pet_show_expression', { expression: 'curious', emotion: 'curious' }),
    { face: 'curious', emotion: 'curiosity' }
  )
  assertDeepEqual(
    normalizePresentationToolCall('pet_move', { direction: 'up', distance: 90, durationMs: 1200 }),
    { face: 'neutral', pose: 'walk_1', movement: { dx: 0, dy: -90 }, durationMs: 1200 }
  )
  assertDeepEqual(
    normalizePresentationToolCall('pet_perform_action', { action: 'cheer' }),
    { face: 'excited', pose: 'wave', emotion: 'excitement', animation: 'spin_bounce' }
  )
  assertDeepEqual(
    normalizePresentationToolCall('pet_perform_action', { action: 'celebrate' }),
    { face: 'love', pose: 'wave', emotion: 'joy', animation: 'celebrate' }
  )
  assertDeepEqual(
    normalizePresentationToolCall('pet_perform_action', { action: 'peek' }),
    { face: 'curious', pose: 'peek', emotion: 'curiosity', animation: 'phase' }
  )
  assertDeepEqual(
    normalizePresentationToolCall('pet_set_presentation', { face: 'focused', pose: 'focus' }),
    { face: 'focused', pose: 'focus' }
  )
}

function testActionIntentHelperMatchesToolCallMapping() {
  for (const action of ['idle', 'stand', 'look', 'chase', 'wander', 'walk', 'walk_1', 'walk_2', 'sit', 'sleep', 'jump', 'wave', 'surprised', 'happy', 'cheer', 'celebrate', 'wobble', 'hover', 'peek', 'spin', 'dance', 'hide', 'focus'] as const) {
    assertDeepEqual(
      presentationIntentForAction(action),
      normalizePresentationToolCall('pet_perform_action', { action })
    )
  }
  assertDeepEqual(
    presentationIntentForAction('move_right', { durationMs: 1800 }),
    { face: 'neutral', pose: 'walk_1', movement: { dx: 80, dy: 0 }, durationMs: 1800 }
  )
}

function testListsCoverRuntimeAliases() {
  for (const value of ['happy', 'excited', 'surprised', 'sad', 'sleepy', 'angry', 'shy', 'neutral', 'curious', 'confused', 'proud', 'scared', 'focused', 'dizzy']) {
    if (!EMOTION_LIST.includes(value as never)) throw new Error(`Missing emotion alias: ${value}`)
  }
  for (const value of ['move_left', 'move_right', 'move_up', 'move_down', 'wobble', 'celebrate', 'wave', 'jump', 'hover', 'peek', 'spin', 'dance', 'hide', 'focus']) {
    if (!ACTION_LIST.includes(value as never)) throw new Error(`Missing action: ${value}`)
  }
}

function testInferPresentationFromPlainReply() {
  assertDeepEqual(
    inferPresentationFromText('喂喂喂，你键盘都冒火星子了！这是要冲出地球吗？'),
    { face: 'surprised', emotion: 'surprise', pose: 'stand', animation: 'phase' }
  )
  assertDeepEqual(
    inferPresentationFromText('这节奏还挺上头，我左摇右晃跟着打节拍。'),
    { face: 'excited', emotion: 'excitement', pose: 'dance', animation: 'wobble' }
  )
  assertDeepEqual(
    inferPresentationFromText('切，又戳我？你是戳上瘾了是吧？'),
    { face: 'angry', emotion: 'anger', pose: 'stand', animation: 'flicker' }
  )
  assertDeepEqual(
    inferPresentationFromText('让我看看这段代码，先认真排查一下。'),
    { face: 'focused', emotion: 'focus', pose: 'focus', animation: 'phase' }
  )
  assertDeepEqual(
    inferPresentationFromText('我有点看不懂这个报错，懵了。'),
    { face: 'confused', emotion: 'confusion', pose: 'stand', animation: 'wobble' }
  )
  assertDeepEqual(
    inferPresentationFromText('这波拿捏了，夸我。'),
    { face: 'proud', emotion: 'pride', pose: 'wave', animation: 'bounce' }
  )
}

function testStageDirectionsAreHiddenAndConvertedToPresentation() {
  const input = '（打了个呵欠飘到你鼠标旁边，绕着你的手转了两圈）我说你是不是手指头长刺了？'

  assertEqual(stripPresentationMarkers(input), '我说你是不是手指头长刺了？')
  assertDeepEqual(extractStageDirectionIntents(input), [
    { face: 'sleepy', emotion: 'sleepiness', pose: 'sit', animation: 'droop' },
    { face: 'dizzy', emotion: 'dizziness', pose: 'spin', animation: 'wobble' },
    { face: 'curious', emotion: 'curiosity', pose: 'hover', animation: 'phase', movement: { dx: 80, dy: -20 } },
  ])
}

function testStageDirectionsCoverAttitudeAndTurningAway() {
  const input = '（一脸不耐烦地转过身去，把屁股对着你）我数三下。'

  assertEqual(stripPresentationMarkers(input), '我数三下。')
  assertDeepEqual(extractStageDirectionIntents(input), [
    { face: 'angry', emotion: 'anger', pose: 'stand', animation: 'flicker' },
    { face: 'shy', emotion: 'shyness', pose: 'hide', animation: 'hide', movement: { dx: -80, dy: 0 } },
  ])
}

function testStageDirectionsAfterToolStyleNarration() {
  const input = '（飘到桌角背对着你，尾巴还在不满地抖来抖去）看什么看？'

  assertEqual(stripPresentationMarkers(input), '看什么看？')
  assertDeepEqual(extractStageDirectionIntents(input), [
    { face: 'angry', emotion: 'anger', pose: 'stand', animation: 'flicker' },
    { face: 'curious', emotion: 'curiosity', pose: 'hover', animation: 'phase', movement: { dx: 80, dy: -20 } },
    { face: 'excited', emotion: 'excitement', pose: 'dance', animation: 'wobble', movement: { dx: 80, dy: -20 } },
    { face: 'shy', emotion: 'shyness', pose: 'hide', animation: 'hide', movement: { dx: -80, dy: 0 } },
  ])
}

function testHintDoesNotOverridePartialStageDirection() {
  assertDeepEqual(inferPresentationFromText('（', 'user_click'), null)
}

function testImplicitPresentationDoesNotJump() {
  assertDeepEqual(
    normalizePresentationToolCall('pet_perform_action', { action: 'surprised' }),
    { face: 'surprised', pose: 'stand', emotion: 'surprise', animation: 'phase' }
  )
  assertDeepEqual(
    inferPresentationFromText('', 'typing_fast'),
    { face: 'focused', emotion: 'focus', pose: 'focus', animation: 'spin_bounce' }
  )
  assertDeepEqual(
    inferPresentationFromText('', 'behavior_change'),
    { face: 'surprised', emotion: 'surprise', pose: 'stand', animation: 'phase' }
  )
}

testStripInlineEmotionMarkers()
testExtractInlineExpressionAliases()
testNormalizeToolCalls()
testActionIntentHelperMatchesToolCallMapping()
testListsCoverRuntimeAliases()
testInferPresentationFromPlainReply()
testStageDirectionsAreHiddenAndConvertedToPresentation()
testStageDirectionsCoverAttitudeAndTurningAway()
testStageDirectionsAfterToolStyleNarration()
testHintDoesNotOverridePartialStageDirection()
testImplicitPresentationDoesNotJump()

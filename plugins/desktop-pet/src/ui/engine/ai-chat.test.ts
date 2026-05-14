import { buildCurrentTimeContext, compactPetReply } from './ai-chat'

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message)
}

function testCompactPetReplyRemovesPresentationNoiseAndKeepsBubbleShort() {
  const input = '[excited]喂喂喂，你键盘都冒火星子了！这是要冲出地球还是咋的？\n\n不过说真的，你这噼里啪啦的节奏还挺上头，我左摇右晃跟着打节拍。第三句不该出现在普通气泡里。'
  const actual = compactPetReply(input)

  assert(!actual.includes('[excited]'), 'presentation marker should be removed')
  assert(!actual.includes('第三句'), 'ordinary pet reply should keep at most two sentence-sized beats')
  assert(actual.length <= 70, `reply should fit a pet bubble, got ${actual.length}: ${actual}`)
}

function testCompactPetReplyHidesStageDirections() {
  const input = '（打了个呵欠飘到你鼠标旁边，绕着你的手转了两圈） 我说你是不是手指头长刺了？'
  const actual = compactPetReply(input)

  assert(!actual.includes('打了个呵欠'), 'stage action should not be shown as dialogue')
  assert(!actual.includes('绕着你的手'), 'movement narration should be converted to presentation instead of shown')
  assert(actual.startsWith('我说'), `dialogue should remain: ${actual}`)
}

function testCurrentTimeContextIncludesConcreteLocalDateAndTime() {
  const actual = buildCurrentTimeContext(new Date(2026, 4, 11, 10, 4))

  assert(actual.includes('2026年5月11日'), `time context should include local date: ${actual}`)
  assert(actual.includes('10:04'), `time context should include local time: ${actual}`)
  assert(actual.includes('UTC'), `time context should include utc offset: ${actual}`)
}

testCompactPetReplyRemovesPresentationNoiseAndKeepsBubbleShort()
testCompactPetReplyHidesStageDirections()
testCurrentTimeContextIncludesConcreteLocalDateAndTime()

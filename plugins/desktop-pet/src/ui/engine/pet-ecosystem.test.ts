import {
  applyNeedEvent,
  applyQuestEvent,
  classifyWorkMode,
  createDailyQuests,
  decayNeeds,
  expressionFromNeeds,
  normalizeGameStats,
  normalizeTimeline,
  recordGamePlayed,
  recordGameResult,
} from './pet-ecosystem'

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message)
}

function assertEqual<T>(actual: T, expected: T) {
  if (actual !== expected) throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
}

function testNeedsDecayAndEventsStayBounded() {
  const start = {
    energy: 99,
    attention: 99,
    curiosity: 99,
    focus: 99,
    hydration: 99,
    updatedAt: 1_000,
  }
  const decayed = decayNeeds(start, 1_000 + 10 * 60_000)
  assert(decayed.hydration < start.hydration, 'hydration should decay over time')
  assert(decayed.curiosity <= 100 && decayed.curiosity >= start.curiosity, 'curiosity should rise without exceeding 100')

  const next = applyNeedEvent(decayed, 'pomodoro_complete', 1_000 + 11 * 60_000)
  assert(next.focus <= 100, 'focus should remain bounded')
  assert(next.energy < decayed.energy, 'pomodoro completion should spend energy')
  assertEqual(expressionFromNeeds({ ...next, focus: 90 }), 'focused')
}

function testWorkModeClassificationUsesTitleOnlyWhenAllowed() {
  assertEqual(classifyWorkMode({ app: 'Cursor', title: 'notes' }), 'coding')
  assertEqual(classifyWorkMode({ app: 'Safari', title: 'pull request review' }, false), 'browsing')
  assertEqual(classifyWorkMode({ app: 'Safari', title: 'pull request review' }, true), 'coding')
  assertEqual(classifyWorkMode({ app: 'Zoom', title: 'Weekly sync' }), 'meeting')
}

function testDailyQuestsApplyAndResetByDate() {
  const day1 = Date.parse('2026-05-10T10:00:00.000Z')
  const state = createDailyQuests('2026-05-10')
  const afterChat = applyQuestEvent(state, 'chat', day1)
  assert(afterChat.quests.find(q => q.id === 'chat_once')?.completed, 'chat quest should complete')

  const afterFocus = applyQuestEvent(afterChat, 'pomodoro_complete', day1)
  assert(afterFocus.quests.find(q => q.id === 'focus_once')?.completed, 'focus quest should complete')

  const day2 = Date.parse('2026-05-11T10:00:00.000Z')
  const reset = applyQuestEvent(afterFocus, 'game_played', day2)
  assert(!reset.quests.find(q => q.id === 'chat_once')?.completed, 'new day should reset chat quest')
  assert(reset.quests.find(q => q.id === 'game_once')?.completed, 'game quest should complete on new day')
}

function testGameStatsScoringAndStreaks() {
  const day = Date.parse('2026-05-10T10:00:00.000Z')
  const played = recordGamePlayed(normalizeGameStats(null, '2026-05-10'), day)
  assertEqual(played.playedToday, 1)
  const correct = recordGameResult(played, true, day)
  assertEqual(correct.correctToday, 1)
  assertEqual(correct.streak, 1)
  assert(correct.score > played.score, 'correct answer should add score')
  const wrong = recordGameResult(correct, false, day)
  assertEqual(wrong.streak, 0)
}

function testTimelineNormalizationDropsUnsafeShapeAndTrims() {
  const events = normalizeTimeline([
    { id: 'x', type: 'work_mode', label: '  切换到编码模式  ', at: 1, mode: 'coding', app: 'Cursor', title: 'secret.ts' },
    { id: 'bad', type: 'empty', label: '', at: 2 },
  ])
  assertEqual(events.length, 1)
  assertEqual(events[0].label, '切换到编码模式')
  assertEqual(events[0].mode, 'coding')
  assert(!('title' in events[0]), 'timeline must not keep window title')
}

testNeedsDecayAndEventsStayBounded()
testWorkModeClassificationUsesTitleOnlyWhenAllowed()
testDailyQuestsApplyAndResetByDate()
testGameStatsScoringAndStreaks()
testTimelineNormalizationDropsUnsafeShapeAndTrims()

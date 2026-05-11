import type { ActiveWindowContext } from './ai-chat'
import type { PetExpression } from './pet-standard'
import { logPetPresentation } from './presentation-debug'

export const PET_NEEDS_STORAGE_KEY = 'pet-needs-v1'
export const PET_TIMELINE_STORAGE_KEY = 'pet-timeline-v1'
export const PET_QUESTS_STORAGE_KEY = 'pet-quests-v1'
export const PET_GAME_STATS_STORAGE_KEY = 'pet-game-stats-v1'
export const PET_ECOSYSTEM_SETTINGS_STORAGE_KEY = 'pet-ecosystem-settings-v1'

export type PetNeedKey = 'energy' | 'attention' | 'curiosity' | 'focus' | 'hydration'
export type WorkMode = 'coding' | 'writing' | 'meeting' | 'browsing' | 'focus' | 'casual'
export type QuestEvent = 'interaction' | 'chat' | 'pomodoro_complete' | 'game_played' | 'game_correct'

export interface PetNeedsSnapshot extends Record<PetNeedKey, number> {
  updatedAt: number
}

export interface PetTimelineEvent {
  id: string
  type: string
  label: string
  at: number
  mode?: WorkMode
  app?: string
  score?: number
}

export interface PetQuest {
  id: 'chat_once' | 'focus_once' | 'game_once'
  title: string
  desc: string
  target: number
  progress: number
  completed: boolean
  completedAt?: number
}

export interface PetQuestState {
  date: string
  quests: PetQuest[]
}

export interface PetGameStats {
  score: number
  playedTotal: number
  correctTotal: number
  streak: number
  bestStreak: number
  playedToday: number
  correctToday: number
  lastPlayedDate: string
}

export interface PetEcosystemSettings {
  workModeEnabled: boolean
  useWindowTitleContext: boolean
  routinesEnabled: boolean
  questsEnabled: boolean
  hydrationReminderMinutes: number
  eyeRestReminderMinutes: number
}

export interface PetEcosystemContext {
  mode: WorkMode
  modeLabel: string
  needs: PetNeedsSnapshot
  quests: PetQuestState
}

export const NEED_LABELS: Record<PetNeedKey, string> = {
  energy: '精力',
  attention: '关注',
  curiosity: '好奇',
  focus: '专注',
  hydration: '补水',
}

export const WORK_MODE_LABELS: Record<WorkMode, string> = {
  coding: '编码',
  writing: '写作',
  meeting: '会议',
  browsing: '浏览',
  focus: '专注',
  casual: '休闲',
}

export const DEFAULT_ECOSYSTEM_SETTINGS: PetEcosystemSettings = {
  workModeEnabled: true,
  useWindowTitleContext: false,
  routinesEnabled: true,
  questsEnabled: true,
  hydrationReminderMinutes: 45,
  eyeRestReminderMinutes: 90,
}

const MAX_TIMELINE_EVENTS = 160

const NEED_EVENT_DELTAS: Record<string, Partial<Record<PetNeedKey, number>>> = {
  startup: { energy: 4, attention: 4 },
  interaction: { attention: 12, curiosity: 4, energy: 2 },
  chat: { attention: 10, curiosity: 6 },
  pomodoro_start: { focus: 14, attention: -4 },
  pomodoro_complete: { focus: 18, energy: -8, attention: 8 },
  pomodoro_cancel: { focus: -8, attention: 4 },
  routine_hydration: { hydration: 20, attention: 4 },
  routine_rest: { energy: 10, focus: -5 },
  reminder: { attention: 5, curiosity: 2 },
  game_start: { curiosity: 10, attention: 5 },
  game_correct: { curiosity: 6, energy: 5, attention: 6 },
  game_wrong: { curiosity: 4, energy: -3 },
  work_coding: { focus: 12, curiosity: 4 },
  work_writing: { focus: 8, curiosity: 4 },
  work_meeting: { attention: -10, focus: 5 },
  work_browsing: { curiosity: 6, focus: -4 },
  work_focus: { focus: 16, attention: -6 },
  work_casual: { energy: 4, focus: -4 },
}

export function todayStr(now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10)
}

function clampPercent(value: unknown, fallback = 50): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(0, Math.min(100, Math.round(n)))
}

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, Math.round(n)))
}

function safeText(value: unknown, max = 80): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : ''
}

function makeId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

export function createDefaultNeeds(now = Date.now()): PetNeedsSnapshot {
  return {
    energy: 72,
    attention: 58,
    curiosity: 50,
    focus: 62,
    hydration: 76,
    updatedAt: now,
  }
}

export function normalizeNeeds(raw: unknown, now = Date.now()): PetNeedsSnapshot {
  const fallback = createDefaultNeeds(now)
  if (!raw || typeof raw !== 'object') return fallback
  const o = raw as Record<string, unknown>
  return {
    energy: clampPercent(o.energy, fallback.energy),
    attention: clampPercent(o.attention, fallback.attention),
    curiosity: clampPercent(o.curiosity, fallback.curiosity),
    focus: clampPercent(o.focus, fallback.focus),
    hydration: clampPercent(o.hydration, fallback.hydration),
    updatedAt: typeof o.updatedAt === 'number' && Number.isFinite(o.updatedAt) ? o.updatedAt : now,
  }
}

export function decayNeeds(raw: PetNeedsSnapshot, now = Date.now()): PetNeedsSnapshot {
  const current = normalizeNeeds(raw, now)
  const elapsedMinutes = Math.max(0, Math.min(24 * 60, Math.floor((now - current.updatedAt) / 60_000)))
  if (elapsedMinutes <= 0) return current
  return {
    energy: clampPercent(current.energy - elapsedMinutes * 0.035),
    attention: clampPercent(current.attention - elapsedMinutes * 0.025),
    curiosity: clampPercent(current.curiosity + elapsedMinutes * 0.018),
    focus: clampPercent(current.focus - elapsedMinutes * 0.04),
    hydration: clampPercent(current.hydration - elapsedMinutes * 0.16),
    updatedAt: now,
  }
}

export function applyNeedEvent(raw: PetNeedsSnapshot, event: string, now = Date.now()): PetNeedsSnapshot {
  const needs = decayNeeds(raw, now)
  const deltas = NEED_EVENT_DELTAS[event] ?? {}

  const next: PetNeedsSnapshot = { ...needs, updatedAt: now }
  for (const key of Object.keys(deltas) as PetNeedKey[]) {
    next[key] = clampPercent(next[key] + (deltas[key] ?? 0), next[key])
  }
  return next
}

export function expressionFromNeeds(needs: PetNeedsSnapshot): PetExpression {
  if (needs.energy <= 25) return 'sleepy'
  if (needs.hydration <= 22) return 'sad'
  if (needs.focus >= 78) return 'focused'
  if (needs.curiosity >= 76) return 'curious'
  if (needs.attention <= 22) return 'shy'
  return 'neutral'
}

export function normalizeEcosystemSettings(raw: unknown): PetEcosystemSettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_ECOSYSTEM_SETTINGS }
  const o = raw as Record<string, unknown>
  return {
    workModeEnabled: o.workModeEnabled === false ? false : DEFAULT_ECOSYSTEM_SETTINGS.workModeEnabled,
    useWindowTitleContext: o.useWindowTitleContext === true,
    routinesEnabled: o.routinesEnabled === false ? false : DEFAULT_ECOSYSTEM_SETTINGS.routinesEnabled,
    questsEnabled: o.questsEnabled === false ? false : DEFAULT_ECOSYSTEM_SETTINGS.questsEnabled,
    hydrationReminderMinutes: clampInteger(o.hydrationReminderMinutes, 45, 15, 180),
    eyeRestReminderMinutes: clampInteger(o.eyeRestReminderMinutes, 90, 20, 240),
  }
}

export function classifyWorkMode(windowInfo: ActiveWindowContext | null, useTitle = false): WorkMode {
  const app = windowInfo?.app?.toLowerCase() ?? ''
  const title = useTitle ? (windowInfo?.title?.toLowerCase() ?? '') : ''
  const haystack = `${app} ${title}`
  if (/code|cursor|xcode|webstorm|intellij|pycharm|terminal|iterm|warp|github|gitlab|bitbucket|sourcetree|vim|emacs|pull request|merge request/.test(haystack)) return 'coding'
  if (/word|pages|docs|notion|obsidian|notes|bear|typora|ulysses|markdown|写作|文档/.test(haystack)) return 'writing'
  if (/zoom|teams|meet|meeting|腾讯会议|飞书会议|voov|webex|facetime/.test(haystack)) return 'meeting'
  if (/todoist|things|omnifocus|linear|trello|asana|reminders|提醒|日历|calendar/.test(haystack)) return 'focus'
  if (/chrome|safari|firefox|edge|arc|browser|浏览器/.test(haystack)) return 'browsing'
  return 'casual'
}

export function createDailyQuests(date = todayStr()): PetQuestState {
  return {
    date,
    quests: [
      { id: 'chat_once', title: '打个招呼', desc: '和宠物互动或聊天一次', target: 1, progress: 0, completed: false },
      { id: 'focus_once', title: '专注一轮', desc: '完成一次番茄钟', target: 1, progress: 0, completed: false },
      { id: 'game_once', title: '小游戏时间', desc: '玩一次小游戏', target: 1, progress: 0, completed: false },
    ],
  }
}

export function normalizeQuestState(raw: unknown, date = todayStr()): PetQuestState {
  if (!raw || typeof raw !== 'object') return createDailyQuests(date)
  const o = raw as Record<string, unknown>
  if (typeof o.date !== 'string' || o.date !== date || !Array.isArray(o.quests)) return createDailyQuests(date)
  const defaults = createDailyQuests(date)
  const byId = new Map((o.quests as unknown[]).map(item => {
    if (!item || typeof item !== 'object') return ['', null] as const
    const q = item as Record<string, unknown>
    return [q.id, q] as const
  }))
  return {
    date,
    quests: defaults.quests.map(q => {
      const saved = byId.get(q.id)
      if (!saved) return q
      const progress = clampInteger(saved.progress, 0, 0, q.target)
      const completed = saved.completed === true || progress >= q.target
      return {
        ...q,
        progress: completed ? q.target : progress,
        completed,
        completedAt: typeof saved.completedAt === 'number' && Number.isFinite(saved.completedAt) ? saved.completedAt : undefined,
      }
    }),
  }
}

export function applyQuestEvent(raw: PetQuestState, event: QuestEvent, now = Date.now()): PetQuestState {
  const state = normalizeQuestState(raw, todayStr(now))
  const targetId = event === 'pomodoro_complete'
    ? 'focus_once'
    : event === 'game_played' || event === 'game_correct'
      ? 'game_once'
      : 'chat_once'
  return {
    date: state.date,
    quests: state.quests.map(q => {
      if (q.id !== targetId || q.completed) return q
      const progress = Math.min(q.target, q.progress + 1)
      return {
        ...q,
        progress,
        completed: progress >= q.target,
        completedAt: progress >= q.target ? now : q.completedAt,
      }
    }),
  }
}

export function normalizeGameStats(raw: unknown, date = todayStr()): PetGameStats {
  const fallback: PetGameStats = {
    score: 0,
    playedTotal: 0,
    correctTotal: 0,
    streak: 0,
    bestStreak: 0,
    playedToday: 0,
    correctToday: 0,
    lastPlayedDate: date,
  }
  if (!raw || typeof raw !== 'object') return fallback
  const o = raw as Record<string, unknown>
  const sameDay = o.lastPlayedDate === date
  return {
    score: Math.max(0, clampInteger(o.score, 0, 0, 1_000_000)),
    playedTotal: Math.max(0, clampInteger(o.playedTotal, 0, 0, 1_000_000)),
    correctTotal: Math.max(0, clampInteger(o.correctTotal, 0, 0, 1_000_000)),
    streak: Math.max(0, clampInteger(o.streak, 0, 0, 9999)),
    bestStreak: Math.max(0, clampInteger(o.bestStreak, 0, 0, 9999)),
    playedToday: sameDay ? Math.max(0, clampInteger(o.playedToday, 0, 0, 9999)) : 0,
    correctToday: sameDay ? Math.max(0, clampInteger(o.correctToday, 0, 0, 9999)) : 0,
    lastPlayedDate: sameDay ? date : date,
  }
}

export function recordGamePlayed(raw: PetGameStats, now = Date.now()): PetGameStats {
  const date = todayStr(now)
  const stats = normalizeGameStats(raw, date)
  return {
    ...stats,
    playedTotal: stats.playedTotal + 1,
    playedToday: stats.playedToday + 1,
    lastPlayedDate: date,
  }
}

export function recordGameResult(raw: PetGameStats, correct: boolean, now = Date.now()): PetGameStats {
  const date = todayStr(now)
  const stats = normalizeGameStats(raw, date)
  if (!correct) return { ...stats, streak: 0, lastPlayedDate: date }
  const streak = stats.streak + 1
  const scoreGain = 10 + Math.min(streak, 5) * 2
  return {
    ...stats,
    score: stats.score + scoreGain,
    correctTotal: stats.correctTotal + 1,
    correctToday: stats.correctToday + 1,
    streak,
    bestStreak: Math.max(stats.bestStreak, streak),
    lastPlayedDate: date,
  }
}

export function normalizeTimeline(raw: unknown): PetTimelineEvent[] {
  if (!Array.isArray(raw)) return []
  const events: PetTimelineEvent[] = []
  for (const item of raw.slice(-MAX_TIMELINE_EVENTS)) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const label = safeText(o.label, 96)
    if (!label) continue
    events.push({
      id: safeText(o.id, 80) || makeId('evt'),
      type: safeText(o.type, 40) || 'event',
      label,
      at: typeof o.at === 'number' && Number.isFinite(o.at) ? o.at : Date.now(),
      mode: typeof o.mode === 'string' && o.mode in WORK_MODE_LABELS ? o.mode as WorkMode : undefined,
      app: safeText(o.app, 48) || undefined,
      score: typeof o.score === 'number' && Number.isFinite(o.score) ? o.score : undefined,
    })
  }
  return events
}

export class PetNeedsController {
  private needs: PetNeedsSnapshot = createDefaultNeeds()

  async load() {
    try {
      this.needs = normalizeNeeds(await (window as any).mulby?.storage?.get(PET_NEEDS_STORAGE_KEY))
    } catch (err) {
      logPetPresentation('ecosystem.needs.load-error', { message: (err as Error)?.message ?? String(err) })
    }
  }

  getSnapshot(): PetNeedsSnapshot {
    this.needs = decayNeeds(this.needs)
    return { ...this.needs }
  }

  async applyEvent(event: string) {
    this.needs = applyNeedEvent(this.needs, event)
    await this.save()
  }

  async save() {
    try {
      await (window as any).mulby?.storage?.set(PET_NEEDS_STORAGE_KEY, this.needs)
    } catch (err) {
      logPetPresentation('ecosystem.needs.save-error', { message: (err as Error)?.message ?? String(err) })
    }
  }
}

export class PetTimelineController {
  private events: PetTimelineEvent[] = []

  async load() {
    try {
      this.events = normalizeTimeline(await (window as any).mulby?.storage?.get(PET_TIMELINE_STORAGE_KEY))
    } catch (err) {
      logPetPresentation('ecosystem.timeline.load-error', { message: (err as Error)?.message ?? String(err) })
    }
  }

  getEvents(): PetTimelineEvent[] {
    return [...this.events]
  }

  getToday(limit = 24): PetTimelineEvent[] {
    const date = todayStr()
    return this.events.filter(e => todayStr(e.at) === date).slice(-limit).reverse()
  }

  getTodaySummary(limit = 12): string[] {
    return this.getToday(limit).reverse().map(e => {
      const time = new Date(e.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
      return `${time} ${e.label}`
    })
  }

  async record(type: string, label: string, extra: Partial<Pick<PetTimelineEvent, 'mode' | 'app' | 'score'>> = {}) {
    const cleanLabel = safeText(label, 96)
    if (!cleanLabel) return
    const event: PetTimelineEvent = {
      id: makeId('evt'),
      type: safeText(type, 40) || 'event',
      label: cleanLabel,
      at: Date.now(),
      mode: extra.mode,
      app: safeText(extra.app, 48) || undefined,
      score: extra.score,
    }
    this.events = [...this.events, event].slice(-MAX_TIMELINE_EVENTS)
    try {
      await (window as any).mulby?.storage?.set(PET_TIMELINE_STORAGE_KEY, this.events)
    } catch (err) {
      logPetPresentation('ecosystem.timeline.save-error', { message: (err as Error)?.message ?? String(err) })
    }
  }
}

export class PetQuestController {
  private state: PetQuestState = createDailyQuests()

  async load() {
    try {
      this.state = normalizeQuestState(await (window as any).mulby?.storage?.get(PET_QUESTS_STORAGE_KEY))
      await this.save()
    } catch (err) {
      logPetPresentation('ecosystem.quests.load-error', { message: (err as Error)?.message ?? String(err) })
    }
  }

  getState(): PetQuestState {
    this.state = normalizeQuestState(this.state)
    return { date: this.state.date, quests: this.state.quests.map(q => ({ ...q })) }
  }

  async applyEvent(event: QuestEvent) {
    this.state = applyQuestEvent(this.state, event)
    await this.save()
  }

  async save() {
    try {
      await (window as any).mulby?.storage?.set(PET_QUESTS_STORAGE_KEY, this.state)
    } catch (err) {
      logPetPresentation('ecosystem.quests.save-error', { message: (err as Error)?.message ?? String(err) })
    }
  }
}

export class PetGameStatsController {
  private stats: PetGameStats = normalizeGameStats(null)

  async load() {
    try {
      this.stats = normalizeGameStats(await (window as any).mulby?.storage?.get(PET_GAME_STATS_STORAGE_KEY))
      await this.save()
    } catch (err) {
      logPetPresentation('ecosystem.games.load-error', { message: (err as Error)?.message ?? String(err) })
    }
  }

  getStats(): PetGameStats {
    this.stats = normalizeGameStats(this.stats)
    return { ...this.stats }
  }

  async recordPlayed() {
    this.stats = recordGamePlayed(this.stats)
    await this.save()
  }

  async recordResult(correct: boolean) {
    this.stats = recordGameResult(this.stats, correct)
    await this.save()
  }

  async save() {
    try {
      await (window as any).mulby?.storage?.set(PET_GAME_STATS_STORAGE_KEY, this.stats)
    } catch (err) {
      logPetPresentation('ecosystem.games.save-error', { message: (err as Error)?.message ?? String(err) })
    }
  }
}

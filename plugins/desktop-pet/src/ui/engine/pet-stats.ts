/**
 * Pet intimacy/stats system.
 * Tracks interactions, focus time, streaks, and affects AI personality tone.
 */

import { logPetPresentation } from './presentation-debug'

export type PetMood = 'ecstatic' | 'happy' | 'content' | 'neutral' | 'bored' | 'lonely' | 'sad' | 'grumpy' | 'sleepy'

export interface PetStats {
  intimacy: number
  totalInteractions: number
  totalFocusMinutes: number
  streakDays: number
  lastSignInDate: string
  mood: PetMood
  moodScore: number
  moodUpdatedAt: number
  createdAt: number
  pomodoroToday: number
  pomodoroTotal: number
  lastActiveDate: string
  lastChatDate: string
  ignoredCount: number
  dailyIntimacyGain: number
}

const STORAGE_KEY = 'pet-stats'

function todayStr(): string {
  return new Date().toISOString().slice(0, 10)
}

function daysBetween(a: string, b: string): number {
  const da = new Date(a).getTime()
  const db = new Date(b).getTime()
  return Math.floor(Math.abs(db - da) / 86_400_000)
}

function createDefaultStats(): PetStats {
  return {
    intimacy: 10,
    totalInteractions: 0,
    totalFocusMinutes: 0,
    streakDays: 0,
    lastSignInDate: '',
    mood: 'neutral',
    moodScore: 0,
    moodUpdatedAt: Date.now(),
    createdAt: Date.now(),
    pomodoroToday: 0,
    pomodoroTotal: 0,
    lastActiveDate: todayStr(),
    lastChatDate: todayStr(),
    ignoredCount: 0,
    dailyIntimacyGain: 0,
  }
}

const EMOTION_MOOD_DELTA: Record<string, number> = {
  joy: 15, love: 20, excitement: 18, amusement: 12, gratitude: 10, pride: 10,
  curiosity: 8, surprise: 5, calm: 3, focus: 6, concentration: 6,
  shyness: -2, nervousness: -5, confusion: -5,
  disappointment: -8, worry: -10, sadness: -15, anger: -12, annoyance: -8,
  sleepiness: -3, tiredness: -5, fear: -10, dizziness: -4,
}

function moodFromScore(score: number, hour: number): PetMood {
  if (hour >= 23 || hour < 5) {
    if (score >= 30) return 'happy'
    return 'sleepy'
  }
  if (score >= 70) return 'ecstatic'
  if (score >= 40) return 'happy'
  if (score >= 15) return 'content'
  if (score > -15) return 'neutral'
  if (score > -35) return 'bored'
  if (score > -60) return 'lonely'
  if (score > -80) return 'sad'
  return 'grumpy'
}

export class PetStatsController {
  private stats: PetStats = createDefaultStats()
  private lastInteractionTime = 0
  private lastChatTime = 0
  private dirty = false

  async load() {
    try {
      const saved = await (window as any).mulby?.storage?.get(STORAGE_KEY)
      if (saved && typeof saved === 'object') {
        const merged = { ...createDefaultStats(), ...(saved as Partial<PetStats>) }
        merged.intimacy = Math.max(0, Math.min(100, Math.round(Number(merged.intimacy) || 10)))
        merged.totalInteractions = Math.max(0, Math.round(Number(merged.totalInteractions) || 0))
        merged.totalFocusMinutes = Math.max(0, Math.round(Number(merged.totalFocusMinutes) || 0))
        merged.streakDays = Math.max(0, Math.round(Number(merged.streakDays) || 0))
        merged.moodScore = Math.max(-100, Math.min(100, Math.round(Number(merged.moodScore) || 0)))
        merged.pomodoroToday = Math.max(0, Math.round(Number(merged.pomodoroToday) || 0))
        merged.pomodoroTotal = Math.max(0, Math.round(Number(merged.pomodoroTotal) || 0))
        merged.ignoredCount = Math.max(0, Math.round(Number(merged.ignoredCount) || 0))
        merged.dailyIntimacyGain = Math.max(0, Math.round(Number(merged.dailyIntimacyGain) || 0))
        if (typeof merged.lastSignInDate !== 'string') merged.lastSignInDate = ''
        if (typeof merged.lastActiveDate !== 'string') merged.lastActiveDate = todayStr()
        if (typeof merged.lastChatDate !== 'string') merged.lastChatDate = todayStr()
        this.stats = merged
      }
    } catch (err) {
      logPetPresentation('stats.load.error', {
        message: (err as Error)?.message ?? String(err),
      })
    }

    this.checkDayRollover()
    this.checkInactivityPenalty()
  }

  private checkDayRollover() {
    const today = todayStr()
    if (this.stats.lastActiveDate && this.stats.lastActiveDate !== today) {
      this.stats.pomodoroToday = 0
      this.stats.dailyIntimacyGain = 0
    }
    this.stats.lastActiveDate = today
    this.dirty = true
  }

  private checkInactivityPenalty() {
    if (!this.stats.lastSignInDate) return
    const gap = daysBetween(this.stats.lastSignInDate, todayStr())
    if (gap > 2) {
      const penalty = (gap - 2) * 2
      this.stats.intimacy = Math.max(0, this.stats.intimacy - penalty)
      this.dirty = true
    }

    if (this.stats.lastChatDate) {
      const chatGap = daysBetween(this.stats.lastChatDate, todayStr())
      if (chatGap >= 3) {
        this.stats.intimacy = Math.max(0, this.stats.intimacy - 5)
        this.dirty = true
      }
    }

    if (this.stats.ignoredCount >= 5) {
      this.stats.intimacy = Math.max(0, this.stats.intimacy - 3)
      this.stats.ignoredCount = 0
      this.dirty = true
    }
  }

  getStats(): Readonly<PetStats> {
    return this.stats
  }

  signIn(): boolean {
    const today = todayStr()
    if (this.stats.lastSignInDate === today) return false

    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)
    if (this.stats.lastSignInDate === yesterday) {
      this.stats.streakDays++
    } else {
      this.stats.streakDays = 1
    }

    const streakBonus = Math.min(this.stats.streakDays, 7)
    this.addIntimacy(3 + streakBonus)
    this.stats.lastSignInDate = today
    this.boostMood(8 + Math.min(streakBonus, 5))
    this.dirty = true
    this.save()
    return true
  }

  recordInteraction() {
    const now = Date.now()
    if (now - this.lastInteractionTime < 300_000) return
    this.lastInteractionTime = now
    this.stats.totalInteractions++
    this.addIntimacy(1)
    this.boostMood(3)
    this.save()
  }

  recordChat() {
    const now = Date.now()
    if (now - this.lastChatTime < 600_000) return
    this.lastChatTime = now
    this.stats.lastChatDate = todayStr()
    this.stats.ignoredCount = 0
    this.addIntimacy(1)
    this.boostMood(5)
    this.save()
  }

  recordIgnored() {
    this.stats.ignoredCount++
    this.boostMood(-4)
    this.dirty = true
    this.save()
  }

  recordPomodoroComplete(minutes: number) {
    this.stats.pomodoroToday++
    this.stats.pomodoroTotal++
    this.stats.totalFocusMinutes += minutes
    this.addIntimacy(5)
    this.boostMood(10 + Math.min(Math.floor(minutes / 10), 5))
    this.save()
  }

  private boostMood(delta: number) {
    this.stats.moodScore = Math.max(-100, Math.min(100, this.stats.moodScore + delta))
    this.stats.moodUpdatedAt = Date.now()
    this.refreshMood()
    this.dirty = true
  }

  private addIntimacy(amount: number) {
    const MAX_DAILY = 15
    if (this.stats.dailyIntimacyGain >= MAX_DAILY) return
    const effective = Math.min(amount, MAX_DAILY - this.stats.dailyIntimacyGain)
    this.stats.intimacy = Math.min(100, this.stats.intimacy + effective)
    this.stats.dailyIntimacyGain += effective
    this.refreshMood()
    this.dirty = true
  }

  applyEmotion(emotion: string) {
    const delta = EMOTION_MOOD_DELTA[emotion.toLowerCase()] ?? 0
    if (delta === 0) return
    this.stats.moodScore = Math.max(-100, Math.min(100, this.stats.moodScore + delta))
    this.stats.moodUpdatedAt = Date.now()
    this.refreshMood()
    this.dirty = true
    this.save()
  }

  decayMood() {
    const now = Date.now()
    const elapsed = now - this.stats.moodUpdatedAt
    if (elapsed < 300_000) return

    const decaySteps = Math.floor(elapsed / 300_000)
    const decayRate = 2
    if (this.stats.moodScore > 0) {
      this.stats.moodScore = Math.max(0, this.stats.moodScore - decaySteps * decayRate)
    } else if (this.stats.moodScore < 0) {
      this.stats.moodScore = Math.min(0, this.stats.moodScore + decaySteps * decayRate)
    }

    const idleMinutes = Math.floor((now - this.lastInteractionTime) / 60_000)
    if (this.lastInteractionTime > 0 && idleMinutes >= 30) {
      const lonelyPenalty = Math.min(Math.floor((idleMinutes - 30) / 15), 8)
      this.stats.moodScore = Math.max(-100, this.stats.moodScore - lonelyPenalty)
    }

    this.stats.moodUpdatedAt = now
    this.refreshMood()
    this.dirty = true
  }

  getMood(): PetMood {
    return this.stats.mood
  }

  private refreshMood() {
    const hour = new Date().getHours()
    const intimacyBonus = Math.floor((this.stats.intimacy - 50) / 10)
    const effectiveScore = this.stats.moodScore + intimacyBonus
    this.stats.mood = moodFromScore(effectiveScore, hour)
  }

  async save() {
    if (!this.dirty) return
    this.dirty = false
    try {
      await (window as any).mulby?.storage?.set(STORAGE_KEY, this.stats)
    } catch (err) {
      logPetPresentation('stats.save.error', {
        message: (err as Error)?.message ?? String(err),
      })
    }
  }
}

/**
 * Pet intimacy/stats system.
 * Tracks interactions, focus time, streaks, and affects AI personality tone.
 */

export interface PetStats {
  intimacy: number
  totalInteractions: number
  totalFocusMinutes: number
  streakDays: number
  lastSignInDate: string
  mood: 'happy' | 'neutral' | 'sad' | 'sleepy'
  createdAt: number
  pomodoroToday: number
  pomodoroTotal: number
  lastActiveDate: string
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
    createdAt: Date.now(),
    pomodoroToday: 0,
    pomodoroTotal: 0,
    lastActiveDate: todayStr(),
  }
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
        this.stats = { ...createDefaultStats(), ...(saved as Partial<PetStats>) }
      }
    } catch {}

    this.checkDayRollover()
    this.checkInactivityPenalty()
  }

  private checkDayRollover() {
    const today = todayStr()
    if (this.stats.lastActiveDate && this.stats.lastActiveDate !== today) {
      this.stats.pomodoroToday = 0
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
  }

  getStats(): Readonly<PetStats> {
    return this.stats
  }

  getIntimacyLevel(): 'cold' | 'normal' | 'warm' | 'close' {
    const i = this.stats.intimacy
    if (i < 20) return 'cold'
    if (i < 50) return 'normal'
    if (i < 80) return 'warm'
    return 'close'
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
    this.save()
  }

  recordChat() {
    const now = Date.now()
    if (now - this.lastChatTime < 600_000) return
    this.lastChatTime = now
    this.addIntimacy(1)
    this.save()
  }

  recordPomodoroComplete(minutes: number) {
    this.stats.pomodoroToday++
    this.stats.pomodoroTotal++
    this.stats.totalFocusMinutes += minutes
    this.addIntimacy(5)
    this.save()
  }

  private addIntimacy(amount: number) {
    this.stats.intimacy = Math.min(100, this.stats.intimacy + amount)
    this.updateMood()
    this.dirty = true
  }

  private updateMood() {
    const i = this.stats.intimacy
    if (i >= 80) this.stats.mood = 'happy'
    else if (i >= 40) this.stats.mood = 'neutral'
    else if (i >= 20) this.stats.mood = 'sleepy'
    else this.stats.mood = 'sad'
  }

  async save() {
    if (!this.dirty) return
    this.dirty = false
    try {
      await (window as any).mulby?.storage?.set(STORAGE_KEY, this.stats)
    } catch {}
  }
}

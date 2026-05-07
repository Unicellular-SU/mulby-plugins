import type { PetStats } from './pet-stats'

export interface Achievement {
  id: string
  title: string
  desc: string
  icon: string
  condition: (stats: PetStats) => boolean
}

export interface UnlockedAchievement {
  id: string
  unlockedAt: number
}

const STORAGE_KEY = 'pet-achievements'

export const ALL_ACHIEVEMENTS: Achievement[] = [
  { id: 'first_meet', title: '初次相遇', desc: '第一次启动宠物', icon: 'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z', condition: () => true },
  { id: 'streak_3', title: '三日之约', desc: '连续签到 3 天', icon: 'M19 4H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zM16 2v4M8 2v4M3 10h18', condition: s => s.streakDays >= 3 },
  { id: 'streak_7', title: '一周不断', desc: '连续签到 7 天', icon: 'M19 4H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zM16 2v4M8 2v4M3 10h18', condition: s => s.streakDays >= 7 },
  { id: 'streak_30', title: '月度坚持', desc: '连续签到 30 天', icon: 'M19 4H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zM16 2v4M8 2v4M3 10h18', condition: s => s.streakDays >= 30 },
  { id: 'interact_10', title: '话唠起步', desc: '累计互动 10 次', icon: 'M18 11V6a2 2 0 0 0-4 0v1M14 10V4a2 2 0 0 0-4 0v6M10 10V5a2 2 0 0 0-4 0v9', condition: s => s.totalInteractions >= 10 },
  { id: 'interact_50', title: '亲密好友', desc: '累计互动 50 次', icon: 'M18 11V6a2 2 0 0 0-4 0v1M14 10V4a2 2 0 0 0-4 0v6M10 10V5a2 2 0 0 0-4 0v9', condition: s => s.totalInteractions >= 50 },
  { id: 'interact_100', title: '灵魂伴侣', desc: '累计互动 100 次', icon: 'M18 11V6a2 2 0 0 0-4 0v1M14 10V4a2 2 0 0 0-4 0v6M10 10V5a2 2 0 0 0-4 0v9', condition: s => s.totalInteractions >= 100 },
  { id: 'pomo_1', title: '初次专注', desc: '完成第一个番茄钟', icon: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 12h0', condition: s => s.pomodoroTotal >= 1 },
  { id: 'pomo_10', title: '专注达人', desc: '累计完成 10 个番茄钟', icon: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 12h0', condition: s => s.pomodoroTotal >= 10 },
  { id: 'pomo_50', title: '时间大师', desc: '累计完成 50 个番茄钟', icon: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 12h0', condition: s => s.pomodoroTotal >= 50 },
  { id: 'focus_60', title: '一小时征服', desc: '累计专注 60 分钟', icon: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM12 6v6l4 2', condition: s => s.totalFocusMinutes >= 60 },
  { id: 'focus_600', title: '专注十小时', desc: '累计专注 600 分钟', icon: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM12 6v6l4 2', condition: s => s.totalFocusMinutes >= 600 },
  { id: 'intimacy_50', title: '心意相通', desc: '亲密度达到 50', icon: 'M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z', condition: s => s.intimacy >= 50 },
  { id: 'intimacy_80', title: '形影不离', desc: '亲密度达到 80', icon: 'M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z', condition: s => s.intimacy >= 80 },
  { id: 'intimacy_max', title: '满分默契', desc: '亲密度达到 100', icon: 'M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z', condition: s => s.intimacy >= 100 },
  { id: 'companion_7', title: '一周相伴', desc: '相伴 7 天', icon: 'M20 12v10H4V12M2 7h20v5H2zM12 22V7M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7zM12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z', condition: s => (Date.now() - (s.createdAt || Date.now())) >= 7 * 86_400_000 },
  { id: 'companion_30', title: '月度伙伴', desc: '相伴 30 天', icon: 'M20 12v10H4V12M2 7h20v5H2zM12 22V7M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7zM12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z', condition: s => (Date.now() - (s.createdAt || Date.now())) >= 30 * 86_400_000 },
]

export class AchievementController {
  private unlocked: UnlockedAchievement[] = []

  async load() {
    try {
      const saved = await (window as any).mulby?.storage?.get(STORAGE_KEY)
      if (Array.isArray(saved)) this.unlocked = saved
    } catch {}
  }

  private async save() {
    try {
      await (window as any).mulby?.storage?.set(STORAGE_KEY, this.unlocked)
    } catch {}
  }

  getUnlocked(): UnlockedAchievement[] {
    return [...this.unlocked]
  }

  isUnlocked(id: string): boolean {
    return this.unlocked.some(a => a.id === id)
  }

  checkAll(stats: PetStats): Achievement[] {
    const newlyUnlocked: Achievement[] = []
    for (const ach of ALL_ACHIEVEMENTS) {
      if (this.isUnlocked(ach.id)) continue
      if (ach.condition(stats)) {
        this.unlocked.push({ id: ach.id, unlockedAt: Date.now() })
        newlyUnlocked.push(ach)
      }
    }
    if (newlyUnlocked.length > 0) this.save()
    return newlyUnlocked
  }
}

import type { AchievementDef, RunStats, MetaProgress } from '../types'

export const ACHIEVEMENTS: AchievementDef[] = [
  // === 基础成就 ===
  { id: 'first_run', name: '初次冒险', desc: '完成第 1 次游戏', rewardCrystals: 20, category: 'basic' },
  { id: 'floor_5', name: '深入地下', desc: '到达第 5 层', rewardCrystals: 30, category: 'basic' },
  { id: 'floor_10_clear', name: '征服深渊', desc: '通关第 10 层', rewardCrystals: 100, category: 'basic' },
  { id: 'synergy_master', name: '协同大师', desc: '单局触发 3 种协同效果', rewardCrystals: 50, category: 'basic' },
  { id: 'all_heroes', name: '全能战队', desc: '历史使用过所有 5 个英雄', rewardCrystals: 80, category: 'basic' },
  // === 挑战成就 ===
  { id: 'mage_solo', name: '孤胆英雄', desc: '单人上阵通关第 5 层', rewardCrystals: 60, category: 'challenge' },
  { id: 'boss_no_damage', name: '无伤 Boss', desc: '击杀 Boss 时全队满血', rewardCrystals: 50, category: 'challenge' },
  { id: 'speed_run', name: '速通达人', desc: '10 分钟内通关', rewardCrystals: 80, category: 'challenge' },
  { id: 'collector', name: '收集狂', desc: '单局收集 8 个道具', rewardCrystals: 30, category: 'challenge' },
  { id: 'kill_100', name: '屠戮者', desc: '单局击杀 100 个敌人', rewardCrystals: 40, category: 'challenge' },
]

export function checkNewAchievements(meta: MetaProgress, stats: RunStats, currentUnlocked: string[]): string[] {
  const newlyUnlocked: string[] = []

  for (const ach of ACHIEVEMENTS) {
    if (currentUnlocked.includes(ach.id)) continue

    let unlocked = false
    switch (ach.id) {
      case 'first_run':
        unlocked = meta.totalRuns >= 1
        break
      case 'floor_5':
        unlocked = stats.maxFloor >= 5
        break
      case 'floor_10_clear':
        unlocked = stats.maxFloor >= 10 && stats.victory
        break
      case 'synergy_master':
        unlocked = new Set(stats.synergiesTriggered).size >= 3
        break
      case 'all_heroes':
        unlocked = new Set([...meta.allHeroesUsed, ...stats.heroesUsed]).size >= 5
        break
      case 'mage_solo':
        unlocked = stats.heroesUsed.length <= 1 && stats.maxFloor >= 5
        break
      case 'boss_no_damage':
        unlocked = stats.bossKilledFullHp
        break
      case 'speed_run':
        unlocked = stats.victory && (Date.now() - stats.startTime) < 600000
        break
      case 'collector':
        unlocked = stats.itemsCollected.length >= 8
        break
      case 'kill_100':
        unlocked = stats.enemiesKilled >= 100
        break
    }

    if (unlocked) newlyUnlocked.push(ach.id)
  }

  return newlyUnlocked
}

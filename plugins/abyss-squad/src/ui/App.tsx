import { useState, useEffect, useCallback } from 'react'
import MainMenu from './components/MainMenu'
import Hub from './components/Hub'
import HeroPick from './components/HeroPick'
import GameCanvas from './components/GameCanvas'
import GameOver from './components/GameOver'
import type { GameScreen, MetaProgress, RunStats } from './game/types'
import { checkNewAchievements, ACHIEVEMENTS } from './game/data/achievements'
import { DEFAULT_SYNERGIES } from './game/data/synergies'

const DEFAULT_META: MetaProgress = {
  crystals: 0,
  attackLevel: 0,
  healthLevel: 0,
  speedLevel: 0,
  unlockedHeroes: ['warrior', 'mage', 'ranger'],
  unlockedAbilities: [],
  unlockedItems: [],
  unlockedSynergies: [...DEFAULT_SYNERGIES],
  weaponLevel: 0,
  totalRuns: 0,
  bestFloor: 0,
  achievements: [],
  allHeroesUsed: [],
}

async function loadMeta(): Promise<MetaProgress> {
  try {
    const mulby = (window as any).mulby
    if (mulby?.storage) {
      const data = await mulby.storage.get('abyss-squad-meta')
      if (data) {
        const merged = { ...DEFAULT_META, ...data }
        // 确保关键数组字段有效
        if (!Array.isArray(merged.unlockedHeroes) || merged.unlockedHeroes.length === 0) {
          merged.unlockedHeroes = [...DEFAULT_META.unlockedHeroes]
        }
        return merged
      }
    }
  } catch { /* ignore */ }
  return DEFAULT_META
}

async function saveMeta(meta: MetaProgress) {
  try {
    const mulby = (window as any).mulby
    if (mulby?.storage) {
      await mulby.storage.set('abyss-squad-meta', meta)
    }
  } catch { /* ignore */ }
}

export default function App() {
  const [screen, setScreen] = useState<GameScreen>('menu')
  const [meta, setMeta] = useState<MetaProgress>(DEFAULT_META)
  const [loaded, setLoaded] = useState(false)
  const [runResult, setRunResult] = useState<{ crystals: number; floor: number } | null>(null)
  const [selectedHeroes, setSelectedHeroes] = useState<string[]>([])
  const [newAchievements, setNewAchievements] = useState<Array<{ id: string; name: string; rewardCrystals: number }>>([])

  // 加载存档
  useEffect(() => {
    loadMeta().then(data => {
      setMeta(data)
      setLoaded(true)
    })
  }, [])

  // 自动保存
  const updateMeta = useCallback((updater: (prev: MetaProgress) => MetaProgress) => {
    setMeta(prev => {
      const next = updater(prev)
      saveMeta(next)
      return next
    })
  }, [])

  const handleStartRun = () => {
    // 弹出英雄选择
    const available = meta.unlockedHeroes
    if (available.length <= 3) {
      setSelectedHeroes(available.slice(0, 3))
      setScreen('game')
    } else {
      setSelectedHeroes([])
      setScreen('hero_pick')
    }
  }
  const handleGoHub = () => setScreen('hub')
  const handleGoMenu = () => setScreen('menu')

  const handleRunEnd = (crystals: number, floor: number, runStats?: RunStats) => {
    setRunResult({ crystals, floor })
    setNewAchievements([])
    updateMeta(prev => {
      const next: MetaProgress = {
        ...prev,
        crystals: prev.crystals + crystals,
        totalRuns: prev.totalRuns + 1,
        bestFloor: Math.max(prev.bestFloor, floor),
        allHeroesUsed: [...new Set([...prev.allHeroesUsed, ...(runStats?.heroesUsed || [])])],
      }

      // 检查成就
      if (runStats) {
        const newAchs = checkNewAchievements(next, runStats, prev.achievements || [])
        if (newAchs.length > 0) {
          next.achievements = [...(prev.achievements || []), ...newAchs]
          // B6: 记录新解锁的成就用于显示
          const achDetails = newAchs.map(achId => {
            const achDef = ACHIEVEMENTS.find(a => a.id === achId)
            return achDef ? { id: achDef.id, name: achDef.name, rewardCrystals: achDef.rewardCrystals } : null
          }).filter(Boolean) as Array<{ id: string; name: string; rewardCrystals: number }>
          setNewAchievements(achDetails)
          // 发放水晶奖励
          for (const achId of newAchs) {
            const achDef = ACHIEVEMENTS.find(a => a.id === achId)
            if (achDef) {
              next.crystals += achDef.rewardCrystals
            }
          }
        }
      }

      return next
    })
    setScreen('gameover')
  }

  const handleUpgrade = (key: string, cost: number) => {
    if (meta.crystals < cost) return
    updateMeta(prev => ({
      ...prev,
      crystals: prev.crystals - cost,
      [key]: ((prev as any)[key] || 0) + 1,
    }))
  }

  const handleUnlockHero = (heroId: string, cost: number) => {
    if (meta.crystals < cost) return
    updateMeta(prev => ({
      ...prev,
      crystals: prev.crystals - cost,
      unlockedHeroes: [...prev.unlockedHeroes, heroId],
    }))
  }

  const handleUnlockAbility = (abilityId: string, cost: number) => {
    if (meta.crystals < cost) return
    updateMeta(prev => ({
      ...prev,
      crystals: prev.crystals - cost,
      unlockedAbilities: [...prev.unlockedAbilities, abilityId],
    }))
  }

  const handleUnlockSynergy = (synergyId: string, cost: number) => {
    if (meta.crystals < cost) return
    updateMeta(prev => ({
      ...prev,
      crystals: prev.crystals - cost,
      unlockedSynergies: [...prev.unlockedSynergies, synergyId],
    }))
  }

  const handleConfirmHeroPick = (heroIds: string[]) => {
    setSelectedHeroes(heroIds)
    setScreen('game')
  }

  if (!loaded) {
    return <div className="game-root" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#555' }}>加载中...</div>
  }

  return (
    <div className="game-root">
      {screen === 'menu' && (
        <MainMenu onStart={handleStartRun} onHub={handleGoHub} />
      )}
      {screen === 'hub' && (
        <Hub
          meta={meta}
          onBack={handleGoMenu}
          onUpgrade={handleUpgrade}
          onUnlockHero={handleUnlockHero}
          onUnlockAbility={handleUnlockAbility}
          onUnlockSynergy={handleUnlockSynergy}
          onStartRun={handleStartRun}
        />
      )}
      {screen === 'hero_pick' && (
        <HeroPick
          meta={meta}
          onConfirm={handleConfirmHeroPick}
          onBack={() => setScreen('menu')}
        />
      )}
      {screen === 'game' && (
        <GameCanvas meta={meta} heroIds={selectedHeroes} onRunEnd={handleRunEnd} onQuit={handleGoMenu} />
      )}
      {screen === 'gameover' && runResult && (
        <GameOver
          crystals={runResult.crystals}
          floor={runResult.floor}
          newAchievements={newAchievements}
          onContinue={handleGoHub}
          onMenu={handleGoMenu}
          onRetry={handleStartRun}
        />
      )}
    </div>
  )
}

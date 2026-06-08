import { useEffect, useRef, useState, useCallback } from 'react'
import { GameEngine, type GameEvent } from '../game/engine'
import { GameRenderer } from '../game/renderer'
import { createInputState, setupInputHandlers } from '../game/input'
import type { MetaProgress, AbilityDef, RoomEvent, RunStats } from '../game/types'
import * as sfx from '../game/sfx'
import HUD from './HUD'
import LevelUpModal from './LevelUpModal'
import EventRoom from './EventRoom'

interface Props {
  meta: MetaProgress
  heroIds?: string[]
  onRunEnd: (crystals: number, floor: number, runStats?: RunStats) => void
  onQuit: () => void
}

export default function GameCanvas({ meta, heroIds, onRunEnd, onQuit }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const engineRef = useRef<GameEngine | null>(null)
  const rendererRef = useRef<GameRenderer | null>(null)
  const [tick, setTick] = useState(0)
  const [levelUpChoices, setLevelUpChoices] = useState<AbilityDef[] | null>(null)
  const [levelUpHero, setLevelUpHero] = useState<{ name: string; color: string; abilities: any[] } | null>(null)
  const [synergyPopup, setSynergyPopup] = useState<{ name: string; desc: string; color: string } | null>(null)
  const [currentEvent, setCurrentEvent] = useState<RoomEvent | null>(null)

  const handleEvent = useCallback((event: GameEvent) => {
    switch (event.type) {
      case 'level_up':
        sfx.sfxLevelUp()
        setLevelUpChoices(event.choices)
        const lvlHero = engineRef.current?.state.heroes.find(h => h.def.name === event.heroName)
        setLevelUpHero({ name: event.heroName, color: event.heroColor, abilities: lvlHero?.abilities || [] })
        break
      case 'synergy':
        sfx.sfxSynergy()
        setSynergyPopup({ name: event.name, desc: event.desc, color: event.color })
        setTimeout(() => setSynergyPopup(null), 3000)
        break
      case 'run_end':
        if (event.floor >= 10) sfx.sfxVictory()
        else sfx.sfxGameOver()
        onRunEnd(event.crystals, event.floor, event.runStats)
        break
      case 'event_room':
        sfx.sfxEvent()
        setCurrentEvent(event.event)
        break
      case 'floor_clear':
        sfx.sfxNewFloor()
        break
      case 'item_drop':
        sfx.sfxPickup()
        break
      case 'achievement':
        sfx.sfxAchievement()
        break
    }
  }, [onRunEnd])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const engine = new GameEngine(meta, handleEvent, heroIds)
    const renderer = new GameRenderer(ctx, 800, 600)
    engineRef.current = engine
    rendererRef.current = renderer

    // 恢复音频上下文（浏览器要求用户交互后播放）
    sfx.resumeAudio()

    const cleanup = setupInputHandlers(canvas, engine.input)
    engine.start()

    // 渲染循环 (与引擎更新同步)
    let animFrame = 0
    const renderLoop = () => {
      renderer.render(engine.state, engine.camera)

      // 传送门
      if (engine.getFloorInfo().portalReady) {
        renderer.drawPortal(380, 280)
      }

      // 触发React状态更新 (每10帧一次)
      if (Date.now() % 200 < 20) setTick(t => t + 1)

      animFrame = requestAnimationFrame(renderLoop)
    }
    animFrame = requestAnimationFrame(renderLoop)

    return () => {
      engine.stop()
      cancelAnimationFrame(animFrame)
      cleanup()
    }
  }, [])

  const handleSelectAbility = (index: number) => {
    engineRef.current?.selectAbility(index)
    setLevelUpChoices(null)
    setLevelUpHero(null)
  }

  const engine = engineRef.current
  const floorInfo = engine?.getFloorInfo()
  const activeHero = engine?.getActiveHero()
  const heroes = engine?.state.heroes || []
  const synergies = engine?.state.activeSynergies || []

  return (
    <div className="game-container">
      <canvas
        ref={canvasRef}
        width={800}
        height={600}
        className="game-canvas"
        tabIndex={0}
      />

      <HUD
        heroes={heroes}
        activeHeroIndex={engine?.state.activeHeroIndex ?? 0}
        floorInfo={floorInfo}
        crystals={engine?.state.crystals ?? 0}
        synergies={synergies}
        activeItem={engine?.state.activeItem}
        teamSynergies={engine?.state.activeTeamSynergies}
        onQuit={onQuit}
      />

      {levelUpChoices && (
        <LevelUpModal
          choices={levelUpChoices}
          heroName={levelUpHero?.name}
          heroColor={levelUpHero?.color}
          heroAbilities={levelUpHero?.abilities}
          onSelect={handleSelectAbility}
        />
      )}

      {synergyPopup && (
        <div className="synergy-popup" style={{ borderColor: synergyPopup.color }}>
          <div className="synergy-flash" style={{ backgroundColor: synergyPopup.color }} />
          <h3 style={{ color: synergyPopup.color }}>{synergyPopup.name}</h3>
          <p>{synergyPopup.desc}</p>
        </div>
      )}

      {currentEvent && (
        <EventRoom
          event={currentEvent}
          crystals={engine?.state.crystals ?? 0}
          onChoice={(idx) => {
            engineRef.current?.handleEventChoice(idx)
            setCurrentEvent(null)
          }}
        />
      )}
    </div>
  )
}

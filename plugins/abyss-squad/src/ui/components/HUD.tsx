import { useState } from 'react'
import type { HeroState, ActiveSynergy, ActiveItemState, TeamSynergyDef } from '../game/types'
import * as sfx from '../game/sfx'

interface FloorInfo {
  level: number
  killed: number
  needed: number
  portalReady: boolean
}

interface Props {
  heroes: HeroState[]
  activeHeroIndex: number
  floorInfo?: FloorInfo
  crystals: number
  synergies: ActiveSynergy[]
  activeItem?: ActiveItemState | null
  teamSynergies?: TeamSynergyDef[]
  onQuit: () => void
}

export default function HUD({ heroes, activeHeroIndex, floorInfo, crystals, synergies, activeItem, teamSynergies, onQuit }: Props) {
  const [hoverHero, setHoverHero] = useState<number | null>(null)
  const [muted, setMuted] = useState(sfx.isMuted())

  const toggleMute = () => {
    const next = !muted
    setMuted(next)
    sfx.setMuted(next)
  }
  return (
    <div className="hud-overlay">
      {/* 顶部信息栏 */}
      <div className="hud-top">
        <div className="hud-floor">
          <span>第 {floorInfo?.level ?? 1} 层</span>
          {floorInfo && (
            <div className="progress-bar">
              <div
                className="progress-fill"
                style={{ width: `${(floorInfo.killed / floorInfo.needed) * 100}%` }}
              />
            </div>
          )}
          <span className="kill-count">{floorInfo?.killed ?? 0}/{floorInfo?.needed ?? 0}</span>
        </div>
        <div className="hud-crystals">
          <span className="crystal-icon">◆</span>
          <span>{crystals}</span>
        </div>
        <button
          className="btn-quit"
          style={{ marginRight: 8 }}
          onClick={toggleMute}
          title={muted ? '开启音效' : '关闭音效'}
        >
          {muted ? '🔇' : '🔊'}
        </button>
        <button className="btn-quit" onClick={onQuit}>✕</button>
      </div>

      {/* 底部英雄栏 */}
      <div className="hud-bottom">
        {heroes.map((hero, i) => (
          <div
            key={i}
            className={`hud-hero ${i === activeHeroIndex ? 'active' : ''} ${hero.isDead ? 'dead' : ''}`}
            onMouseEnter={() => setHoverHero(i)}
            onMouseLeave={() => setHoverHero(null)}
          >
            <div className="hero-portrait" style={{ backgroundColor: hero.def.color }}>
              {hero.isDead ? '✕' : hero.def.name[0]}
            </div>
            <div className="hero-bars">
              <div className="hp-bar">
                <div
                  className="hp-fill"
                  style={{ width: `${(hero.hp / hero.maxHp) * 100}%` }}
                />
                <span className="hp-text">{Math.round(hero.hp)}/{hero.maxHp}</span>
              </div>
              <div className="xp-bar">
                <div className="xp-fill" style={{ width: `${(hero.xp / (30 + hero.level * 20)) * 100}%` }} />
                <span className="lv-text">Lv.{hero.level}</span>
              </div>
            </div>
            {/* 道具图标 */}
            <div className="hero-items">
              {hero.items.map((item, j) => (
                <div
                  key={j}
                  className={`item-slot ${item ? 'filled' : 'empty'}`}
                  title={item ? item.def.name : '空'}
                  style={item ? { borderColor: item.def.color } : {}}
                >
                  {item ? item.def.name[0] : '·'}
                </div>
              ))}
            </div>
            <div style={{ fontSize: 10, color: '#ccc', marginTop: 2 }}>
              {hero.abilities.length > 0 && (
                <span title={hero.abilities.map(a => `${a.def.name}×${a.stacks}`).join(', ')}>
                  ⚡{hero.abilities.length}/6
                </span>
              )}
            </div>
            <span className="hero-key">{i + 1}</span>
          </div>
        ))}
      </div>

      {/* 英雄悬浮面板 */}
      {hoverHero !== null && heroes[hoverHero] && (
        <HeroTooltip hero={heroes[hoverHero]} position={hoverHero} total={heroes.length} />
      )}

      {/* 协同效果列表 */}
      {synergies.length > 0 && (
        <div className="hud-synergies">
          {synergies.map((s, i) => (
            <div key={i} className="synergy-badge" style={{ backgroundColor: s.def.color }}>
              {s.def.name}
            </div>
          ))}
        </div>
      )}

      {/* 队伍协同徽章 */}
      {teamSynergies && teamSynergies.length > 0 && (
        <div className="hud-synergies" style={{ bottom: 90 }}>
          {teamSynergies.map((s, i) => (
            <div key={i} className="synergy-badge" style={{ backgroundColor: s.color, fontSize: 10 }} title={s.desc}>
              🤝 {s.name}
            </div>
          ))}
        </div>
      )}

      {/* 主动道具 Q 键 */}
      {activeItem && (
        <div style={{
          position: 'absolute', bottom: 95, right: 16,
          background: 'rgba(0,0,0,0.7)', borderRadius: 8, padding: '6px 10px',
          border: `2px solid ${activeItem.def.color}`, textAlign: 'center', minWidth: 60,
        }}>
          <div style={{ color: activeItem.def.color, fontSize: 11, fontWeight: 'bold' }}>{activeItem.def.name}</div>
          {activeItem.cooldownRemaining > 0 ? (
            <div style={{ color: '#888', fontSize: 12 }}>{Math.ceil(activeItem.cooldownRemaining / 1000)}s</div>
          ) : (
            <div style={{ color: '#4caf50', fontSize: 12, fontWeight: 'bold' }}>Q 就绪</div>
          )}
          {activeItem.buffTimer > 0 && (
            <div style={{ color: '#e91e63', fontSize: 10 }}>🔥 {Math.ceil(activeItem.buffTimer / 1000)}s</div>
          )}
        </div>
      )}

      {floorInfo?.portalReady && (
        <div className="portal-hint">传送门已开启!</div>
      )}
    </div>
  )
}

function HeroTooltip({ hero, position, total }: { hero: HeroState; position: number; total: number }) {
  const leftPercent = ((position + 1) / (total + 1)) * 100

  return (
    <div style={{
      position: 'absolute', bottom: 100, left: `${leftPercent}%`, transform: 'translateX(-50%)',
      background: 'rgba(10,10,20,0.95)', border: '1px solid #555', borderRadius: 10,
      padding: '12px 14px', minWidth: 240, maxWidth: 300, zIndex: 100,
      boxShadow: '0 4px 20px rgba(0,0,0,0.6)', pointerEvents: 'none',
    }}>
      {/* 头部 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, borderBottom: '1px solid #333', paddingBottom: 8 }}>
        <div style={{
          width: 36, height: 36, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
          backgroundColor: hero.def.color, fontSize: 18, fontWeight: 'bold', color: '#fff', flexShrink: 0,
        }}>
          {hero.def.name[0]}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ color: hero.def.color, fontWeight: 'bold', fontSize: 14 }}>{hero.def.name}</div>
          <div style={{ color: '#888', fontSize: 11 }}>{hero.def.skill} — {hero.def.skillDesc}</div>
        </div>
        {hero.isDead && <span style={{ color: '#e74c3c', fontSize: 11 }}>☠ 已死亡</span>}
      </div>

      {/* 基础属性 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px', marginBottom: 8, fontSize: 12 }}>
        <div style={{ color: '#aaa' }}>HP: <span style={{ color: '#2ecc71' }}>{Math.round(hero.hp)}/{hero.maxHp}</span></div>
        <div style={{ color: '#aaa' }}>ATK: <span style={{ color: '#e74c3c' }}>{hero.def.attack}</span></div>
        <div style={{ color: '#aaa' }}>等级: <span style={{ color: '#ffd700' }}>Lv.{hero.level}</span></div>
        <div style={{ color: '#aaa' }}>速度: <span style={{ color: '#3498db' }}>{hero.def.speed}</span></div>
      </div>

      {/* 道具栏 */}
      <div style={{ marginBottom: 8 }}>
        <div style={{ color: '#888', fontSize: 11, marginBottom: 3 }}>📦 道具</div>
        {hero.items.every(it => it === null) ? (
          <div style={{ color: '#555', fontSize: 11 }}>无道具</div>
        ) : (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {hero.items.map((item, j) => (
              <div key={j} style={{
                padding: '2px 6px', borderRadius: 4, fontSize: 11,
                background: item ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.03)',
                border: item ? `1px solid ${item.def.color}` : '1px solid #333',
                color: item ? item.def.color : '#555',
              }}>
                {item ? `${item.def.name}` : '空'}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 能力列表 */}
      <div>
        <div style={{ color: '#888', fontSize: 11, marginBottom: 3 }}>⚡ 能力 ({hero.abilities.length}/6)</div>
        {hero.abilities.length === 0 ? (
          <div style={{ color: '#555', fontSize: 11 }}>无能力</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {hero.abilities.map((ab, j) => (
              <div key={j} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                <div style={{ width: 3, height: 14, borderRadius: 1, backgroundColor: ab.def.color, flexShrink: 0 }} />
                <span style={{ color: ab.def.color, fontWeight: 'bold' }}>{ab.def.name}</span>
                <span style={{ color: '#ffd700', fontSize: 10 }}>×{ab.stacks}/{ab.def.maxStacks}</span>
                <span style={{ color: '#888', fontSize: 10, flex: 1 }}>{ab.def.desc}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

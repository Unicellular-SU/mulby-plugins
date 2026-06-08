import { useState } from 'react'
import type { MetaProgress } from '../game/types'
import { HEROES, HERO_UNLOCK_COST } from '../game/data/heroes'
import { ABILITIES, DEFAULT_ABILITIES } from '../game/data/abilities'
import { SYNERGIES, DEFAULT_SYNERGIES } from '../game/data/synergies'
import { ACHIEVEMENTS } from '../game/data/achievements'

interface Props {
  meta: MetaProgress
  onBack: () => void
  onUpgrade: (key: string, cost: number) => void
  onUnlockHero: (heroId: string, cost: number) => void
  onUnlockAbility: (abilityId: string, cost: number) => void
  onUnlockSynergy: (synergyId: string, cost: number) => void
  onStartRun: (heroIds: string[]) => void
}

type Tab = 'training' | 'smith' | 'library' | 'tavern' | 'shrine' | 'achievements'

export default function Hub({ meta, onBack, onUpgrade, onUnlockHero, onUnlockAbility, onUnlockSynergy, onStartRun }: Props) {
  const [tab, setTab] = useState<Tab>('training')

  const trainingCost = (level: number) => 10 + level * 5
  const smithCost = 20 + meta.weaponLevel * 15
  const unlockedSet = new Set(meta.unlockedHeroes)
  const allHeroes = Object.values(HEROES)
  const unlockedAbilitySet = new Set(meta.unlockedAbilities)
  const freeAbilitySet = new Set(DEFAULT_ABILITIES)
  const unlockedSynergySet = new Set(meta.unlockedSynergies)
  const freeSynergySet = new Set(DEFAULT_SYNERGIES)

  return (
    <div className="hub">
      <div className="hub-header">
        <button className="btn btn-back" onClick={onBack}>← 返回</button>
        <h2 className="hub-title">营地</h2>
        <div className="crystal-display">
          <span className="crystal-icon">◆</span>
          <span>{meta.crystals}</span>
        </div>
      </div>

      <div className="hub-tabs">
        {(['training', 'smith', 'library', 'tavern', 'shrine', 'achievements'] as Tab[]).map(t => (
          <button
            key={t}
            className={`tab-btn ${tab === t ? 'active' : ''}`}
            onClick={() => setTab(t)}
          >
            {t === 'training' ? '训练营' : t === 'smith' ? '铁匠铺' : t === 'library' ? '图书馆' : t === 'tavern' ? '酒馆' : t === 'shrine' ? '神龛' : '成就'}
          </button>
        ))}
      </div>

      <div className="hub-content">
        {tab === 'training' && (
          <div className="upgrade-grid">
            <UpgradeCard
              name="攻击强化"
              desc={`攻击力 +5%/级 (当前 ${meta.attackLevel} 级)`}
              level={meta.attackLevel}
              cost={trainingCost(meta.attackLevel)}
              crystals={meta.crystals}
              onUpgrade={() => onUpgrade('attackLevel', trainingCost(meta.attackLevel))}
              color="#e74c3c"
            />
            <UpgradeCard
              name="生命强化"
              desc={`生命值 +5%/级 (当前 ${meta.healthLevel} 级)`}
              level={meta.healthLevel}
              cost={trainingCost(meta.healthLevel)}
              crystals={meta.crystals}
              onUpgrade={() => onUpgrade('healthLevel', trainingCost(meta.healthLevel))}
              color="#2ecc71"
            />
            <UpgradeCard
              name="速度强化"
              desc={`移速 +3%/级 (当前 ${meta.speedLevel} 级)`}
              level={meta.speedLevel}
              cost={trainingCost(meta.speedLevel)}
              crystals={meta.crystals}
              onUpgrade={() => onUpgrade('speedLevel', trainingCost(meta.speedLevel))}
              color="#3498db"
            />
          </div>
        )}

        {tab === 'smith' && (
          <div className="upgrade-grid">
            <UpgradeCard
              name="锻造武器"
              desc={`初始攻击力 +2/级 (当前 ${meta.weaponLevel} 级)`}
              level={meta.weaponLevel}
              cost={smithCost}
              crystals={meta.crystals}
              onUpgrade={() => onUpgrade('weaponLevel', smithCost)}
              color="#f39c12"
              maxLevel={5}
            />
          </div>
        )}

        {tab === 'tavern' && (
          <div className="hero-grid">
            {allHeroes.map(hero => {
              const unlocked = unlockedSet.has(hero.id)
              const cost = HERO_UNLOCK_COST[hero.id] || 0
              return (
                <div key={hero.id} className={`hero-card ${unlocked ? 'unlocked' : 'locked'}`}>
                  <div className="hero-avatar" style={{ backgroundColor: hero.color }}>
                    {hero.name[0]}
                  </div>
                  <div className="hero-info">
                    <h4>{hero.name}</h4>
                    <p>HP:{hero.maxHp} ATK:{hero.attack}</p>
                    <p className="hero-skill">{hero.skill}: {hero.skillDesc}</p>
                  </div>
                  {!unlocked && cost > 0 && (
                    <button
                      className="btn btn-small"
                      disabled={meta.crystals < cost}
                      onClick={() => onUnlockHero(hero.id, cost)}
                    >
                      ◆{cost} 解锁
                    </button>
                  )}
                  {unlocked && <span className="badge-unlocked">已解锁</span>}
                </div>
              )
            })}
          </div>
        )}

        {tab === 'library' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <p style={{ color: '#888', fontSize: 12, margin: '0 0 8px' }}>消耗水晶解锁新能力，解锁后可在关卡升级时随机获得</p>
            {ABILITIES.map(ab => {
              const isFree = freeAbilitySet.has(ab.id)
              const unlocked = unlockedAbilitySet.has(ab.id)
              const available = isFree || unlocked
              const cost = 30 // 统一价格
              return (
                <div key={ab.id} style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
                  borderRadius: 8, background: unlocked ? 'rgba(46,204,113,0.1)' : 'rgba(255,255,255,0.05)',
                  border: `1px solid ${unlocked ? '#2ecc71' : '#333'}`,
                }}>
                  <div style={{ width: 4, height: 24, borderRadius: 2, backgroundColor: ab.color, flexShrink: 0 }} />
                  <div style={{ flex: 1 }}>
                    <span style={{ color: ab.color, fontWeight: 'bold', fontSize: 13 }}>{ab.name}</span>
                    <span style={{ color: '#888', fontSize: 11, marginLeft: 8 }}>{ab.desc}</span>
                  </div>
                  {isFree ? (
                    <span style={{ color: '#ffd700', fontSize: 12 }}>✦ 免费</span>
                  ) : available ? (
                    <span style={{ color: '#2ecc71', fontSize: 12 }}>✓ 已解锁</span>
                  ) : (
                    <button
                      className="btn btn-small"
                      disabled={meta.crystals < cost}
                      onClick={() => onUnlockAbility(ab.id, cost)}
                    >
                      ◆{cost} 解锁
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {tab === 'shrine' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <p style={{ color: '#888', fontSize: 12, margin: '0 0 8px' }}>消耗水晶解锁协同组合，游戏中集齐对应标签即可触发</p>
            {SYNERGIES.map(syn => {
              const isFree = freeSynergySet.has(syn.id)
              const unlocked = unlockedSynergySet.has(syn.id)
              const available = isFree || unlocked
              const cost = 50
              return (
                <div key={syn.id} style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
                  borderRadius: 8, background: available ? 'rgba(46,204,113,0.1)' : 'rgba(255,255,255,0.05)',
                  border: `1px solid ${available ? '#2ecc71' : '#333'}`,
                }}>
                  <div style={{ width: 4, height: 24, borderRadius: 2, backgroundColor: syn.color, flexShrink: 0 }} />
                  <div style={{ flex: 1 }}>
                    <span style={{ color: syn.color, fontWeight: 'bold', fontSize: 13 }}>{syn.name}</span>
                    <span style={{ color: '#888', fontSize: 11, marginLeft: 8 }}>{syn.desc}</span>
                  </div>
                  {isFree ? (
                    <span style={{ color: '#ffd700', fontSize: 12 }}>✦ 免费</span>
                  ) : available ? (
                    <span style={{ color: '#2ecc71', fontSize: 12 }}>✓ 已解锁</span>
                  ) : (
                    <button
                      className="btn btn-small"
                      disabled={meta.crystals < cost}
                      onClick={() => onUnlockSynergy(syn.id, cost)}
                    >
                      ◆{cost} 解锁
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {tab === 'achievements' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {ACHIEVEMENTS.map(ach => {
              const unlocked = meta.achievements?.includes(ach.id)
              return (
                <div
                  key={ach.id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '10px 14px', borderRadius: 8,
                    background: unlocked ? 'rgba(46, 204, 113, 0.15)' : 'rgba(255,255,255,0.05)',
                    border: `1px solid ${unlocked ? '#2ecc71' : '#333'}`,
                  }}
                >
                  <div style={{
                    width: 32, height: 32, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: unlocked ? '#2ecc71' : '#333', fontSize: 16, flexShrink: 0,
                  }}>
                    {unlocked ? '✓' : '?'}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ color: unlocked ? '#2ecc71' : '#888', fontWeight: 'bold', fontSize: 13 }}>
                      {ach.name}
                      <span style={{ fontSize: 10, color: ach.category === 'challenge' ? '#e94560' : '#888', marginLeft: 6 }}>
                        {ach.category === 'challenge' ? '挑战' : '基础'}
                      </span>
                    </div>
                    <div style={{ color: '#aaa', fontSize: 11 }}>{ach.desc}</div>
                  </div>
                  <div style={{ color: '#ffd700', fontSize: 12, flexShrink: 0 }}>
                    {unlocked ? '✓ 已获得' : `◆${ach.rewardCrystals}`}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="hub-stats">
        <span>总冒险次数: {meta.totalRuns}</span>
        <span>最高层数: {meta.bestFloor}</span>
      </div>
    </div>
  )
}

function UpgradeCard({ name, desc, level, cost, crystals, onUpgrade, color, maxLevel = 20 }: {
  name: string; desc: string; level: number; cost: number; crystals: number
  onUpgrade: () => void; color: string; maxLevel?: number
}) {
  return (
    <div className="upgrade-card">
      <div className="card-header" style={{ borderColor: color }}>
        <h3 style={{ color }}>{name}</h3>
        <span className="card-level">Lv.{level}/{maxLevel}</span>
      </div>
      <p className="card-desc">{desc}</p>
      <div className="card-bar">
        <div className="card-bar-fill" style={{ width: `${(level / maxLevel) * 100}%`, backgroundColor: color }} />
      </div>
      {level < maxLevel ? (
        <button
          className="btn btn-upgrade"
          disabled={crystals < cost}
          onClick={onUpgrade}
        >
          ◆{cost} 升级
        </button>
      ) : (
        <span className="max-badge">已满级</span>
      )}
    </div>
  )
}

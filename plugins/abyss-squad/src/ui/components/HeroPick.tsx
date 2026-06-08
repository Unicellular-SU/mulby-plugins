import { useState } from 'react'
import type { MetaProgress } from '../game/types'
import { HEROES } from '../game/data/heroes'

interface Props {
  meta: MetaProgress
  onConfirm: (heroIds: string[]) => void
  onBack: () => void
}

export default function HeroPick({ meta, onConfirm, onBack }: Props) {
  const unlockedHeroes = meta.unlockedHeroes.filter(id => HEROES[id])
  const [picked, setPicked] = useState<string[]>(unlockedHeroes.slice(0, 3))

  const toggleHero = (id: string) => {
    if (picked.includes(id)) {
      if (picked.length <= 1) return // 至少选1个
      setPicked(prev => prev.filter(h => h !== id))
    } else {
      if (picked.length >= 3) return // 最多3个
      setPicked(prev => [...prev, id])
    }
  }

  const canConfirm = picked.length >= 1 && picked.length <= 3

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      height: '100%', padding: 20, color: '#fff',
    }}>
      <h2 style={{ color: '#e94560', marginBottom: 8 }}>选择小队</h2>
      <p style={{ color: '#888', fontSize: 13, marginBottom: 20 }}>
        选择 1~3 名英雄出战 · 已选 {picked.length}/3
      </p>

      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', justifyContent: 'center', marginBottom: 24 }}>
        {unlockedHeroes.map(id => {
          const hero = HEROES[id]
          if (!hero) return null
          const selected = picked.includes(id)
          return (
            <div
              key={id}
              onClick={() => toggleHero(id)}
              style={{
                width: 120, padding: '14px 10px', borderRadius: 12, textAlign: 'center',
                cursor: 'pointer', transition: 'all 0.2s',
                background: selected ? 'rgba(46,204,113,0.2)' : 'rgba(255,255,255,0.05)',
                border: `2px solid ${selected ? '#2ecc71' : '#333'}`,
                transform: selected ? 'scale(1.05)' : 'scale(1)',
              }}
            >
              <div style={{
                width: 44, height: 44, borderRadius: '50%', margin: '0 auto 6px',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                backgroundColor: hero.color, fontSize: 20, fontWeight: 'bold',
              }}>
                {hero.name[0]}
              </div>
              <div style={{ fontWeight: 'bold', fontSize: 14 }}>{hero.name}</div>
              <div style={{ fontSize: 11, color: '#888' }}>HP:{hero.maxHp} ATK:{hero.attack}</div>
              <div style={{ fontSize: 10, color: '#666', marginTop: 2 }}>{hero.skill}</div>
              {selected && <div style={{ color: '#2ecc71', fontSize: 12, marginTop: 2 }}>✓ 已选择</div>}
            </div>
          )
        })}
      </div>

      <div style={{ display: 'flex', gap: 12 }}>
        <button className="btn btn-back" onClick={onBack}>← 返回</button>
        <button
          className="btn"
          disabled={!canConfirm}
          onClick={() => onConfirm(picked)}
          style={{
            padding: '10px 32px', fontSize: 16,
            background: canConfirm ? '#0f3460' : '#333',
            border: '1px solid #533483', borderRadius: 8, color: canConfirm ? '#fff' : '#666',
            cursor: canConfirm ? 'pointer' : 'not-allowed',
          }}
        >
          出发!
        </button>
      </div>
    </div>
  )
}

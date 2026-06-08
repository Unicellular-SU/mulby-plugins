interface Props {
  crystals: number
  floor: number
  newAchievements?: Array<{ id: string; name: string; rewardCrystals: number }>
  onContinue: () => void
  onMenu: () => void
  onRetry: () => void
}

export default function GameOver({ crystals, floor, newAchievements = [], onContinue, onMenu, onRetry }: Props) {
  const victory = floor >= 10

  return (
    <div className="gameover">
      <div className="gameover-panel">
        <h2 className={`gameover-title ${victory ? 'victory' : 'defeat'}`}>
          {victory ? '通关!' : '冒险结束'}
        </h2>
        <div className="gameover-stats">
          <div className="stat-row">
            <span>到达层数</span>
            <span className="stat-value">{floor} / 10</span>
          </div>
          <div className="stat-row">
            <span>获得水晶</span>
            <span className="stat-value crystal">◆ {crystals}</span>
          </div>
        </div>
        {newAchievements.length > 0 && (
          <div style={{
            margin: '12px 0', padding: 10, borderRadius: 8,
            background: 'rgba(46,204,113,0.1)', border: '1px solid #2ecc71',
          }}>
            <div style={{ color: '#2ecc71', fontWeight: 'bold', fontSize: 13, marginBottom: 6 }}>🏆 新成就解锁!</div>
            {newAchievements.map(ach => (
              <div key={ach.id} style={{ color: '#ccc', fontSize: 12, marginBottom: 4 }}>
                {ach.name} <span style={{ color: '#ffd700' }}>+{ach.rewardCrystals}◆</span>
              </div>
            ))}
          </div>
        )}
        <div className="gameover-buttons">
          <button className="btn btn-primary" onClick={onContinue}>
            返回营地
          </button>
          <button className="btn btn-secondary" onClick={onRetry}>
            再来一局
          </button>
          <button className="btn btn-ghost" onClick={onMenu}>
            主菜单
          </button>
        </div>
      </div>
    </div>
  )
}

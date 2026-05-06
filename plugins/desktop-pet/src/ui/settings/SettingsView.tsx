import { useState, useEffect } from 'react'
import { DEFAULT_PERSONALITY, type PetPersonality } from '../engine/ai-chat'
import type { PetStats } from '../engine/pet-stats'
import type { PetMemory } from '../engine/pet-memory'
import './settings.css'

const TRAITS = [
  { id: 'lively', label: '活泼', desc: '开朗爱说话，偶尔喵一下' },
  { id: 'quiet', label: '安静', desc: '温柔少语，慵懒可爱' },
  { id: 'sarcastic', label: '毒舌', desc: '吐槽但关心，犀利有趣' },
  { id: 'warm', label: '暖心', desc: '温暖治愈，总是鼓励你' },
] as const

const FREQUENCIES = [
  { id: 'high', label: '频繁' },
  { id: 'medium', label: '适中' },
  { id: 'low', label: '偶尔' },
  { id: 'click-only', label: '仅点击' },
] as const

export default function SettingsView() {
  const [personality, setPersonality] = useState<PetPersonality>(DEFAULT_PERSONALITY)
  const [models, setModels] = useState<Array<{ id: string; label: string }>>([])
  const [toast, setToast] = useState('')
  const [tab, setTab] = useState<'personality' | 'stats' | 'memory'>('personality')
  const [stats, setStats] = useState<PetStats | null>(null)
  const [memories, setMemories] = useState<PetMemory[]>([])
  const [memoryFilter, setMemoryFilter] = useState<'all' | 'pinned'>('all')

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(''), 2500)
  }

  useEffect(() => {
    const load = async () => {
      try {
        const saved = await window.mulby.storage.get('pet-personality')
        if (saved) setPersonality(saved as PetPersonality)
      } catch {}

      try {
        const allModels = await window.mulby.ai.allModels()
        const textModels = allModels.filter((m: any) =>
          !m.id.includes('image') && !m.id.includes('embed') && !m.id.includes('rerank')
        )
        setModels(textModels.map((m: any) => ({ id: m.id, label: m.label || m.id })))
        if (!personality.model && textModels.length > 0) {
          setPersonality(p => ({ ...p, model: textModels[0].id }))
        }
      } catch {}

      try {
        const savedStats = await window.mulby.storage.get('pet-stats')
        if (savedStats) setStats(savedStats as PetStats)
      } catch {}

      try {
        const savedMems = await window.mulby.storage.get('pet-memories')
        if (Array.isArray(savedMems)) setMemories(savedMems as PetMemory[])
      } catch {}
    }
    load()
  }, [])

  const handleSave = async () => {
    try {
      await window.mulby.storage.set('pet-personality', personality)
      showToast('设置已保存')
      window.mulby.window.sendToParent('settings-updated', { personality })
    } catch (err) {
      console.error('Save error:', err)
    }
  }

  const handleTogglePin = async (id: string) => {
    const updated = memories.map(m => {
      if (m.id !== id) return m
      const pinnedCount = memories.filter(x => x.pinned).length
      if (!m.pinned && pinnedCount >= 10) return m
      return { ...m, pinned: !m.pinned }
    })
    setMemories(updated)
    await window.mulby.storage.set('pet-memories', updated)
    showToast('已更新')
  }

  const handleDeleteMemory = async (id: string) => {
    const updated = memories.filter(m => m.id !== id)
    setMemories(updated)
    await window.mulby.storage.set('pet-memories', updated)
    showToast('已删除')
  }

  const renderMemory = () => {
    const filtered = memoryFilter === 'pinned'
      ? memories.filter(m => m.pinned)
      : memories

    const typeLabels: Record<string, string> = {
      fact: '事实', preference: '偏好', event: '事件', habit: '习惯'
    }

    return (
      <div className="panel-content">
        <div className="memory-header">
          <span className="memory-count">共 {memories.length} 条记忆</span>
          <div className="memory-filter">
            <button className={`filter-btn ${memoryFilter === 'all' ? 'active' : ''}`} onClick={() => setMemoryFilter('all')}>全部</button>
            <button className={`filter-btn ${memoryFilter === 'pinned' ? 'active' : ''}`} onClick={() => setMemoryFilter('pinned')}>固定</button>
          </div>
        </div>
        {filtered.length === 0 && (
          <div className="memory-empty">
            {memoryFilter === 'pinned' ? '暂无固定记忆' : '宠物还没有形成记忆，多互动几次吧'}
          </div>
        )}
        <div className="memory-list">
          {filtered.map(m => (
            <div key={m.id} className={`memory-item ${m.pinned ? 'pinned' : ''}`}>
              <div className="memory-item-top">
                <span className="memory-type">{typeLabels[m.type] || m.type}</span>
                <span className="memory-date">{new Date(m.createdAt).toLocaleDateString()}</span>
              </div>
              <div className="memory-content">{m.content}</div>
              {m.tags.length > 0 && (
                <div className="memory-tags">
                  {m.tags.map((t, i) => <span key={i} className="memory-tag">{t}</span>)}
                </div>
              )}
              <div className="memory-actions">
                <button
                  className={`mem-action-btn ${m.pinned ? 'unpin' : 'pin'}`}
                  onClick={() => handleTogglePin(m.id)}
                  title={m.pinned ? '取消固定' : '固定'}
                >
                  {m.pinned ? '📌 取消固定' : '📌 固定'}
                </button>
                <button
                  className="mem-action-btn delete"
                  onClick={() => handleDeleteMemory(m.id)}
                >
                  🗑️ 删除
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  const renderStats = () => {
    if (!stats) return <div className="panel-content"><p style={{ opacity: 0.6 }}>暂无数据</p></div>
    const days = Math.floor((Date.now() - stats.createdAt) / 86_400_000)
    return (
      <div className="panel-content">
        <div className="stats-card">
          <div className="stats-row"><span>❤️ 亲密度</span><span className="stats-value">{stats.intimacy}/100</span></div>
          <div className="stats-row"><span>📅 连续签到</span><span className="stats-value">{stats.streakDays} 天</span></div>
          <div className="stats-row"><span>🍅 今日番茄</span><span className="stats-value">{stats.pomodoroToday} 个</span></div>
          <div className="stats-row"><span>🍅 累计番茄</span><span className="stats-value">{stats.pomodoroTotal} 个</span></div>
          <div className="stats-row"><span>⏱️ 专注时长</span><span className="stats-value">{stats.totalFocusMinutes} 分钟</span></div>
          <div className="stats-row"><span>👆 累计互动</span><span className="stats-value">{stats.totalInteractions} 次</span></div>
          <div className="stats-row"><span>🎂 相伴天数</span><span className="stats-value">{days} 天</span></div>
        </div>
      </div>
    )
  }

  return (
    <div className="settings-root">
      <div className="settings-header">
        <div className="tab-bar">
          <button className={`tab ${tab === 'personality' ? 'active' : ''}`} onClick={() => setTab('personality')}>性格设置</button>
          <button className={`tab ${tab === 'stats' ? 'active' : ''}`} onClick={() => setTab('stats')}>我的宠物</button>
          <button className={`tab ${tab === 'memory' ? 'active' : ''}`} onClick={() => setTab('memory')}>记忆</button>
        </div>
      </div>

      <div className="settings-body">
        {tab === 'stats' && renderStats()}
        {tab === 'memory' && renderMemory()}
        {tab === 'personality' && <div className="panel-content">
          <div className="field">
            <label className="field-label">宠物名称</label>
            <input
              className="field-input"
              value={personality.name}
              onChange={e => setPersonality(p => ({ ...p, name: e.target.value }))}
              placeholder="给宠物取个名字"
              maxLength={10}
            />
          </div>

          <div className="field">
            <label className="field-label">性格</label>
            <div className="trait-grid">
              {TRAITS.map(t => (
                <button
                  key={t.id}
                  className={`trait-card ${personality.trait === t.id ? 'active' : ''}`}
                  onClick={() => setPersonality(p => ({ ...p, trait: t.id }))}
                >
                  <span className="trait-name">{t.label}</span>
                  <span className="trait-desc">{t.desc}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <label className="field-label">AI 模型</label>
            <select
              className="field-select"
              value={personality.model}
              onChange={e => setPersonality(p => ({ ...p, model: e.target.value }))}
            >
              {models.length === 0 && <option value="">未配置模型</option>}
              {models.map(m => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
          </div>

          <div className="field">
            <label className="field-label">说话频率</label>
            <div className="freq-row">
              {FREQUENCIES.map(f => (
                <button
                  key={f.id}
                  className={`freq-btn ${personality.frequency === f.id ? 'active' : ''}`}
                  onClick={() => setPersonality(p => ({ ...p, frequency: f.id }))}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <label className="field-label">触发行为</label>
            <div className="trigger-list">
              {([
                ['idle', '闲置时打招呼'],
                ['typing', '打字时评论'],
                ['morning', '早晨问候'],
                ['lateNight', '深夜提醒'],
              ] as const).map(([key, label]) => (
                <label key={key} className="trigger-item">
                  <input
                    type="checkbox"
                    checked={personality.triggers[key]}
                    onChange={e => setPersonality(p => ({
                      ...p,
                      triggers: { ...p.triggers, [key]: e.target.checked }
                    }))}
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </div>
        </div>}
      </div>

      {tab === 'personality' && <div className="settings-footer">
        <button className="save-btn" onClick={handleSave}>保存设置</button>
      </div>}

      {toast && <div className="toast-wrap"><div className="toast">{toast}</div></div>}
    </div>
  )
}

import { useState, useEffect, useCallback, useRef } from 'react'
import { DEFAULT_PERSONALITY, type PetPersonality } from '../engine/ai-chat'
import { DEFAULT_COLORS, type PetColorScheme } from '../engine/sprite'
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
  const [tab, setTab] = useState<'personality' | 'appearance'>('personality')
  const [personality, setPersonality] = useState<PetPersonality>(DEFAULT_PERSONALITY)
  const [colors, setColors] = useState<PetColorScheme>(DEFAULT_COLORS)
  const [models, setModels] = useState<Array<{ id: string; label: string }>>([])
  const [genPrompt, setGenPrompt] = useState('')
  const [generating, setGenerating] = useState(false)
  const [toast, setToast] = useState('')
  const previewRef = useRef<HTMLCanvasElement>(null)

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(''), 2500)
  }

  useEffect(() => {
    const load = async () => {
      try {
        const saved = await window.mulby.storage.get('pet-personality')
        if (saved) setPersonality(saved as PetPersonality)
        const savedColors = await window.mulby.storage.get('pet-colors')
        if (savedColors) setColors(savedColors as PetColorScheme)
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
    }
    load()
  }, [])

  useEffect(() => {
    drawPreview()
  }, [colors])

  const drawPreview = useCallback(() => {
    const canvas = previewRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    const s = 80
    const u = s / 16
    ctx.clearRect(0, 0, s, s)

    ctx.fillStyle = colors.body
    ctx.beginPath()
    ctx.roundRect(4 * u, 7 * u, 8 * u, 5 * u, 2 * u)
    ctx.fill()
    ctx.fillStyle = colors.belly
    ctx.beginPath()
    ctx.roundRect(5.5 * u, 8.5 * u, 5 * u, 3 * u, 1.5 * u)
    ctx.fill()

    ctx.fillStyle = colors.body
    ctx.beginPath()
    ctx.roundRect(4 * u, 3 * u, 8 * u, 5 * u, 2.5 * u)
    ctx.fill()

    ctx.fillStyle = colors.body
    ctx.beginPath()
    ctx.moveTo(4.5 * u, 3.5 * u)
    ctx.lineTo(6 * u, 1.5 * u)
    ctx.lineTo(7 * u, 3.5 * u)
    ctx.closePath()
    ctx.fill()
    ctx.beginPath()
    ctx.moveTo(9 * u, 3.5 * u)
    ctx.lineTo(10 * u, 1.5 * u)
    ctx.lineTo(11.5 * u, 3.5 * u)
    ctx.closePath()
    ctx.fill()

    ctx.fillStyle = colors.earInner
    ctx.beginPath()
    ctx.moveTo(5.2 * u, 3.5 * u)
    ctx.lineTo(6 * u, 2.2 * u)
    ctx.lineTo(6.5 * u, 3.5 * u)
    ctx.closePath()
    ctx.fill()
    ctx.beginPath()
    ctx.moveTo(9.5 * u, 3.5 * u)
    ctx.lineTo(10 * u, 2.2 * u)
    ctx.lineTo(10.8 * u, 3.5 * u)
    ctx.closePath()
    ctx.fill()

    ctx.fillStyle = '#333'
    ctx.beginPath()
    ctx.ellipse(6.2 * u, 5 * u, 0.5 * u, 0.7 * u, 0, 0, Math.PI * 2)
    ctx.ellipse(9.8 * u, 5 * u, 0.5 * u, 0.7 * u, 0, 0, Math.PI * 2)
    ctx.fill()

    ctx.fillStyle = colors.nose
    ctx.beginPath()
    ctx.arc(8 * u, 6.2 * u, 0.35 * u, 0, Math.PI * 2)
    ctx.fill()
  }, [colors])

  const handleSave = async () => {
    try {
      await window.mulby.storage.set('pet-personality', personality)
      await window.mulby.storage.set('pet-colors', colors)
      showToast('设置已保存')
      window.mulby.window.sendToParent('settings-updated', { personality, colors })
    } catch (err) {
      console.error('Save error:', err)
    }
  }

  const handleGenerateColors = async () => {
    if (!genPrompt.trim() || generating) return
    setGenerating(true)

    try {
      const ai = window.mulby.ai
      const result = await ai.call({
        model: personality.model || models[0]?.id || 'openai:gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `你是一个宠物配色设计师。用户会描述他们想要的宠物外观风格，你需要返回一个 JSON 配色方案。
格式必须严格为：{"body":"#hex","belly":"#hex","bodyDark":"#hex","earInner":"#hex","nose":"#hex"}
body=主体色，belly=肚皮（浅色），bodyDark=阴影色（深色），earInner=耳朵内侧，nose=鼻子
只返回 JSON，不要其他文字。`
          },
          { role: 'user', content: genPrompt }
        ],
        params: { temperature: 0.8, maxOutputTokens: 100 },
        capabilities: [],
        toolingPolicy: { enableInternalTools: false },
        mcp: { mode: 'off' },
        skills: { mode: 'off' },
      })

      const text = result?.content || ''
      const match = text.match(/\{[^}]+\}/)
      if (match) {
        const parsed = JSON.parse(match[0]) as PetColorScheme
        if (parsed.body && parsed.belly && parsed.bodyDark && parsed.earInner && parsed.nose) {
          setColors(parsed)
          showToast('配色方案已生成')
        }
      }
    } catch (err) {
      console.error('Generate error:', err)
      showToast('生成失败，请重试')
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="settings-root">
      <div className="tab-bar">
        <button className={`tab ${tab === 'personality' ? 'active' : ''}`} onClick={() => setTab('personality')}>
          性格设定
        </button>
        <button className={`tab ${tab === 'appearance' ? 'active' : ''}`} onClick={() => setTab('appearance')}>
          外观定制
        </button>
      </div>

      <div className="settings-body">
        {tab === 'personality' && (
          <div className="panel-content">
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
          </div>
        )}

        {tab === 'appearance' && (
          <div className="panel-content">
            <div className="preview-section">
              <canvas ref={previewRef} width={80} height={80} className="color-preview" />
              <div className="color-swatches">
                {([
                  ['body', '主体'],
                  ['belly', '肚皮'],
                  ['bodyDark', '阴影'],
                  ['earInner', '耳朵'],
                  ['nose', '鼻子'],
                ] as const).map(([key, label]) => (
                  <div key={key} className="swatch-item">
                    <input
                      type="color"
                      value={colors[key]}
                      onChange={e => setColors(c => ({ ...c, [key]: e.target.value }))}
                      className="swatch-input"
                    />
                    <span className="swatch-label">{label}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="ai-gen-section">
              <label className="field-label">AI 生成配色</label>
              <div className="gen-row">
                <input
                  className="field-input"
                  value={genPrompt}
                  onChange={e => setGenPrompt(e.target.value)}
                  placeholder="描述想要的风格，如：橘猫、赛博朋克、蓝色小龙..."
                  onKeyDown={e => e.key === 'Enter' && handleGenerateColors()}
                />
                <button
                  className="gen-btn"
                  onClick={handleGenerateColors}
                  disabled={generating || !genPrompt.trim()}
                >
                  {generating ? '...' : '生成'}
                </button>
              </div>
            </div>

            <button
              className="reset-colors-btn"
              onClick={() => { setColors(DEFAULT_COLORS); showToast('已恢复默认配色') }}
            >
              恢复默认配色
            </button>
          </div>
        )}
      </div>

      <div className="settings-footer">
        <button className="save-btn" onClick={handleSave}>保存设置</button>
      </div>

      {toast && <div className="toast-wrap"><div className="toast">{toast}</div></div>}
    </div>
  )
}

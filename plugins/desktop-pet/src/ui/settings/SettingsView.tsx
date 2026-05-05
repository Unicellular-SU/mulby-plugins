import { useState, useEffect, useCallback } from 'react'
import { DEFAULT_PERSONALITY, type PetPersonality } from '../engine/ai-chat'
import { getPrebuiltPetList, getPrebuiltBlueprint, getPrebuiltPreviewSvg } from '../engine/prebuilt-pets'
import { generateAllSprites } from '../engine/pet-blueprint'
import type { PetSpriteSet, PetSpriteKey } from '../engine/pet-standard'
import { CORE_SPRITES } from '../engine/pet-standard'
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
  const [models, setModels] = useState<Array<{ id: string; label: string }>>([])
  const [selectedPet, setSelectedPet] = useState('cat')
  const [colorPrompt, setColorPrompt] = useState('')
  const [recoloring, setRecoloring] = useState(false)
  const [toast, setToast] = useState('')

  const petList = getPrebuiltPetList()

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(''), 2500)
  }

  useEffect(() => {
    const load = async () => {
      try {
        const saved = await window.mulby.storage.get('pet-personality')
        if (saved) setPersonality(saved as PetPersonality)
        const savedPetId = await window.mulby.storage.get('pet-selected-id')
        if (savedPetId && typeof savedPetId === 'string') setSelectedPet(savedPetId)
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

  const handleSavePersonality = async () => {
    try {
      await window.mulby.storage.set('pet-personality', personality)
      showToast('设置已保存')
      window.mulby.window.sendToParent('settings-updated', { personality })
    } catch (err) {
      console.error('Save error:', err)
    }
  }

  const handleSelectPet = async (petId: string) => {
    setSelectedPet(petId)
    const blueprint = getPrebuiltBlueprint(petId)
    if (!blueprint) return

    const allSprites = generateAllSprites(blueprint)
    const sprites: Partial<Record<PetSpriteKey, string>> = {}
    for (const key of CORE_SPRITES) {
      if (allSprites[key]) sprites[key] = allSprites[key]
    }

    const spriteSet: PetSpriteSet = {
      id: `prebuilt_${petId}`,
      name: blueprint.name,
      description: blueprint.description,
      sprites,
      createdAt: Date.now(),
    }

    await window.mulby.storage.set('pet-sprites', spriteSet)
    await window.mulby.storage.set('pet-selected-id', petId)
    window.mulby.window.sendToParent('sprites-updated', { spriteSet })
    showToast(`已选择: ${blueprint.name}`)
  }

  const handleRecolor = async () => {
    if (!colorPrompt.trim() || recoloring) return
    setRecoloring(true)

    try {
      const ai = window.mulby.ai
      let result = ''
      const req = ai.call(
        {
          model: personality.model || models[0]?.id || '',
          messages: [
            {
              role: 'system',
              content: `你是一个配色设计师。用户会描述想要的宠物颜色风格，你需要返回一个 5 色调色板 JSON。
格式：["#主体色", "#深色/描边", "#浅色/肚皮", "#点缀色", "#次要色"]
只返回 JSON 数组，不要其他文字。确保颜色之间有足够对比度。`
            },
            { role: 'user', content: colorPrompt }
          ],
          params: { temperature: 0.7, maxOutputTokens: 100 },
          capabilities: [],
          toolingPolicy: { enableInternalTools: false },
          mcp: { mode: 'off' },
          skills: { mode: 'off' },
        },
        (chunk: any) => {
          if (chunk.chunkType === 'text' && chunk.content) {
            result += chunk.content
          }
        }
      )
      await req

      const match = result.match(/\[[\s\S]*?\]/)
      if (match) {
        const colors = JSON.parse(match[0]) as string[]
        if (colors.length >= 5) {
          const blueprint = getPrebuiltBlueprint(selectedPet, colors)
          if (blueprint) {
            const allSprites = generateAllSprites(blueprint)
            const sprites: Partial<Record<PetSpriteKey, string>> = {}
            for (const key of CORE_SPRITES) {
              if (allSprites[key]) sprites[key] = allSprites[key]
            }

            const spriteSet: PetSpriteSet = {
              id: `recolor_${selectedPet}_${Date.now()}`,
              name: `${petList.find(p => p.id === selectedPet)?.name || ''} (自定义)`,
              description: colorPrompt,
              sprites,
              createdAt: Date.now(),
            }

            await window.mulby.storage.set('pet-sprites', spriteSet)
            window.mulby.window.sendToParent('sprites-updated', { spriteSet })
            showToast('配色已更新')
          }
        }
      }
    } catch (err) {
      console.error('Recolor error:', err)
      showToast('换色失败')
    } finally {
      setRecoloring(false)
    }
  }

  return (
    <div className="settings-root">
      <div className="tab-bar">
        <button className={`tab ${tab === 'personality' ? 'active' : ''}`} onClick={() => setTab('personality')}>
          性格设定
        </button>
        <button className={`tab ${tab === 'appearance' ? 'active' : ''}`} onClick={() => setTab('appearance')}>
          选择宠物
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
            <div className="field">
              <label className="field-label">选择宠物</label>
              <div className="pet-gallery">
                {petList.map(pet => {
                  const svg = getPrebuiltPreviewSvg(pet.id)
                  const src = svg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` : ''
                  return (
                    <button
                      key={pet.id}
                      className={`pet-card ${selectedPet === pet.id ? 'active' : ''}`}
                      onClick={() => handleSelectPet(pet.id)}
                    >
                      {src && <img src={src} className="pet-card-img" />}
                      <span className="pet-card-name">{pet.name}</span>
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="ai-gen-section">
              <label className="field-label">AI 换色</label>
              <p className="field-hint">描述你想要的颜色风格，AI 会为当前宠物生成新配色</p>
              <div className="gen-row">
                <input
                  className="field-input"
                  value={colorPrompt}
                  onChange={e => setColorPrompt(e.target.value)}
                  placeholder="如：赛博朋克霓虹色、粉色系、暗黑风格..."
                  onKeyDown={e => e.key === 'Enter' && handleRecolor()}
                />
                <button
                  className="gen-btn"
                  onClick={handleRecolor}
                  disabled={recoloring || !colorPrompt.trim()}
                >
                  {recoloring ? '...' : '换色'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="settings-footer">
        {tab === 'personality' && (
          <button className="save-btn" onClick={handleSavePersonality}>保存设置</button>
        )}
      </div>

      {toast && <div className="toast-wrap"><div className="toast">{toast}</div></div>}
    </div>
  )
}

import { useState, useEffect, useCallback, type ReactNode } from 'react'
import {
  DEFAULT_PERSONALITY,
  PET_CHAT_HISTORY_STORAGE_KEY,
  type PetPersonality,
  type PetReminder,
  type GeoContext,
  type PetChatHistoryItem,
} from '../engine/ai-chat'
import {
  ACTION_LIST,
  EMOTION_LIST,
  presentationIntentForAction,
  stripPresentationMarkers,
  type PresentationIntent,
} from '../engine/presentation'
import { ALL_EXPRESSIONS, ALL_POSES, type PetExpression, type PetPose } from '../engine/pet-standard'
import { normalizePersonality } from '../engine/message-validator'
import type { PetStats, PetMood } from '../engine/pet-stats'
import {
  LIFE_PROFILE_CATEGORIES,
  LIFE_PROFILE_CATEGORY_LABELS,
  PET_LIFE_PROFILE_STORAGE_KEY,
  countLifeProfileItems,
  createEmptyLifeProfile,
  normalizeLifeProfile,
  removeLifeProfileItem,
  updateLifeProfileItemContent,
  type LifeProfileCategory,
  type LifeProfileItem,
  type PetLifeProfile,
} from '../engine/pet-life-profile'
import { ALL_ACHIEVEMENTS, type UnlockedAchievement } from '../engine/achievements'
import type { DiaryEntry } from '../engine/pet-diary'
import './settings.css'

function Icon({ d, color = 'currentColor', size = 16 }: { d: string; color?: string; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
}

const ICONS = {
  heart: 'M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z',
  calendar: 'M19 4H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zM16 2v4M8 2v4M3 10h18',
  clock: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM12 6v6l4 2',
  target: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 12h0',
  hand: 'M18 11V6a2 2 0 0 0-4 0v1M14 10V4a2 2 0 0 0-4 0v6M10 10V5a2 2 0 0 0-4 0v9',
  gift: 'M20 12v10H4V12M2 7h20v5H2zM12 22V7M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7zM12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z',
  smile: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01',
  pin: 'M12 2l3 9h-6zM12 11v11M8 22h8',
  trash: 'M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2',
  mapPin: 'M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0zM12 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  refresh: 'M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15',
  star: 'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z',
  bell: 'M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0',
  plus: 'M12 5v14M5 12h14',
  edit: 'M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z',
  check: 'M20 6L9 17l-5-5',
  x: 'M18 6L6 18M6 6l12 12',
  cake: 'M20 21v-8a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8M4 16s.5-1 2-1 2.5 2 4 2 2.5-2 4-2 2.5 2 4 2 2-1 2-1M2 21h20M7 8v3M12 8v3M17 8v3M7 4h.01M12 4h.01M17 4h.01',
  layers: 'M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5',
} as const

function StatsIcon({ icon, children }: { icon: keyof typeof ICONS; children: ReactNode }) {
  return <span className="stats-icon"><Icon d={ICONS[icon]} color="var(--accent)" />{children}</span>
}

const MOOD_LABELS: Record<PetMood, string> = {
  ecstatic: '欣喜若狂', happy: '开心', content: '满足', neutral: '平静',
  bored: '无聊', lonely: '孤独', sad: '难过', grumpy: '暴躁', sleepy: '困倦',
}

const EXPRESSION_LABELS: Record<PetExpression, string> = {
  neutral: '平静',
  happy: '开心',
  sad: '难过',
  surprised: '惊讶',
  sleepy: '困倦',
  angry: '生气',
  excited: '兴奋',
  shy: '害羞',
  love: '喜欢',
  curious: '好奇',
  confused: '困惑',
  proud: '得意',
  scared: '害怕',
  focused: '专注',
  dizzy: '晕乎',
}

const POSE_LABELS: Record<PetPose, string> = {
  stand: '站立',
  walk_1: '前进',
  walk_2: '漫步',
  sit: '坐下',
  sleep: '睡眠',
  jump: '跳跃',
  wave: '挥手',
  hover: '悬浮',
  peek: '探头',
  spin: '旋转',
  dance: '摇摆',
  hide: '躲藏',
  focus: '专注',
}

const PLAYGROUND_POSE_FACE: Record<PetPose, PetExpression> = {
  stand: 'neutral',
  walk_1: 'neutral',
  walk_2: 'curious',
  sit: 'sleepy',
  sleep: 'sleepy',
  jump: 'excited',
  wave: 'happy',
  hover: 'neutral',
  peek: 'curious',
  spin: 'dizzy',
  dance: 'excited',
  hide: 'shy',
  focus: 'focused',
}

const TRAITS = [
  { id: 'lively', label: '活泼', desc: '开朗爱说话，好奇心满满' },
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

const POMODORO_OPTIONS = [
  { value: 5, label: '5 分钟' },
  { value: 15, label: '15 分钟' },
  { value: 25, label: '25 分钟' },
  { value: 45, label: '45 分钟' },
  { value: 60, label: '60 分钟' },
]

function generateReminderId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 5)
}

function formatHistoryAssistantText(raw: string): string {
  return stripPresentationMarkers(raw).trim() || raw.trim()
}

function formatDialogueDateTime(ms: number): string {
  return new Date(ms).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
}

/** 将存储中的 user/assistant 成对转为展示用轮次（新在前） */
function groupChatTurns(items: PetChatHistoryItem[]): Array<{ user: string; assistant: string; reasoning?: string; at?: number }> {
  const out: Array<{ user: string; assistant: string; reasoning?: string; at?: number }> = []
  for (let i = 0; i + 1 < items.length; i += 2) {
    const u = items[i]
    const a = items[i + 1]
    if (u?.role === 'user' && a?.role === 'assistant') {
      const at = typeof a.at === 'number' && Number.isFinite(a.at) ? a.at : (typeof u.at === 'number' && Number.isFinite(u.at) ? u.at : undefined)
      out.push({
        user: u.content,
        assistant: formatHistoryAssistantText(a.content),
        reasoning: a.reasoning?.trim() || undefined,
        at,
      })
    }
  }
  return out.reverse()
}

export default function SettingsView() {
  const [personality, setPersonality] = useState<PetPersonality>(DEFAULT_PERSONALITY)
  const [models, setModels] = useState<Array<{ id: string; label: string }>>([])
  const [toast, setToast] = useState('')
  const [tab, setTab] = useState<'personality' | 'stats' | 'memory' | 'achievements' | 'diary' | 'dialogue' | 'playground'>('personality')
  const [stats, setStats] = useState<PetStats | null>(null)
  const [lifeProfile, setLifeProfile] = useState<PetLifeProfile>(() => createEmptyLifeProfile())
  const [editingLifeMemoryId, setEditingLifeMemoryId] = useState<string | null>(null)
  const [editingLifeMemoryContent, setEditingLifeMemoryContent] = useState('')
  const [refreshingLifeProfile, setRefreshingLifeProfile] = useState(false)
  const [geoInfo, setGeoInfo] = useState<GeoContext | null>(null)
  const [geoLoading, setGeoLoading] = useState(false)
  const [manualLat, setManualLat] = useState('')
  const [manualLon, setManualLon] = useState('')
  const [manualCity, setManualCity] = useState('')
  const [manualRegion, setManualRegion] = useState('')
  const [unlocked, setUnlocked] = useState<UnlockedAchievement[]>([])
  const [diaryEntries, setDiaryEntries] = useState<DiaryEntry[]>([])
  const [newReminderLabel, setNewReminderLabel] = useState('')
  const [newReminderTime, setNewReminderTime] = useState('09:00')
  const [chatHistory, setChatHistory] = useState<PetChatHistoryItem[]>([])

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(''), 2500)
  }

  useEffect(() => {
    const load = async () => {
      try {
        const saved = await window.mulby.storage.get('pet-personality')
        if (saved) setPersonality(normalizePersonality(saved, DEFAULT_PERSONALITY))
      } catch (err) {
        console.error('Load personality failed:', err)
      }

      try {
        const allModels = await window.mulby.ai.allModels()
        const textModels = allModels.filter((m: any) =>
          !m.id.includes('image') && !m.id.includes('embed') && !m.id.includes('rerank')
        )
        setModels(textModels.map((m: any) => ({ id: m.id, label: m.label || m.id })))
        if (!personality.model && textModels.length > 0) {
          setPersonality(p => ({ ...p, model: textModels[0].id }))
        }
      } catch (err) {
        console.error('Load AI models failed:', err)
      }

      try {
        const savedStats = await window.mulby.storage.get('pet-stats')
        if (savedStats && typeof savedStats === 'object') setStats(savedStats as PetStats)
      } catch (err) {
        console.error('Load stats failed:', err)
      }

      try {
        const savedProfile = await window.mulby.storage.get(PET_LIFE_PROFILE_STORAGE_KEY)
        setLifeProfile(normalizeLifeProfile(savedProfile))
      } catch (err) {
        console.error('Load life profile failed:', err)
      }

      try {
        const savedGeo = await window.mulby.storage.get('pet-geo')
        if (savedGeo && typeof savedGeo === 'object') {
          const g = savedGeo as GeoContext
          if (Number.isFinite(g.latitude) && Number.isFinite(g.longitude)) {
            setGeoInfo(g)
            setManualLat(String(g.latitude))
            setManualLon(String(g.longitude))
            setManualCity(g.city ?? '')
            setManualRegion(g.region ?? '')
          }
        }
      } catch (err) {
        console.error('Load geo failed:', err)
      }

      try {
        const savedAchs = await window.mulby.storage.get('pet-achievements')
        if (Array.isArray(savedAchs)) {
          setUnlocked(savedAchs.filter(a => a && typeof a === 'object' && typeof (a as any).id === 'string') as UnlockedAchievement[])
        }
      } catch (err) {
        console.error('Load achievements failed:', err)
      }

      try {
        const savedDiary = await window.mulby.storage.get('pet-diary')
        if (Array.isArray(savedDiary)) {
          setDiaryEntries(savedDiary.filter(d => d && typeof d === 'object' && typeof (d as any).date === 'string') as DiaryEntry[])
        }
      } catch (err) {
        console.error('Load diary failed:', err)
      }
    }
    load()
  }, [])

  const loadChatHistory = useCallback(async () => {
    try {
      const raw = await window.mulby.storage.get(PET_CHAT_HISTORY_STORAGE_KEY)
      if (!Array.isArray(raw)) {
        setChatHistory([])
        return
      }
      const items: PetChatHistoryItem[] = []
      for (const x of raw) {
        if (!x || typeof x !== 'object') continue
        const o = x as Record<string, unknown>
        if (o.role !== 'user' && o.role !== 'assistant') continue
        if (typeof o.content !== 'string') continue
        const item: PetChatHistoryItem = { role: o.role, content: o.content }
        if (o.role === 'assistant' && typeof o.reasoning === 'string' && o.reasoning.trim()) {
          item.reasoning = o.reasoning.trim()
        }
        if (typeof o.at === 'number' && Number.isFinite(o.at) && o.at > 0) item.at = o.at
        items.push(item)
      }
      setChatHistory(items)
    } catch (err) {
      console.error('Load chat history failed:', err)
      setChatHistory([])
    }
  }, [])

  useEffect(() => {
    if (tab === 'dialogue') void loadChatHistory()
  }, [tab, loadChatHistory])

  useEffect(() => {
    const notifyClosed = () => {
      try {
        window.mulby.window.sendToParent('settings-closed')
      } catch {}
    }
    window.addEventListener('beforeunload', notifyClosed)
    window.addEventListener('pagehide', notifyClosed)
    return () => {
      notifyClosed()
      window.removeEventListener('beforeunload', notifyClosed)
      window.removeEventListener('pagehide', notifyClosed)
    }
  }, [])

  const handleFetchGeo = async () => {
    setGeoLoading(true)
    try {
      const status = await window.mulby.geolocation.getAccessStatus()

      if (status === 'denied' || status === 'restricted') {
        await window.mulby.geolocation.openSettings()
        showToast('请在系统设置中开启定位权限')
        setGeoLoading(false)
        return
      }

      if (status === 'not-determined' || status === 'unknown') {
        const nextStatus = await window.mulby.geolocation.requestAccess()
        if (nextStatus === 'denied' || nextStatus === 'restricted') {
          await window.mulby.geolocation.openSettings()
          showToast('请在系统设置中开启定位权限')
          setGeoLoading(false)
          return
        }
      }

      let pos: { latitude: number; longitude: number } | null = null
      try {
        pos = await window.mulby.geolocation.getCurrentPosition()
      } catch (e) {
        console.error('getCurrentPosition failed:', e)
      }
      if (!pos) {
        showToast('无法获取位置')
        setGeoLoading(false)
        return
      }

      const geo: GeoContext = { latitude: pos.latitude, longitude: pos.longitude }

      try {
        const resp = await window.mulby.http.get(
          `https://nominatim.openstreetmap.org/reverse?format=json&lat=${pos.latitude}&lon=${pos.longitude}&zoom=10&accept-language=zh`,
          { 'User-Agent': 'MulbyDesktopPet/1.0' }
        )
        if (resp.status === 200) {
          try {
            const data = JSON.parse(resp.data)
            geo.city = data.address?.city || data.address?.town || data.address?.county || ''
            geo.region = data.address?.state || data.address?.province || ''
          } catch (parseErr) {
            console.warn('Reverse geocoding parse failed:', parseErr)
          }
        }
      } catch (err) {
        console.warn('Reverse geocoding failed:', err)
      }

      await window.mulby.storage.set('pet-geo', geo)
      setGeoInfo(geo)
      setManualLat(String(geo.latitude))
      setManualLon(String(geo.longitude))
      setManualCity(geo.city ?? '')
      setManualRegion(geo.region ?? '')
      window.mulby.window.sendToParent('geo-updated', geo)
      showToast(geo.city ? `已定位到 ${geo.city}` : '定位已保存')
    } catch (e) {
      console.error('Geo error:', e)
      showToast('获取定位失败')
    }
    setGeoLoading(false)
  }

  const handleClearGeo = async () => {
    await window.mulby.storage.set('pet-geo', null)
    setGeoInfo(null)
    setManualLat('')
    setManualLon('')
    setManualCity('')
    setManualRegion('')
    window.mulby.window.sendToParent('geo-updated', null)
    showToast('定位已清除')
  }

  const handleSaveManualGeo = async () => {
    const norm = (s: string) => s.trim().replace(/，/g, '.').replace(',', '.')
    const lat = parseFloat(norm(manualLat))
    const lon = parseFloat(norm(manualLon))
    if (Number.isNaN(lat) || Number.isNaN(lon)) {
      showToast('请输入有效的纬度、经度（数字）')
      return
    }
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      showToast('纬度需在 -90～90，经度需在 -180～180')
      return
    }
    const geo: GeoContext = {
      latitude: lat,
      longitude: lon,
      city: manualCity.trim() || undefined,
      region: manualRegion.trim() || undefined,
    }
    try {
      await window.mulby.storage.set('pet-geo', geo)
      setGeoInfo(geo)
      window.mulby.window.sendToParent('geo-updated', geo)
      showToast('位置已保存')
    } catch (e) {
      console.error('Save manual geo failed:', e)
      showToast('保存失败')
    }
  }

  const handleSave = async () => {
    try {
      await window.mulby.storage.set('pet-personality', personality)
      showToast('设置已保存')
      window.mulby.window.sendToParent('settings-updated', { personality })
    } catch (err) {
      console.error('Save error:', err)
    }
  }

  const loadLifeProfile = async (showSuccess = false) => {
    try {
      const savedProfile = await window.mulby.storage.get(PET_LIFE_PROFILE_STORAGE_KEY)
      setLifeProfile(normalizeLifeProfile(savedProfile))
      if (showSuccess) showToast('已刷新')
    } catch (err) {
      console.error('Refresh life profile failed:', err)
      showToast('刷新失败')
    }
  }

  const persistLifeProfile = async (next: PetLifeProfile, message: string) => {
    const normalized = normalizeLifeProfile(next)
    await window.mulby.storage.set(PET_LIFE_PROFILE_STORAGE_KEY, normalized)
    setLifeProfile(normalized)
    window.mulby.window.sendToParent('life-profile-updated')
    showToast(message)
  }

  const startEditLifeMemory = (item: LifeProfileItem) => {
    setEditingLifeMemoryId(item.id)
    setEditingLifeMemoryContent(item.content)
  }

  const cancelEditLifeMemory = () => {
    setEditingLifeMemoryId(null)
    setEditingLifeMemoryContent('')
  }

  const handleSaveLifeMemory = async (id: string) => {
    const result = updateLifeProfileItemContent(lifeProfile, id, editingLifeMemoryContent)
    if (!result.ok) {
      showToast(result.reason === 'unsafe' ? '这条内容不适合保存为记忆' : '请输入记忆内容')
      return
    }
    await persistLifeProfile(result.profile, '已保存')
    cancelEditLifeMemory()
  }

  const handleDeleteLifeMemory = async (id: string) => {
    const next = removeLifeProfileItem(lifeProfile, id)
    await persistLifeProfile(next, '已删除')
    if (editingLifeMemoryId === id) cancelEditLifeMemory()
  }

  const handleClearLifeProfile = async () => {
    if (!window.confirm('确定清空全部生活档案吗？此操作不可恢复。')) return
    const empty = createEmptyLifeProfile()
    await window.mulby.storage.set(PET_LIFE_PROFILE_STORAGE_KEY, empty)
    setLifeProfile(empty)
    cancelEditLifeMemory()
    window.mulby.window.sendToParent('settings-clear-life-profile')
    showToast('生活档案已清空')
  }

  const addReminder = () => {
    if (!newReminderLabel.trim()) return
    const [h, m] = newReminderTime.split(':').map(Number)
    const reminder: PetReminder = {
      id: generateReminderId(),
      label: newReminderLabel.trim(),
      hour: h,
      minute: m,
      enabled: true,
    }
    setPersonality(p => ({ ...p, reminders: [...(p.reminders || []), reminder] }))
    setNewReminderLabel('')
    setNewReminderTime('09:00')
  }

  const removeReminder = (id: string) => {
    setPersonality(p => ({ ...p, reminders: (p.reminders || []).filter(r => r.id !== id) }))
  }

  const toggleReminder = (id: string) => {
    setPersonality(p => ({
      ...p,
      reminders: (p.reminders || []).map(r => r.id === id ? { ...r, enabled: !r.enabled } : r),
    }))
  }

  const formatLifeMemoryMeta = (item: LifeProfileItem) => {
    const source = item.source === 'manual' ? '手动' : '自动'
    const date = new Date(item.updatedAt).toLocaleDateString()
    return `${source} · 可信度 ${item.confidence}/5 · ${date}`
  }

  const renderLifeProfileItem = (item: LifeProfileItem) => {
    const isEditing = editingLifeMemoryId === item.id
    return (
      <div key={item.id} className="memory-item">
        <div className="memory-item-top">
          <span className="memory-type">{LIFE_PROFILE_CATEGORY_LABELS[item.category]}</span>
          <span className="memory-date">{formatLifeMemoryMeta(item)}</span>
        </div>
        {isEditing ? (
          <textarea
            className="memory-edit-input"
            value={editingLifeMemoryContent}
            onChange={e => setEditingLifeMemoryContent(e.target.value)}
            maxLength={120}
            rows={3}
            autoFocus
          />
        ) : (
          <div className="memory-content">{item.content}</div>
        )}
        <div className="memory-actions">
          {isEditing ? (
            <>
              <button className="mem-action-btn save" onClick={() => void handleSaveLifeMemory(item.id)}>
                <Icon d={ICONS.check} size={12} /> 保存
              </button>
              <button className="mem-action-btn" onClick={cancelEditLifeMemory}>
                <Icon d={ICONS.x} size={12} /> 取消
              </button>
            </>
          ) : (
            <>
              <button className="mem-action-btn" onClick={() => startEditLifeMemory(item)}>
                <Icon d={ICONS.edit} size={12} /> 编辑
              </button>
              <button className="mem-action-btn delete" onClick={() => void handleDeleteLifeMemory(item.id)}>
                <Icon d={ICONS.trash} size={12} /> 删除
              </button>
            </>
          )}
        </div>
      </div>
    )
  }

  const renderLifeProfileCategory = (category: LifeProfileCategory) => {
    const items = lifeProfile[category]
    return (
      <section key={category} className="memory-category">
        <div className="memory-category-header">
          <span>{LIFE_PROFILE_CATEGORY_LABELS[category]}</span>
          <span>{items.length}</span>
        </div>
        {items.length === 0 ? (
          <div className="memory-category-empty">暂无内容</div>
        ) : (
          <div className="memory-list">
            {items.map(renderLifeProfileItem)}
          </div>
        )}
      </section>
    )
  }

  const handleManualRefreshLifeProfile = async () => {
    if (refreshingLifeProfile) return
    if (!personality.model) {
      showToast('请先在「性格」页选择文本模型')
      return
    }
    setRefreshingLifeProfile(true)
    try {
      window.mulby.window.sendToParent('settings-refresh-life-profile')
      showToast('已请求更新生活档案，请稍后刷新查看')
      setTimeout(() => void loadLifeProfile(), 6000)
    } finally {
      setTimeout(() => setRefreshingLifeProfile(false), 6000)
    }
  }

  const renderMemory = () => {
    const total = countLifeProfileItems(lifeProfile)
    return (
      <div className="panel-content">
        <div className="memory-header">
          <span className="memory-count">生活档案 · 共 {total} 条</span>
        </div>
        <div className="memory-toolbar">
          <button type="button" className="gen-btn" onClick={() => void handleManualRefreshLifeProfile()} disabled={refreshingLifeProfile}>
            <Icon d={ICONS.plus} size={12} /> {refreshingLifeProfile ? '更新中...' : '更新记忆'}
          </button>
          <button type="button" className="gen-btn" onClick={() => void loadLifeProfile(true)}>
            <Icon d={ICONS.refresh} size={12} /> 刷新
          </button>
          <button type="button" className="mem-action-btn delete" onClick={() => void handleClearLifeProfile()}>
            <Icon d={ICONS.trash} size={12} /> 清空档案
          </button>
        </div>
        <p className="memory-description">
          宠物会在多轮对话后节流更新生活档案，记录稳定事实、偏好、习惯、关系线索和少量近期事件。你可以在这里修正或删除任何内容。
        </p>
        {total === 0 && <div className="memory-empty">宠物还没有形成生活档案，多聊几次吧</div>}
        <div className="memory-categories">
          {LIFE_PROFILE_CATEGORIES.map(renderLifeProfileCategory)}
        </div>
      </div>
    )
  }

  const renderStats = () => {
    if (!stats) return <div className="panel-content"><p style={{ opacity: 0.6 }}>暂无数据</p></div>
    const days = Math.floor((Date.now() - stats.createdAt) / 86_400_000)
    const moodScore = stats.moodScore ?? 0
    const moodPercent = Math.round((moodScore + 100) / 2)
    const moodName = MOOD_LABELS[(stats.mood as PetMood) ?? 'neutral'] || '平静'

    return (
      <div className="panel-content">
        <div className="mood-bar">
          <div className="mood-label">
            <StatsIcon icon="smile">心情</StatsIcon>
            <span>{moodName}</span>
          </div>
          <div className="mood-track">
            <div className="mood-fill" style={{ width: `${moodPercent}%` }} />
          </div>
        </div>

        <div className="geo-card">
          <div className="geo-header">
            <StatsIcon icon="mapPin">位置信息</StatsIcon>
          </div>
          {geoInfo ? (
            <div className="geo-summary-line">
              <span className="geo-text">
                {geoInfo.region && geoInfo.city
                  ? `${geoInfo.region} · ${geoInfo.city}`
                  : geoInfo.city || `${geoInfo.latitude.toFixed(4)}, ${geoInfo.longitude.toFixed(4)}`}
              </span>
            </div>
          ) : (
            <p className="field-hint geo-intro-hint">未设置。可填写下方坐标与城市后点「保存位置」，或使用 GPS 自动获取。</p>
          )}

          <div className="geo-manual-grid">
            <div className="field geo-field-tight">
              <label className="field-label">纬度</label>
              <input
                className="field-input"
                inputMode="decimal"
                value={manualLat}
                onChange={e => setManualLat(e.target.value)}
                placeholder="如 39.9042"
              />
            </div>
            <div className="field geo-field-tight">
              <label className="field-label">经度</label>
              <input
                className="field-input"
                inputMode="decimal"
                value={manualLon}
                onChange={e => setManualLon(e.target.value)}
                placeholder="如 116.4074"
              />
            </div>
          </div>
          <div className="field geo-field-tight">
            <label className="field-label">城市</label>
            <input
              className="field-input"
              value={manualCity}
              onChange={e => setManualCity(e.target.value)}
              placeholder="如 北京"
              maxLength={40}
            />
          </div>
          <div className="field geo-field-tight">
            <label className="field-label">省份 / 地区（选填）</label>
            <input
              className="field-input"
              value={manualRegion}
              onChange={e => setManualRegion(e.target.value)}
              placeholder="如 北京市"
              maxLength={40}
            />
          </div>

          <div className="geo-footer-actions">
            <button type="button" className="gen-btn full-width" onClick={handleSaveManualGeo}>
              保存位置
            </button>
            <div className="geo-actions geo-actions-row">
              <button type="button" className="gen-btn" onClick={handleFetchGeo} disabled={geoLoading}>
                <Icon d={ICONS.refresh} size={12} /> {geoLoading ? '获取中...' : (geoInfo ? 'GPS 定位' : '获取当前位置')}
              </button>
              {geoInfo && (
                <button type="button" className="mem-action-btn delete" onClick={handleClearGeo}>
                  <Icon d={ICONS.trash} size={12} /> 清除
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="stats-card">
          <div className="stats-row"><StatsIcon icon="heart">亲密度</StatsIcon><span className="stats-value">{stats.intimacy}/100</span></div>
          <div className="stats-row"><StatsIcon icon="calendar">连续签到</StatsIcon><span className="stats-value">{stats.streakDays} 天</span></div>
          <div className="stats-row"><StatsIcon icon="target">今日番茄</StatsIcon><span className="stats-value">{stats.pomodoroToday} 个</span></div>
          <div className="stats-row"><StatsIcon icon="target">累计番茄</StatsIcon><span className="stats-value">{stats.pomodoroTotal} 个</span></div>
          <div className="stats-row"><StatsIcon icon="clock">专注时长</StatsIcon><span className="stats-value">{stats.totalFocusMinutes} 分钟</span></div>
          <div className="stats-row"><StatsIcon icon="hand">累计互动</StatsIcon><span className="stats-value">{stats.totalInteractions} 次</span></div>
          <div className="stats-row"><StatsIcon icon="gift">相伴天数</StatsIcon><span className="stats-value">{days} 天</span></div>
        </div>
      </div>
    )
  }

  const renderAchievements = () => {
    const unlockedIds = new Set(unlocked.map(u => u.id))
    const unlockedMap = new Map(unlocked.map(u => [u.id, u]))

    return (
      <div className="panel-content">
        <div className="achievement-summary">
          <StatsIcon icon="star">成就</StatsIcon>
          <span>{unlocked.length} / {ALL_ACHIEVEMENTS.length}</span>
        </div>
        <div className="achievement-grid">
          {ALL_ACHIEVEMENTS.map(ach => {
            const isUnlocked = unlockedIds.has(ach.id)
            const info = unlockedMap.get(ach.id)
            return (
              <div key={ach.id} className={`achievement-item ${isUnlocked ? 'unlocked' : 'locked'}`}>
                <div className="achievement-icon-wrap">
                  <Icon d={ach.icon} size={20} color={isUnlocked ? 'var(--accent)' : '#ccc'} />
                </div>
                <div className="achievement-info">
                  <span className="achievement-title">{ach.title}</span>
                  <span className="achievement-desc">{ach.desc}</span>
                  {isUnlocked && info && (
                    <span className="achievement-date">{new Date(info.unlockedAt).toLocaleDateString()}</span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  const handleClearChatHistory = async () => {
    if (!window.confirm('确定清空全部对话历史吗？此操作不可恢复。')) return
    try {
      await window.mulby.storage.set(PET_CHAT_HISTORY_STORAGE_KEY, [])
      setChatHistory([])
      window.mulby.window.sendToParent('chat-history-updated')
      showToast('对话历史已清空')
    } catch (e) {
      console.error(e)
      showToast('清空失败')
    }
  }

  const renderDialogue = () => {
    const turns = groupChatTurns(chatHistory)
    return (
      <div className="panel-content dialogue-panel">
        <p className="dialogue-intro">
          展示宠物与模型的对话上下文：包括你输入的内容、自动触发时的说明（如闲置、点击等），以及宠物的回复；每轮带日期与时间（新产生的对话才会记录时间）。若模型支持推理，会显示灰色「思考」片段。
        </p>
        <div className="dialogue-toolbar">
          <button type="button" className="gen-btn" onClick={() => void loadChatHistory()}>
            <Icon d={ICONS.refresh} size={12} /> 刷新
          </button>
          <button type="button" className="mem-action-btn delete" onClick={() => void handleClearChatHistory()}>
            <Icon d={ICONS.trash} size={12} /> 清空历史
          </button>
        </div>
        {turns.length === 0 ? (
          <div className="memory-empty">暂无对话记录。与宠物聊天或等待自动搭话后，这里会出现历史。</div>
        ) : (
          <div className="dialogue-list">
            {turns.map((t, idx) => (
              <div key={turns.length - idx} className="dialogue-turn">
                <div className="dialogue-turn-meta">
                  {t.at != null ? (
                    <time className="dialogue-time" dateTime={new Date(t.at).toISOString()}>
                      {formatDialogueDateTime(t.at)}
                    </time>
                  ) : (
                    <span className="dialogue-time dialogue-time-unknown">（无时间记录）</span>
                  )}
                </div>
                <div className="dialogue-block dialogue-user">
                  <span className="dialogue-label">用户 / 上下文</span>
                  <div className="dialogue-text">{t.user}</div>
                </div>
                {t.reasoning && (
                  <div className="dialogue-block dialogue-reasoning">
                    <span className="dialogue-label">思考</span>
                    <div className="dialogue-text dialogue-reasoning-body">{t.reasoning}</div>
                  </div>
                )}
                <div className="dialogue-block dialogue-assistant">
                  <span className="dialogue-label">宠物发言</span>
                  <div className="dialogue-text">{t.assistant}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  const triggerPetIntent = useCallback((intent: PresentationIntent) => {
    try {
      window.mulby.window.sendToParent('settings-trigger-action', { intent })
      showToast(`已触发：${intent.face}${intent.pose ? '/' + intent.pose : ''}${intent.animation ? '/' + intent.animation : ''}`)
    } catch (err) {
      console.error('Trigger intent failed:', err)
    }
  }, [])

  const renderPlayground = () => {
    return (
      <div className="panel-content">
        <p className="field-hint" style={{ marginBottom: 12 }}>
          以下为 `pet-standard` / `presentation` 里定义的表情、姿势、情绪与动作指令；点击会通过主窗口实时套用，与 AI 工具调用的表现一致。
        </p>

        <div className="field">
          <label className="field-label">表情</label>
          <div className="freq-row" style={{ flexWrap: 'wrap' }}>
            {ALL_EXPRESSIONS.map((expr: PetExpression) => (
              <button
                key={`expr-${expr}`}
                className="freq-btn playground-token"
                onClick={() => triggerPetIntent({ face: expr, durationMs: 4000 })}
                title={`${EXPRESSION_LABELS[expr]} / ${expr}`}
              >
                <span className="playground-token-main">{EXPRESSION_LABELS[expr]}</span>
                <span className="playground-token-sub">{expr}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <label className="field-label">姿势</label>
          <div className="freq-row" style={{ flexWrap: 'wrap' }}>
            {ALL_POSES.map((pose: PetPose) => (
              <button
                key={`pose-${pose}`}
                className="freq-btn playground-token"
                onClick={() => triggerPetIntent({
                  face: PLAYGROUND_POSE_FACE[pose],
                  pose,
                  durationMs: pose === 'sleep' ? 5000 : 4000,
                })}
                title={`${POSE_LABELS[pose]} / ${pose}`}
              >
                <span className="playground-token-main">{POSE_LABELS[pose]}</span>
                <span className="playground-token-sub">{pose}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <label className="field-label">情绪 / 心情</label>
          <div className="freq-row" style={{ flexWrap: 'wrap' }}>
            {EMOTION_LIST.map(emotion => (
              <button
                key={`emo-${emotion}`}
                className="freq-btn"
                onClick={() => triggerPetIntent({ face: 'happy', emotion, durationMs: 4000 })}
              >{emotion}</button>
            ))}
          </div>
        </div>

        <div className="field">
          <label className="field-label">动作 / 动画组合</label>
          <div className="freq-row" style={{ flexWrap: 'wrap' }}>
            {ACTION_LIST.map(action => (
              <button
                key={`act-${action}`}
                className="freq-btn"
                onClick={() => {
                  const durationMs = action.startsWith('move_') || action === 'chase' || action === 'wander' || action === 'walk'
                    ? 1800
                    : action === 'sleep'
                      ? 5000
                      : 3500
                  const intent = presentationIntentForAction(action, { durationMs })
                  triggerPetIntent(intent)
                }}
              >{action}</button>
            ))}
          </div>
        </div>
      </div>
    )
  }

  const renderDiary = () => {
    const sorted = [...diaryEntries].sort((a, b) => b.createdAt - a.createdAt)
    const moodEmoji: Record<string, string> = {
      ecstatic: '(^o^)', happy: '(^_^)', content: '(•‿•)', neutral: '(-_-)',
      bored: '(-.-)zzZ', lonely: '(T_T)', sad: '(;_;)', grumpy: '(>_<)', sleepy: '(-.-)zzZ',
    }

    return (
      <div className="panel-content">
        {sorted.length === 0 ? (
          <div className="memory-empty">还没有日记呢，晚上9点后会自动生成哦</div>
        ) : sorted.map(entry => (
          <div key={entry.date} className="diary-entry">
            <div className="diary-header">
              <span className="diary-date">{entry.date}</span>
              <span className="diary-mood">{moodEmoji[entry.mood] || ''}</span>
            </div>
            <div className="diary-content">{entry.content}</div>
            {entry.highlights.length > 0 && (
              <div className="diary-highlights">
                {entry.highlights.map((h, i) => (
                  <span key={i} className="diary-highlight-tag">{h}</span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    )
  }

  const reminders = personality.reminders || []

  return (
    <div className="settings-root">
      <div className="settings-header">
        <div className="tab-bar">
          <button className={`tab ${tab === 'personality' ? 'active' : ''}`} onClick={() => setTab('personality')}>设置</button>
          <button className={`tab ${tab === 'stats' ? 'active' : ''}`} onClick={() => setTab('stats')}>状态</button>
          <button className={`tab ${tab === 'memory' ? 'active' : ''}`} onClick={() => setTab('memory')}>记忆</button>
          <button className={`tab ${tab === 'achievements' ? 'active' : ''}`} onClick={() => setTab('achievements')}>成就</button>
          <button className={`tab ${tab === 'diary' ? 'active' : ''}`} onClick={() => setTab('diary')}>日记</button>
          <button className={`tab ${tab === 'dialogue' ? 'active' : ''}`} onClick={() => setTab('dialogue')}>对话</button>
          <button className={`tab ${tab === 'playground' ? 'active' : ''}`} onClick={() => setTab('playground')}>表现预览</button>
        </div>
      </div>

      <div className="settings-body">
        {tab === 'stats' && renderStats()}
        {tab === 'memory' && renderMemory()}
        {tab === 'achievements' && renderAchievements()}
        {tab === 'diary' && renderDiary()}
        {tab === 'dialogue' && renderDialogue()}
        {tab === 'playground' && renderPlayground()}
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
            <label className="field-label">
              <Icon d={ICONS.target} size={14} color="var(--accent)" /> 番茄钟时长
            </label>
            <div className="freq-row">
              {POMODORO_OPTIONS.map(o => (
                <button
                  key={o.value}
                  className={`freq-btn ${(personality.pomodoroMinutes || 25) === o.value ? 'active' : ''}`}
                  onClick={() => setPersonality(p => ({ ...p, pomodoroMinutes: o.value }))}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <label className="field-label">
              <Icon d={ICONS.cake} size={14} color="var(--accent)" /> 你的生日
            </label>
            <input
              type="date"
              className="field-input"
              value={personality.birthday || ''}
              onChange={e => setPersonality(p => ({ ...p, birthday: e.target.value }))}
            />
          </div>

          <div className="field">
            <label className="field-label">
              <Icon d={ICONS.bell} size={14} color="var(--accent)" /> 定时提醒
            </label>
            <div className="reminder-list">
              {reminders.map(r => (
                <div key={r.id} className="reminder-item">
                  <label className="trigger-item" style={{ flex: 1 }}>
                    <input
                      type="checkbox"
                      checked={r.enabled}
                      onChange={() => toggleReminder(r.id)}
                    />
                    <span>{r.label}</span>
                  </label>
                  <span className="reminder-time">{String(r.hour).padStart(2, '0')}:{String(r.minute).padStart(2, '0')}</span>
                  <button className="mem-action-btn delete" onClick={() => removeReminder(r.id)} style={{ marginLeft: 4 }}>
                    <Icon d={ICONS.trash} size={12} />
                  </button>
                </div>
              ))}
              <div className="reminder-add">
                <input
                  className="field-input"
                  value={newReminderLabel}
                  onChange={e => setNewReminderLabel(e.target.value)}
                  placeholder="提醒内容"
                  style={{ flex: 1 }}
                  maxLength={20}
                />
                <input
                  type="time"
                  className="field-input"
                  value={newReminderTime}
                  onChange={e => setNewReminderTime(e.target.value)}
                  style={{ width: 85 }}
                />
                <button className="gen-btn" onClick={addReminder} disabled={!newReminderLabel.trim()}>
                  <Icon d={ICONS.plus} size={12} />
                </button>
              </div>
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
                ['clipboard', '剪贴板内容响应'],
                ['mousePattern', '鼠标行为响应'],
              ] as const).map(([key, label]) => (
                <label key={key} className="trigger-item">
                  <input
                    type="checkbox"
                    checked={personality.triggers[key] ?? true}
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

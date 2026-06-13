import { useState, useEffect, useCallback, useRef, type ChangeEvent, type ReactNode } from 'react'
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
import {
  ALL_EXPRESSIONS,
  ALL_POSES,
  DEFAULT_PET_OPACITY,
  MAX_PET_OPACITY,
  MIN_PET_OPACITY,
  PET_APPEARANCE_HISTORY_LIMIT,
  PET_APPEARANCE_HISTORY_STORAGE_KEY,
  PET_OPACITY_STORAGE_KEY,
  clampPetOpacity,
  compactSpriteSet,
  expandSpriteSet,
  type CompactPetSpriteSet,
  type PetExpression,
  type PetPose,
  type PetSpriteKey,
  type PetSpriteSet,
} from '../engine/pet-standard'
import {
  buildPetImageEditPrompt,
  buildPetImagePrompt,
  decodeImageToRawImage,
  filterChatModels,
  filterImageGenModels,
  generatePetSpriteSet,
  parseImageDataUrl,
  readFileAsDataUrl,
  suggestSpriteMeta,
  toImageDataUrl,
} from '../engine/appearance-workshop'
import { normalizePersonality } from '../engine/message-validator'
import type { PetStats, PetMood } from '../engine/pet-stats'
import {
  DEFAULT_ECOSYSTEM_SETTINGS,
  NEED_LABELS,
  PET_ECOSYSTEM_SETTINGS_STORAGE_KEY,
  PET_GAME_STATS_STORAGE_KEY,
  PET_NEEDS_STORAGE_KEY,
  PET_QUESTS_STORAGE_KEY,
  PET_TIMELINE_STORAGE_KEY,
  WORK_MODE_LABELS,
  normalizeEcosystemSettings,
  normalizeGameStats,
  normalizeNeeds,
  normalizeQuestState,
  normalizeTimeline,
  todayStr,
  type PetEcosystemSettings,
  type PetGameStats,
  type PetNeedsSnapshot,
  type PetQuestState,
  type PetTimelineEvent,
  type WorkMode,
} from '../engine/pet-ecosystem'
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

function readSettingsWindowId(): number | null {
  const value = new URLSearchParams(window.location.search).get('settingsWindowId')
  if (!value) return null
  const id = Number(value)
  return Number.isFinite(id) && id > 0 ? id : null
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

/** 校验并裁剪从存储读到的 AI 形象历史:用 expandSpriteSet 兜底过滤损坏/伪造项,并应用条数上限 */
function normalizeAppearanceHistory(raw: unknown): CompactPetSpriteSet[] {
  if (!Array.isArray(raw)) return []
  const out: CompactPetSpriteSet[] = []
  for (const item of raw) {
    if (expandSpriteSet(item)) out.push(item as CompactPetSpriteSet)
  }
  return out.slice(0, PET_APPEARANCE_HISTORY_LIMIT)
}

export default function SettingsView() {
  const settingsWindowIdRef = useRef(readSettingsWindowId())
  const closedNotifiedRef = useRef(false)
  const [personality, setPersonality] = useState<PetPersonality>(DEFAULT_PERSONALITY)
  const [models, setModels] = useState<Array<{ id: string; label: string }>>([])
  const [toast, setToast] = useState('')
  const [tab, setTab] = useState<'personality' | 'appearance' | 'ecosystem' | 'reminders' | 'memory' | 'achievements' | 'diary' | 'dialogue' | 'playground'>('personality')
  const [stats, setStats] = useState<PetStats | null>(null)
  const [needs, setNeeds] = useState<PetNeedsSnapshot>(() => normalizeNeeds(null))
  const [quests, setQuests] = useState<PetQuestState>(() => normalizeQuestState(null))
  const [gameStats, setGameStats] = useState<PetGameStats>(() => normalizeGameStats(null))
  const [timeline, setTimeline] = useState<PetTimelineEvent[]>([])
  const [ecosystemSettings, setEcosystemSettings] = useState<PetEcosystemSettings>({ ...DEFAULT_ECOSYSTEM_SETTINGS })
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
  const [imageModels, setImageModels] = useState<Array<{ id: string; label: string }>>([])
  const [appearanceModel, setAppearanceModel] = useState('')
  const [petDescription, setPetDescription] = useState('')
  const [appearanceBusy, setAppearanceBusy] = useState(false)
  const [appearanceStatus, setAppearanceStatus] = useState('')
  const [appearanceError, setAppearanceError] = useState('')
  const [rawPetImage, setRawPetImage] = useState('')
  const [uploadedImage, setUploadedImage] = useState('')
  const [pendingSpriteSet, setPendingSpriteSet] = useState<PetSpriteSet | null>(null)
  const [appearanceOpacity, setAppearanceOpacity] = useState(DEFAULT_PET_OPACITY)
  const [appearanceHistory, setAppearanceHistory] = useState<CompactPetSpriteSet[]>([])
  const appearanceAbortRef = useRef<(() => void) | null>(null)
  // 单调递增的「本次生成」令牌:取消或卸载时 +1,所有写入预览/状态的副作用以此判定是否已失效
  const appearanceRunIdRef = useRef(0)
  const appearanceFileInputRef = useRef<HTMLInputElement | null>(null)

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(''), 2500)
  }

  const loadEcosystem = useCallback(async (showSuccess = false, includeSettings = false) => {
    try {
      const [rawNeeds, rawQuests, rawGameStats, rawTimeline, rawSettings] = await Promise.all([
        window.mulby.storage.get(PET_NEEDS_STORAGE_KEY),
        window.mulby.storage.get(PET_QUESTS_STORAGE_KEY),
        window.mulby.storage.get(PET_GAME_STATS_STORAGE_KEY),
        window.mulby.storage.get(PET_TIMELINE_STORAGE_KEY),
        includeSettings ? window.mulby.storage.get(PET_ECOSYSTEM_SETTINGS_STORAGE_KEY) : Promise.resolve(undefined),
      ])
      setNeeds(normalizeNeeds(rawNeeds))
      setQuests(normalizeQuestState(rawQuests))
      setGameStats(normalizeGameStats(rawGameStats))
      setTimeline(normalizeTimeline(rawTimeline))
      if (includeSettings) setEcosystemSettings(normalizeEcosystemSettings(rawSettings))
      if (showSuccess) showToast('生态状态已刷新')
    } catch (err) {
      console.error('Load ecosystem failed:', err)
      if (showSuccess) showToast('刷新失败')
    }
  }, [])

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
        const textModels = filterChatModels(allModels as any)
        setModels(textModels.map((m: any) => ({ id: m.id, label: m.label || m.id })))
        if (textModels.length > 0) {
          // 用函数式更新读取最新 personality.model,避免 effect 闭包旧值覆盖已保存的模型
          setPersonality(p => (p.model ? p : { ...p, model: String(textModels[0].id) }))
        }
        const imgModels = filterImageGenModels(allModels as any)
        setImageModels(imgModels.map((m: any) => ({ id: m.id, label: m.label || m.id })))
        if (imgModels.length > 0 && imgModels[0].id) {
          const firstId = imgModels[0].id
          setAppearanceModel(prev => prev || firstId)
        }
      } catch (err) {
        console.error('Load AI models failed:', err)
      }

      try {
        const [savedOpacity, savedHistory] = await Promise.all([
          window.mulby.storage.get(PET_OPACITY_STORAGE_KEY),
          window.mulby.storage.get(PET_APPEARANCE_HISTORY_STORAGE_KEY),
        ])
        if (savedOpacity !== undefined && savedOpacity !== null) {
          setAppearanceOpacity(clampPetOpacity(savedOpacity))
        }
        setAppearanceHistory(normalizeAppearanceHistory(savedHistory))
      } catch (err) {
        console.error('Load appearance settings failed:', err)
      }

      try {
        const savedStats = await window.mulby.storage.get('pet-stats')
        if (savedStats && typeof savedStats === 'object') setStats(savedStats as PetStats)
      } catch (err) {
        console.error('Load stats failed:', err)
      }

      await loadEcosystem(false, true)

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
  }, [loadEcosystem])

  // 卸载时让进行中的生成任务失效并中止网络请求,避免对已卸载组件 setState
  useEffect(() => () => {
    appearanceRunIdRef.current++
    appearanceAbortRef.current?.()
    appearanceAbortRef.current = null
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
      if (closedNotifiedRef.current) return
      closedNotifiedRef.current = true
      try {
        window.mulby.window.sendToParent('settings-closed', {
          settingsWindowId: settingsWindowIdRef.current,
        })
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
      await window.mulby.storage.set(PET_ECOSYSTEM_SETTINGS_STORAGE_KEY, ecosystemSettings)
      showToast('设置已保存')
      window.mulby.window.sendToParent('settings-updated', { personality, ecosystemSettings })
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

  const renderLocationSettings = () => (
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
  )

  const renderStatsOverview = () => {
    if (!stats) {
      return <p style={{ opacity: 0.6 }}>暂无数据</p>
    }
    const days = Math.floor((Date.now() - stats.createdAt) / 86_400_000)
    const moodScore = stats.moodScore ?? 0
    const moodPercent = Math.round((moodScore + 100) / 2)
    const moodName = MOOD_LABELS[(stats.mood as PetMood) ?? 'neutral'] || '平静'

    return (
      <>
        <div className="mood-bar">
          <div className="mood-label">
            <StatsIcon icon="smile">心情</StatsIcon>
            <span>{moodName}</span>
          </div>
          <div className="mood-track">
            <div className="mood-fill" style={{ width: `${moodPercent}%` }} />
          </div>
        </div>

        <div className="stats-card compact">
          <div className="stats-row"><StatsIcon icon="heart">亲密度</StatsIcon><span className="stats-value">{stats.intimacy}/100</span></div>
          <div className="stats-row"><StatsIcon icon="calendar">连续签到</StatsIcon><span className="stats-value">{stats.streakDays} 天</span></div>
          <div className="stats-row"><StatsIcon icon="target">今日番茄</StatsIcon><span className="stats-value">{stats.pomodoroToday} 个</span></div>
          <div className="stats-row"><StatsIcon icon="target">累计番茄</StatsIcon><span className="stats-value">{stats.pomodoroTotal} 个</span></div>
          <div className="stats-row"><StatsIcon icon="clock">专注时长</StatsIcon><span className="stats-value">{stats.totalFocusMinutes} 分钟</span></div>
          <div className="stats-row"><StatsIcon icon="hand">累计互动</StatsIcon><span className="stats-value">{stats.totalInteractions} 次</span></div>
          <div className="stats-row"><StatsIcon icon="gift">相伴天数</StatsIcon><span className="stats-value">{days} 天</span></div>
        </div>
      </>
    )
  }

  const renderEcosystem = () => {
    const needKeys = Object.keys(NEED_LABELS) as Array<keyof typeof NEED_LABELS>
    const latestMode = [...timeline].reverse().find(e => e.mode)?.mode ?? 'casual'
    const todayEvents = timeline
      .filter(e => todayStr(e.at) === todayStr())
      .slice(-18)
      .reverse()
    const completedQuests = quests.quests.filter(q => q.completed).length
    const completionRate = quests.quests.length
      ? Math.round((completedQuests / quests.quests.length) * 100)
      : 0

    return (
      <div className="panel-content ecosystem-panel">
        <div className="ecosystem-summary">
          <div>
            <span className="ecosystem-kicker">当前模式</span>
            <strong>{WORK_MODE_LABELS[latestMode as WorkMode]}</strong>
          </div>
          <div>
            <span className="ecosystem-kicker">今日目标</span>
            <strong>{completedQuests}/{quests.quests.length}</strong>
          </div>
          <div>
            <span className="ecosystem-kicker">小游戏积分</span>
            <strong>{gameStats.score}</strong>
          </div>
        </div>

        <section className="ecosystem-section">
          <div className="ecosystem-section-title">基础状态</div>
          {renderStatsOverview()}
        </section>

        <section className="ecosystem-section">
          <div className="ecosystem-section-title">需求状态</div>
          <div className="needs-grid">
            {needKeys.map(key => (
              <div key={key} className="need-row">
                <div className="need-row-top">
                  <span>{NEED_LABELS[key]}</span>
                  <span>{needs[key]}/100</span>
                </div>
                <div className="need-track">
                  <div className="need-fill" style={{ width: `${needs[key]}%` }} />
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="ecosystem-section">
          <div className="ecosystem-section-title">每日任务 · {completionRate}%</div>
          <div className="quest-list">
            {quests.quests.map(q => (
              <div key={q.id} className={`quest-item ${q.completed ? 'completed' : ''}`}>
                <div>
                  <span className="quest-title">{q.title}</span>
                  <span className="quest-desc">{q.desc}</span>
                </div>
                <span className="quest-progress">{q.progress}/{q.target}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="ecosystem-section">
          <div className="ecosystem-section-title">小游戏成长</div>
          <div className="stats-card compact">
            <div className="stats-row"><StatsIcon icon="star">积分</StatsIcon><span className="stats-value">{gameStats.score}</span></div>
            <div className="stats-row"><StatsIcon icon="target">今日游玩</StatsIcon><span className="stats-value">{gameStats.playedToday} 次</span></div>
            <div className="stats-row"><StatsIcon icon="check">今日答对</StatsIcon><span className="stats-value">{gameStats.correctToday} 次</span></div>
            <div className="stats-row"><StatsIcon icon="layers">连续答对</StatsIcon><span className="stats-value">{gameStats.streak} / 最佳 {gameStats.bestStreak}</span></div>
          </div>
        </section>

        <section className="ecosystem-section">
          <div className="ecosystem-section-title">生态控制</div>
          <div className="trigger-list">
            <label className="trigger-item">
              <input
                type="checkbox"
                checked={ecosystemSettings.questsEnabled}
                onChange={e => setEcosystemSettings(s => ({ ...s, questsEnabled: e.target.checked }))}
              />
              <span>启用每日任务</span>
            </label>
          </div>
          <div className="dialogue-toolbar">
            <button type="button" className="gen-btn" onClick={() => void loadEcosystem(true)}>
              <Icon d={ICONS.refresh} size={12} /> 刷新生态状态
            </button>
          </div>
        </section>

        <section className="ecosystem-section">
          <div className="ecosystem-section-title">今日时间线</div>
          {todayEvents.length === 0 ? (
            <div className="memory-empty">今天还没有生态事件</div>
          ) : (
            <div className="timeline-list">
              {todayEvents.map(event => (
                <div key={event.id} className="timeline-item">
                  <time>{new Date(event.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })}</time>
                  <span>{event.label}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    )
  }

  const renderReminders = () => {
    const reminders = personality.reminders || []
    return (
      <div className="panel-content">
        <section className="ecosystem-section">
          <div className="ecosystem-section-title">节律提醒</div>
          <div className="trigger-list">
            <label className="trigger-item">
              <input
                type="checkbox"
                checked={ecosystemSettings.routinesEnabled}
                onChange={e => setEcosystemSettings(s => ({ ...s, routinesEnabled: e.target.checked }))}
              />
              <span>启用喝水与休息节律提醒</span>
            </label>
          </div>
          <div className="ecosystem-number-row">
            <label className="field">
              <span className="field-label">喝水间隔（分钟）</span>
              <input
                className="field-input"
                type="number"
                min={15}
                max={180}
                value={ecosystemSettings.hydrationReminderMinutes}
                onChange={e => setEcosystemSettings(s => ({ ...s, hydrationReminderMinutes: Number(e.target.value) || s.hydrationReminderMinutes }))}
              />
            </label>
            <label className="field">
              <span className="field-label">休息间隔（分钟）</span>
              <input
                className="field-input"
                type="number"
                min={20}
                max={240}
                value={ecosystemSettings.eyeRestReminderMinutes}
                onChange={e => setEcosystemSettings(s => ({ ...s, eyeRestReminderMinutes: Number(e.target.value) || s.eyeRestReminderMinutes }))}
              />
            </label>
          </div>
        </section>

        <section className="ecosystem-section">
          <div className="ecosystem-section-title">定时提醒</div>
          <div className="reminder-list">
            {reminders.length === 0 && <div className="memory-category-empty">暂无自定义提醒</div>}
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
        </section>
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

  /** 一次生成任务的取消令牌:被取消或新任务接替、或组件卸载后 cancelled 变 true */
  type AppearanceRunToken = { readonly cancelled: boolean }

  /** 共用尾段:任意来源的图片 dataURL → 像素化 → 合成 → 进入预览。每个 await 前后都判取消,失效即丢弃结果 */
  const pixelateIntoPreview = async (dataUrl: string, metaSource: string, token: AppearanceRunToken) => {
    if (token.cancelled) return
    setRawPetImage(dataUrl)
    setAppearanceStatus('正在像素化并合成表情…')
    const rgba = await decodeImageToRawImage(dataUrl)
    if (token.cancelled) return
    const { spriteSet } = generatePetSpriteSet(rgba, suggestSpriteMeta(metaSource))
    if (token.cancelled) return
    setPendingSpriteSet(spriteSet)
    addAppearanceToHistory(spriteSet)
    setAppearanceStatus('')
    showToast('形象已生成,点「应用到宠物」试穿')
  }

  /** 共用外壳:busy/error/取消语义统一处理。任务通过 token 感知取消,被取消的任务结果一律丢弃 */
  const runAppearanceTask = async (task: (token: AppearanceRunToken) => Promise<void>) => {
    if (appearanceBusy) return
    const runId = ++appearanceRunIdRef.current
    const token: AppearanceRunToken = { get cancelled() { return appearanceRunIdRef.current !== runId } }
    setAppearanceBusy(true)
    setAppearanceError('')
    setPendingSpriteSet(null)
    try {
      await task(token)
    } catch (err) {
      const aborted = err instanceof DOMException && err.name === 'AbortError'
      if (!token.cancelled && !aborted) {
        setAppearanceError(err instanceof Error ? err.message : String(err))
        setAppearanceStatus('')
      }
    } finally {
      // 仅当本次任务仍是最新一次时才复位共享状态,否则会把「已取消」覆盖回 idle 或打断后发起的新任务
      if (!token.cancelled) {
        appearanceAbortRef.current = null
        setAppearanceBusy(false)
      }
    }
  }

  const handleGenerateAppearance = () => {
    const description = petDescription.trim()
    if (!description || !appearanceModel) return
    void runAppearanceTask(async token => {
      setAppearanceStatus('正在生成立绘…')
      const prompt = buildPetImagePrompt(description)
      const ai = window.mulby.ai
      let images: string[] = []
      if (ai.images?.generateStream) {
        const handle = ai.images.generateStream(
          { model: appearanceModel, prompt, size: '1024x1024', count: 1 },
          chunk => {
            if (token.cancelled) return
            if (chunk.type === 'preview' && chunk.image) {
              setRawPetImage(toImageDataUrl(chunk.image))
              setAppearanceStatus('生成中(预览已更新)…')
            } else if (chunk.message) {
              setAppearanceStatus(chunk.message)
            }
          }
        )
        appearanceAbortRef.current = () => handle.abort()
        const res = await handle
        images = res?.images ?? []
      } else {
        const res = await ai.images.generate({ model: appearanceModel, prompt, size: '1024x1024', count: 1 })
        images = res?.images ?? []
      }
      if (token.cancelled) return
      if (images.length === 0) throw new Error('模型没有返回图片,请重试或换个模型')
      await pixelateIntoPreview(toImageDataUrl(images[0]), description, token)
    })
  }

  /** 上传图片 → ai.images.edit 重绘为宠物风格 → 像素化 */
  const handleStylizeUploadedImage = () => {
    if (!uploadedImage || !appearanceModel) return
    void runAppearanceTask(async token => {
      setAppearanceStatus('正在上传图片…')
      const parsed = parseImageDataUrl(uploadedImage)
      if (!parsed) throw new Error('图片格式不支持,请换一张 PNG/JPG')
      const ref = await window.mulby.ai.attachments.upload({
        buffer: parsed.buffer,
        mimeType: parsed.mimeType,
        purpose: 'image-edit',
      })
      if (token.cancelled) return
      setAppearanceStatus('AI 正在重绘为宠物风格…')
      const res = await window.mulby.ai.images.edit({
        model: appearanceModel,
        imageAttachmentId: ref.attachmentId,
        prompt: buildPetImageEditPrompt(petDescription),
      })
      if (token.cancelled) return
      const images = res?.images ?? []
      if (images.length === 0) throw new Error('模型没有返回图片,请重试或换个模型')
      await pixelateIntoPreview(toImageDataUrl(images[0]), petDescription.trim() || '上传图片宠物', token)
    })
  }

  /** 上传图片 → 跳过 AI,直接进像素化管线(适合本身已是卡通/像素风的素材) */
  const handleDirectPixelateUploadedImage = () => {
    if (!uploadedImage) return
    void runAppearanceTask(async token => {
      await pixelateIntoPreview(uploadedImage, petDescription.trim() || '上传图片宠物', token)
    })
  }

  const handleChooseAppearanceFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const dataUrl = await readFileAsDataUrl(file)
      if (!dataUrl.startsWith('data:image/')) throw new Error('请选择图片文件')
      setUploadedImage(dataUrl)
      setAppearanceError('')
    } catch (err) {
      setAppearanceError(err instanceof Error ? err.message : String(err))
    }
  }

  const handleCancelAppearance = () => {
    appearanceRunIdRef.current++   // 令当前任务的 token.cancelled 立即变 true,其后续结果一律丢弃
    appearanceAbortRef.current?.()
    appearanceAbortRef.current = null
    setAppearanceBusy(false)
    setAppearanceStatus('已取消')
  }

  const handleApplyAppearance = () => {
    if (!pendingSpriteSet) return
    window.mulby.window.sendToParent('sprites-updated', { spriteSet: pendingSpriteSet })
    showToast('已应用新形象')
  }

  const handleResetAppearance = () => {
    window.mulby.window.sendToParent('sprites-updated', { reset: true })
    showToast('已恢复默认幽灵形象')
  }

  /** 透明度滑块:实时下发宠物窗口并持久化(宠物端收到后也会落盘,这里先存一份保证设置页重开即时回显) */
  const handleOpacityChange = (value: number) => {
    const v = clampPetOpacity(value)
    setAppearanceOpacity(v)
    window.mulby.window.sendToParent('opacity-updated', { opacity: v })
    window.mulby.storage.set(PET_OPACITY_STORAGE_KEY, v).catch(err => {
      console.error('Save opacity failed:', err)
    })
  }

  const persistAppearanceHistory = (list: CompactPetSpriteSet[]) => {
    window.mulby.storage.set(PET_APPEARANCE_HISTORY_STORAGE_KEY, list).catch(err => {
      console.error('Save appearance history failed:', err)
    })
  }

  /** 生成成功后把形象存入历史:按 id 去重、最新置顶、裁剪到上限并落盘 */
  const addAppearanceToHistory = (spriteSet: PetSpriteSet) => {
    const compact = compactSpriteSet(spriteSet)
    setAppearanceHistory(prev => {
      const next = [compact, ...prev.filter(item => item.id !== compact.id)].slice(0, PET_APPEARANCE_HISTORY_LIMIT)
      persistAppearanceHistory(next)
      return next
    })
  }

  const handleApplyHistoryItem = (item: CompactPetSpriteSet) => {
    const expanded = expandSpriteSet(item)
    if (!expanded) {
      showToast('该历史形象已损坏,无法应用')
      return
    }
    setPendingSpriteSet(expanded)
    setRawPetImage('')
    window.mulby.window.sendToParent('sprites-updated', { spriteSet: expanded })
    showToast('已应用历史形象')
  }

  const handleDeleteHistoryItem = (id: string) => {
    setAppearanceHistory(prev => {
      const next = prev.filter(item => item.id !== id)
      persistAppearanceHistory(next)
      return next
    })
  }

  /** 历史卡片缩略图:取 stand_neutral 对应的 SVG(自产内容,预览安全) */
  const historyThumbnail = (item: CompactPetSpriteSet): string => {
    const idx = item.keys['stand_neutral']
    return typeof idx === 'number' ? (item.svgs[idx] ?? '') : ''
  }

  const renderAppearance = () => {
    const previews: Array<{ key: PetSpriteKey; label: string }> = [
      { key: 'stand_neutral', label: '平常' },
      { key: 'stand_happy', label: '开心' },
      { key: 'stand_sleepy', label: '困倦' },
    ]
    return (
      <div className="panel-content">
        <p className="field-hint">
          用 AI 生成专属宠物形象:描述外观 → 生成像素立绘 → 预览 → 应用。15 种表情五官会自动合成到新形象上,姿态动画保持不变。
        </p>

        <div className="field">
          <label className="field-label">宠物透明度 · {Math.round(appearanceOpacity * 100)}%</label>
          <input
            type="range"
            className="appearance-opacity-range"
            min={MIN_PET_OPACITY}
            max={MAX_PET_OPACITY}
            step={0.05}
            value={appearanceOpacity}
            onChange={e => handleOpacityChange(Number(e.target.value))}
          />
          <p className="field-hint">调整桌宠整体不透明度,拖动即时生效。</p>
        </div>

        <div className="field">
          <label className="field-label">形象描述</label>
          <textarea
            className="field-input appearance-desc"
            rows={3}
            placeholder="例如:一只圆滚滚的橘色小猫,白色肚皮,大大的绿眼睛"
            value={petDescription}
            onChange={e => setPetDescription(e.target.value)}
          />
        </div>

        <div className="field">
          <label className="field-label">生图模型</label>
          {imageModels.length === 0 ? (
            <p className="field-hint">没有可用的生图模型。请先在 Mulby 的 AI 设置中启用支持图像生成的模型(如 gpt-image-1、Gemini Flash Image)。</p>
          ) : (
            <select className="field-input" value={appearanceModel} onChange={e => setAppearanceModel(e.target.value)}>
              {imageModels.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          )}
        </div>

        <div className="appearance-actions">
          <button
            className="gen-btn"
            disabled={appearanceBusy || !appearanceModel || !petDescription.trim()}
            onClick={handleGenerateAppearance}
          >{appearanceBusy ? '生成中…' : '生成形象'}</button>
          {appearanceBusy && <button className="freq-btn" onClick={handleCancelAppearance}>取消</button>}
          {appearanceStatus && <span className="field-hint appearance-status">{appearanceStatus}</span>}
        </div>

        <div className="field">
          <label className="field-label">或:用自己的图片</label>
          <div className="appearance-actions">
            <button className="freq-btn" disabled={appearanceBusy} onClick={() => appearanceFileInputRef.current?.click()}>选择图片</button>
            {uploadedImage && <img className="appearance-upload-thumb" src={uploadedImage} alt="已选图片" />}
            {uploadedImage && (
              <>
                <button
                  className="gen-btn"
                  disabled={appearanceBusy || !appearanceModel}
                  onClick={handleStylizeUploadedImage}
                >AI 转宠物风格</button>
                <button
                  className="gen-btn"
                  disabled={appearanceBusy}
                  onClick={handleDirectPixelateUploadedImage}
                >直接像素化</button>
              </>
            )}
            <input
              ref={appearanceFileInputRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={e => void handleChooseAppearanceFile(e)}
            />
          </div>
          <p className="field-hint">「AI 转宠物风格」会用图生图把照片重绘成 Q 版立绘(上方描述可作风格提示,需要生图模型);「直接像素化」跳过 AI,适合本身就是简洁卡通或像素风的图片。</p>
        </div>

        {appearanceError && <p className="appearance-error">{appearanceError}</p>}

        {(rawPetImage || pendingSpriteSet) && (
          <div className="appearance-preview-row">
            {rawPetImage && (
              <div className="appearance-card">
                <div className="appearance-card-title">AI 立绘</div>
                <img className="appearance-raw-img" src={rawPetImage} alt="AI 生成立绘" />
              </div>
            )}
            {pendingSpriteSet && previews.map(p => (
              <div className="appearance-card" key={p.key}>
                <div className="appearance-card-title">{p.label}</div>
                <div className="appearance-sprite" dangerouslySetInnerHTML={{ __html: pendingSpriteSet.sprites[p.key] ?? '' }} />
              </div>
            ))}
          </div>
        )}

        <div className="appearance-actions">
          <button className="gen-btn" disabled={!pendingSpriteSet} onClick={handleApplyAppearance}>应用到宠物</button>
          <button className="reset-colors-btn" onClick={handleResetAppearance}>恢复默认形象</button>
        </div>

        {appearanceHistory.length > 0 && (
          <div className="field appearance-history">
            <label className="field-label">历史形象</label>
            <div className="appearance-history-grid">
              {appearanceHistory.map(item => (
                <div className="appearance-history-card" key={item.id}>
                  <div
                    className="appearance-history-thumb"
                    dangerouslySetInnerHTML={{ __html: historyThumbnail(item) }}
                  />
                  <div className="appearance-history-name" title={item.name}>{item.name || '自定义宠物'}</div>
                  <div className="appearance-history-actions">
                    <button className="freq-btn" disabled={appearanceBusy} onClick={() => handleApplyHistoryItem(item)}>应用</button>
                    <button className="freq-btn" onClick={() => handleDeleteHistoryItem(item.id)}>删除</button>
                  </div>
                </div>
              ))}
            </div>
            <p className="field-hint">最多保留最近 {PET_APPEARANCE_HISTORY_LIMIT} 个生成的形象,点「应用」即可换装。</p>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="settings-root">
      <div className="settings-header">
        <div className="tab-bar">
          <button className={`tab ${tab === 'personality' ? 'active' : ''}`} onClick={() => setTab('personality')}>设置</button>
          <button className={`tab ${tab === 'appearance' ? 'active' : ''}`} onClick={() => setTab('appearance')}>外观</button>
          <button className={`tab ${tab === 'ecosystem' ? 'active' : ''}`} onClick={() => setTab('ecosystem')}>生态</button>
          <button className={`tab ${tab === 'reminders' ? 'active' : ''}`} onClick={() => setTab('reminders')}>提醒</button>
          <button className={`tab ${tab === 'memory' ? 'active' : ''}`} onClick={() => setTab('memory')}>记忆</button>
          <button className={`tab ${tab === 'achievements' ? 'active' : ''}`} onClick={() => setTab('achievements')}>成就</button>
          <button className={`tab ${tab === 'diary' ? 'active' : ''}`} onClick={() => setTab('diary')}>日记</button>
          <button className={`tab ${tab === 'dialogue' ? 'active' : ''}`} onClick={() => setTab('dialogue')}>对话</button>
          <button className={`tab ${tab === 'playground' ? 'active' : ''}`} onClick={() => setTab('playground')}>表现预览</button>
        </div>
      </div>

      <div className="settings-body">
        {tab === 'appearance' && renderAppearance()}
        {tab === 'ecosystem' && renderEcosystem()}
        {tab === 'reminders' && renderReminders()}
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

          {renderLocationSettings()}

          <div className="field">
            <label className="field-label">
              <Icon d={ICONS.layers} size={14} color="var(--accent)" /> 上下文与隐私
            </label>
            <div className="trigger-list">
              <label className="trigger-item">
                <input
                  type="checkbox"
                  checked={ecosystemSettings.workModeEnabled}
                  onChange={e => setEcosystemSettings(s => ({ ...s, workModeEnabled: e.target.checked }))}
                />
                <span>根据当前应用识别工作模式</span>
              </label>
              <label className="trigger-item">
                <input
                  type="checkbox"
                  checked={ecosystemSettings.useWindowTitleContext}
                  onChange={e => setEcosystemSettings(s => ({ ...s, useWindowTitleContext: e.target.checked }))}
                />
                <span>允许窗口标题参与短期 AI 上下文</span>
              </label>
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

      {(tab === 'personality' || tab === 'ecosystem' || tab === 'reminders') && <div className="settings-footer">
        <button className="save-btn" onClick={handleSave}>保存设置</button>
      </div>}

      {toast && <div className="toast-wrap"><div className="toast">{toast}</div></div>}
    </div>
  )
}

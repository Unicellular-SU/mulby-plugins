import { useCallback, useEffect, useRef, useState } from 'react'
import type { VibeSession, VibeMessage, SessionStorageStats } from './types'
import { MAX_SESSIONS, MAX_MESSAGES_PERSISTED } from './types'

const SESSIONS_KEY = 'vibe-sessions'
const ACTIVE_KEY = 'vibe-active-session'

const storage = () => (window as any)?.mulby?.storage

function generateId(): string {
  return `vs-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function trimMessages(session: VibeSession): VibeSession {
  if (session.messages.length <= MAX_MESSAGES_PERSISTED) return session
  return { ...session, messages: session.messages.slice(-MAX_MESSAGES_PERSISTED) }
}

function enforceLimits(sessions: VibeSession[]): VibeSession[] {
  const sorted = [...sessions].sort((a, b) => b.lastActiveAt - a.lastActiveAt)
  return sorted.slice(0, MAX_SESSIONS)
}

// 持久化前剪掉「没有任何对话内容」的多余会话：
// 同一 pluginPath 下，若已有带消息的会话，则丢弃其下所有空会话（新建却没用过的对话线程）；
// 若该项目下全是空会话，则只保留最近一条（代表项目本身，避免整个项目从列表消失）。
function pruneEmptyConversations(sessions: VibeSession[]): VibeSession[] {
  const byPath = new Map<string, VibeSession[]>()
  for (const s of sessions) {
    const arr = byPath.get(s.pluginPath) || []
    arr.push(s)
    byPath.set(s.pluginPath, arr)
  }
  const keep = new Set<string>()
  for (const arr of byPath.values()) {
    const withMsg = arr.filter((s) => s.messages.length > 0)
    if (withMsg.length > 0) {
      for (const s of withMsg) keep.add(s.id)
    } else {
      const newest = arr.reduce((a, b) => (b.lastActiveAt > a.lastActiveAt ? b : a))
      keep.add(newest.id)
    }
  }
  return sessions.filter((s) => keep.has(s.id))
}

async function loadSessions(): Promise<VibeSession[]> {
  try {
    const raw = await storage()?.get?.(SESSIONS_KEY)
    if (!raw || !Array.isArray(raw)) return []
    return raw as VibeSession[]
  } catch {
    return []
  }
}

async function saveSessions(sessions: VibeSession[]): Promise<void> {
  try {
    const trimmed = enforceLimits(pruneEmptyConversations(sessions).map(trimMessages))
    await storage()?.set?.(SESSIONS_KEY, trimmed)
  } catch { /* 静默失败 */ }
}

async function loadActiveId(): Promise<string | null> {
  try {
    return (await storage()?.get?.(ACTIVE_KEY)) || null
  } catch {
    return null
  }
}

async function saveActiveId(id: string | null): Promise<void> {
  try {
    await storage()?.set?.(ACTIVE_KEY, id)
  } catch { /* 静默失败 */ }
}

export function useVibeSession() {
  const [sessions, setSessions] = useState<VibeSession[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // 待落盘的最新快照（debounce 期间）+ 当前状态镜像：供插件关闭/窗口隐藏时同步 flush，
  // 不依赖 React 渲染周期（pagehide 后可能不再渲染）
  const pendingRef = useRef<{ sessions: VibeSession[]; activeId: string | null } | null>(null)
  const sessionsRef = useRef<VibeSession[]>([])
  const activeIdRef = useRef<string | null>(null)
  useEffect(() => { sessionsRef.current = sessions }, [sessions])
  useEffect(() => { activeIdRef.current = activeId }, [activeId])

  const activeSession = sessions.find((s) => s.id === activeId) || null

  useEffect(() => {
    let mounted = true
    void (async () => {
      const [list, id] = await Promise.all([loadSessions(), loadActiveId()])
      if (!mounted) return
      setSessions(list)
      setActiveId(id && list.some((s) => s.id === id) ? id : list[0]?.id || null)
      setLoaded(true)
    })()
    return () => { mounted = false }
  }, [])

  const persist = useCallback((nextSessions: VibeSession[], nextActiveId: string | null) => {
    pendingRef.current = { sessions: nextSessions, activeId: nextActiveId }
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null
      const p = pendingRef.current
      pendingRef.current = null
      if (p) { void saveSessions(p.sessions); void saveActiveId(p.activeId) }
    }, 500)
  }, [])

  // 立即把 debounce 中未落盘的快照写入存储（尽力而为：pagehide 里发出的 IPC 通常仍会被宿主处理）
  const flushPersist = useCallback(() => {
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null }
    const p = pendingRef.current
    pendingRef.current = null
    if (p) { void saveSessions(p.sessions); void saveActiveId(p.activeId) }
  }, [])

  /**
   * 绕过 React 渲染周期，同步合并补丁并立即落盘。
   * 供面板在插件关闭/窗口隐藏时写入最终状态——否则面板侧 debounce（~800ms）+ 本层 debounce（500ms）
   * 内的状态会随渲染进程销毁而丢失（曾导致迭代中的会话被持久化成过期的 'contract' 态）。
   */
  const flushSessionNow = useCallback((id: string, patch: Partial<VibeSession>) => {
    const pendingActive = pendingRef.current?.activeId
    const base = pendingRef.current?.sessions || sessionsRef.current
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null }
    pendingRef.current = null
    const next = base.map((s) => (s.id === id ? { ...s, ...patch, lastActiveAt: Date.now() } : s))
    sessionsRef.current = next
    void saveSessions(next)
    void saveActiveId(pendingActive !== undefined ? pendingActive : activeIdRef.current)
    setSessions(next)
  }, [])

  // 插件关闭（pagehide）/ 窗口隐藏（visibilitychange）时落盘 debounce 中的快照
  useEffect(() => {
    const flush = () => flushPersist()
    const onVis = () => { if (document.visibilityState === 'hidden') flush() }
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', onVis)
    return () => {
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [flushPersist])

  // opts.allowDuplicatePath: 允许同一 pluginPath 存在多个会话（用于「同一项目下新建会话线程」）。
  // 默认仍按 pluginPath 去重，保持原有「一个项目一条会话」的创建语义不变。
  const createSession = useCallback((partial: Partial<VibeSession> & { pluginPath: string; pluginName: string }, opts?: { allowDuplicatePath?: boolean }): VibeSession => {
    const now = Date.now()
    const session: VibeSession = {
      id: generateId(),
      state: 'initial',
      contract: null,
      messages: [],
      contextSummary: '',
      sentence: '',
      vibeMode: 'create',
      genDepth: 'full',
      selectedModel: '',
      createdAt: now,
      lastActiveAt: now,
      ...partial
    }
    setSessions((prev) => {
      const base = opts?.allowDuplicatePath ? prev : prev.filter((s) => s.pluginPath !== session.pluginPath)
      const next = [session, ...base]
      persist(next, session.id)
      return next
    })
    setActiveId(session.id)
    return session
  }, [persist])

  const updateSession = useCallback((id: string, patch: Partial<VibeSession>) => {
    setSessions((prev) => {
      const next = prev.map((s) => s.id === id ? { ...s, ...patch, lastActiveAt: Date.now() } : s)
      persist(next, activeId)
      return next
    })
  }, [persist, activeId])

  // 以函数式更新追加一条对话消息，避免并发 setState（用户/AI 消息）相互覆盖
  const appendMessage = useCallback((id: string, msg: VibeMessage) => {
    setSessions((prev) => {
      const next = prev.map((s) => s.id === id
        ? { ...s, messages: [...s.messages, msg], lastActiveAt: Date.now() }
        : s)
      persist(next, activeId)
      return next
    })
  }, [persist, activeId])

  const deleteSession = useCallback((id: string) => {
    setSessions((prev) => {
      const next = prev.filter((s) => s.id !== id)
      const newActiveId = activeId === id ? (next[0]?.id || null) : activeId
      setActiveId(newActiveId)
      persist(next, newActiveId)
      return next
    })
  }, [persist, activeId])

  const switchSession = useCallback((id: string) => {
    if (!sessions.some((s) => s.id === id)) return
    setActiveId(id)
    void saveActiveId(id)
  }, [sessions])

  // 取消选中当前会话（用于「新建项目」：进入空白态，下次规划再创建新会话）
  const deselect = useCallback(() => {
    setActiveId(null)
    void saveActiveId(null)
  }, [])

  // 清空某会话的对话记录（保留会话本身）
  const clearMessages = useCallback((id: string) => {
    setSessions((prev) => {
      const next = prev.map((s) => s.id === id ? { ...s, messages: [], lastActiveAt: Date.now() } : s)
      persist(next, activeId)
      return next
    })
  }, [persist, activeId])

  const findByPath = useCallback((pluginPath: string): VibeSession | null => {
    return sessions.find((s) => s.pluginPath === pluginPath) || null
  }, [sessions])

  const getStats = useCallback((): SessionStorageStats => {
    const items = sessions.map((s) => ({
      id: s.id,
      name: s.pluginName,
      bytes: new Blob([JSON.stringify(trimMessages(s))]).size,
      lastActiveAt: s.lastActiveAt
    }))
    return {
      count: sessions.length,
      totalBytes: items.reduce((sum, i) => sum + i.bytes, 0),
      sessions: items.sort((a, b) => b.lastActiveAt - a.lastActiveAt)
    }
  }, [sessions])

  const clearAll = useCallback(async () => {
    setSessions([])
    setActiveId(null)
    await saveSessions([])
    await saveActiveId(null)
  }, [])

  return {
    sessions,
    activeSession,
    activeId,
    loaded,
    createSession,
    updateSession,
    flushSessionNow,
    appendMessage,
    deleteSession,
    switchSession,
    deselect,
    clearMessages,
    findByPath,
    getStats,
    clearAll
  }
}

import React, { createContext, useContext } from 'react'
import { useVibeSession } from './useVibeSession'
import type { VibeSession, VibeMessage, SessionStorageStats } from './types'

interface SessionContextValue {
  sessions: VibeSession[]
  activeSession: VibeSession | null
  activeId: string | null
  loaded: boolean
  createSession: (partial: Partial<VibeSession> & { pluginPath: string; pluginName: string }, opts?: { allowDuplicatePath?: boolean }) => VibeSession
  updateSession: (id: string, patch: Partial<VibeSession>) => void
  /** 绕过 debounce 与渲染周期，同步合并补丁并立即落盘（插件关闭/窗口隐藏时用） */
  flushSessionNow: (id: string, patch: Partial<VibeSession>) => void
  appendMessage: (id: string, msg: VibeMessage) => void
  deleteSession: (id: string) => void
  switchSession: (id: string) => void
  deselect: () => void
  clearMessages: (id: string) => void
  findByPath: (pluginPath: string) => VibeSession | null
  getStats: () => SessionStorageStats
  clearAll: () => Promise<void>
}

const SessionContext = createContext<SessionContextValue | null>(null)

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const value = useVibeSession()
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error('useSession must be used within SessionProvider')
  return ctx
}

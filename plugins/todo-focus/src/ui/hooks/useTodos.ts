import { useCallback, useEffect, useState } from 'react'
import type { Settings, Stats, TodoItem, TodoState } from '../../types/todo'
import { unwrapHostResult } from '../lib/hostResult'
import { useMulby } from './useMulby'

const PLUGIN_ID = 'todo-focus'
const syncChannel = new BroadcastChannel('todo-focus-sync')

export function useTodos() {
  const { host, notification } = useMulby(PLUGIN_ID)
  const [todos, setTodos] = useState<TodoItem[]>([])
  const [settings, setSettings] = useState<Settings | null>(null)
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const state = unwrapHostResult<TodoState>(await host.call('getState'))
      setTodos(state?.todos || [])
      setSettings(state?.settings ?? null)
      setStats(state?.stats ?? null)
    } catch (err) {
      const msg = err instanceof Error ? err.message : '加载失败'
      notification.show(msg, 'error')
    } finally {
      setLoading(false)
    }
  }, [host, notification])

  useEffect(() => {
    void refresh()
    const onVis = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    document.addEventListener('visibilitychange', onVis)
    
    const onMsg = (e: MessageEvent) => {
      if (e.data === 'refresh') void refresh()
    }
    syncChannel.addEventListener('message', onMsg)

    return () => {
      document.removeEventListener('visibilitychange', onVis)
      syncChannel.removeEventListener('message', onMsg)
    }
  }, [refresh])

  const addTodo = useCallback(
    async (title: string, note?: string, priority?: 'high' | 'medium' | 'low', dueDate?: number) => {
      const item = unwrapHostResult<TodoItem>(await host.call('addTodo', title, note, priority, dueDate))
      await refresh()
      syncChannel.postMessage('refresh')
      return item
    },
    [host, refresh]
  )

  const updateTodo = useCallback(
    async (id: string, patch: Partial<Pick<TodoItem, 'title' | 'note' | 'done' | 'pinned' | 'focusMinutes' | 'priority' | 'dueDate' | 'checklist' | 'sortOrder'>>) => {
      await host.call('updateTodo', id, patch)
      await refresh()
      syncChannel.postMessage('refresh')
    },
    [host, refresh]
  )

  const removeTodo = useCallback(
    async (id: string) => {
      await host.call('removeTodo', id)
      await refresh()
      syncChannel.postMessage('refresh')
    },
    [host, refresh]
  )

  const toggleDone = useCallback(
    async (id: string) => {
      await host.call('toggleDone', id)
      await refresh()
      syncChannel.postMessage('refresh')
    },
    [host, refresh]
  )

  const saveSettings = useCallback(
    async (patch: Partial<Settings>) => {
      const next = unwrapHostResult<Settings>(await host.call('saveSettings', patch))
      setSettings(next)
      syncChannel.postMessage('refresh')
      return next
    },
    [host]
  )

  const recordPomodoro = useCallback(
    async (todoId?: string, minutes?: number) => {
      const next = unwrapHostResult<Stats>(await host.call('recordPomodoroComplete', todoId, minutes))
      setStats(next)
      await refresh()
      syncChannel.postMessage('refresh')
      return next
    },
    [host, refresh]
  )

  const addChecklistItem = useCallback(
    async (todoId: string, text: string) => {
      await host.call('addChecklistItem', todoId, text)
      await refresh()
      syncChannel.postMessage('refresh')
    },
    [host, refresh]
  )

  const toggleChecklistItem = useCallback(
    async (todoId: string, checklistId: string) => {
      await host.call('toggleChecklistItem', todoId, checklistId)
      await refresh()
      syncChannel.postMessage('refresh')
    },
    [host, refresh]
  )

  const removeChecklistItem = useCallback(
    async (todoId: string, checklistId: string) => {
      await host.call('removeChecklistItem', todoId, checklistId)
      await refresh()
      syncChannel.postMessage('refresh')
    },
    [host, refresh]
  )

  const importAsChecklist = useCallback(
    async (todoId: string, titles: string[]) => {
      await host.call('importAsChecklist', todoId, titles)
      await refresh()
      syncChannel.postMessage('refresh')
    },
    [host, refresh]
  )

  const reorderTodos = useCallback(
    async (todoIds: string[]) => {
      await host.call('reorderTodos', todoIds)
      await refresh()
      syncChannel.postMessage('refresh')
    },
    [host, refresh]
  )

  return {
    todos,
    settings,
    stats,
    loading,
    refresh,
    addTodo,
    updateTodo,
    removeTodo,
    toggleDone,
    saveSettings,
    recordPomodoro,
    addChecklistItem,
    toggleChecklistItem,
    removeChecklistItem,
    importAsChecklist,
    reorderTodos,
  }
}

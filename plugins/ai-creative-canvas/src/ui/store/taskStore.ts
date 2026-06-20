import { create } from 'zustand'

interface TaskState {
  active: number
  inc: () => void
  dec: () => void
}

export const useTask = create<TaskState>((set) => ({
  active: 0,
  inc: () => set((s) => ({ active: s.active + 1 })),
  dec: () => set((s) => ({ active: Math.max(0, s.active - 1) }))
}))

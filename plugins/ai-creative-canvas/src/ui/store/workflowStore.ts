import { create } from 'zustand'

interface WorkflowUiState {
  selectedRunId: string | null
  showHistory: boolean
  planning: boolean
  setSelectedRunId: (id: string | null) => void
  setShowHistory: (value: boolean) => void
  setPlanning: (value: boolean) => void
}

export const useWorkflowUi = create<WorkflowUiState>((set) => ({
  selectedRunId: null,
  showHistory: false,
  planning: false,
  setSelectedRunId: (selectedRunId) => set({ selectedRunId }),
  setShowHistory: (showHistory) => set({ showHistory }),
  setPlanning: (planning) => set({ planning })
}))

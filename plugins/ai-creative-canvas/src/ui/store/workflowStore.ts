import { create } from 'zustand'

interface WorkflowUiState {
  selectedRunId: string | null
  planning: boolean
  setSelectedRunId: (id: string | null) => void
  setPlanning: (value: boolean) => void
}

export const useWorkflowUi = create<WorkflowUiState>((set) => ({
  selectedRunId: null,
  planning: false,
  setSelectedRunId: (selectedRunId) => set({ selectedRunId }),
  setPlanning: (planning) => set({ planning })
}))

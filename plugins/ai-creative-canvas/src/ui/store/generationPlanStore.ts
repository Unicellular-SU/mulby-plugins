import { create } from 'zustand'
import type { GenerationPlan } from '../services/generationPlan'
import { useUi } from './uiStore'

interface GenerationPlanState {
  plan: GenerationPlan | null
  resolve: ((approved: boolean) => void) | null
  present: (plan: GenerationPlan) => Promise<boolean>
  decide: (approved: boolean) => void
}

export const useGenerationPlan = create<GenerationPlanState>((set, get) => ({
  plan: null,
  resolve: null,
  present: (plan) => new Promise<boolean>((resolve) => {
    const previous = get().resolve
    if (previous) previous(false)
    useUi.getState().setShowGenerationPlan(true)
    set({ plan, resolve })
  }),
  decide: (approved) => {
    const resolve = get().resolve
    useUi.getState().setShowGenerationPlan(false)
    set({ plan: null, resolve: null })
    resolve?.(approved)
  }
}))

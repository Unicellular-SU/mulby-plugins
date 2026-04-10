import { create } from 'zustand'
import { CategoryCode, getDefaultUnits } from '../core/unitCatalog'
import { CurrencyRatePayload } from '../core/currencyService'

export type HistoryItem = {
  id: string
  createdAt: number
  category: CategoryCode
  input: string
  fromUnitId: string
  toUnitId: string
  output: string
}

export type RateStatus = 'idle' | 'loading' | 'success' | 'offline'

type ConverterState = {
  category: CategoryCode
  input: string
  fromUnitId: string
  toUnitId: string
  precision: number
  scientific: boolean
  batchMode: boolean
  history: HistoryItem[]
  rates: CurrencyRatePayload
  rateStatus: RateStatus
  rateError?: string
  setCategory: (category: CategoryCode) => void
  setInput: (input: string) => void
  setFromUnitId: (unitId: string) => void
  setToUnitId: (unitId: string) => void
  swapUnits: () => void
  setPrecision: (value: number) => void
  setScientific: (value: boolean) => void
  setBatchMode: (value: boolean) => void
  setRates: (rates: CurrencyRatePayload) => void
  setRateStatus: (status: RateStatus, error?: string) => void
  setHistory: (history: HistoryItem[]) => void
  addHistory: (item: Omit<HistoryItem, 'id' | 'createdAt'>) => void
  clearHistory: () => void
  applyHistory: (id: string) => HistoryItem | undefined
}

const defaultLengthUnits = getDefaultUnits('length')

const initialRates: CurrencyRatePayload = {
  base: 'USD',
  rates: {
    USD: 1,
    EUR: 0.92,
    CNY: 7.24,
    JPY: 154.2,
    GBP: 0.78,
    HKD: 7.82
  },
  currencies: {
    USD: 'United States Dollar',
    EUR: 'Euro',
    CNY: 'Chinese Renminbi Yuan',
    JPY: 'Japanese Yen',
    GBP: 'British Pound',
    HKD: 'Hong Kong Dollar'
  },
  updatedAt: 0
}

export const useConverterStore = create<ConverterState>((set, get) => ({
  category: 'length',
  input: '',
  fromUnitId: defaultLengthUnits.fromUnitId,
  toUnitId: defaultLengthUnits.toUnitId,
  precision: 4,
  scientific: false,
  batchMode: false,
  history: [],
  rates: initialRates,
  rateStatus: 'idle',
  rateError: undefined,

  setCategory: (category) => {
    const defaults = getDefaultUnits(category)
    set({
      category,
      fromUnitId: defaults.fromUnitId,
      toUnitId: defaults.toUnitId
    })
  },
  setInput: (input) => set({ input }),
  setFromUnitId: (unitId) => set({ fromUnitId: unitId }),
  setToUnitId: (unitId) => set({ toUnitId: unitId }),
  swapUnits: () => set((state) => ({ fromUnitId: state.toUnitId, toUnitId: state.fromUnitId })),
  setPrecision: (value) => set({ precision: value }),
  setScientific: (value) => set({ scientific: value }),
  setBatchMode: (value) => set({ batchMode: value }),
  setRates: (rates) => set({ rates }),
  setRateStatus: (status, error) => set({ rateStatus: status, rateError: error }),
  setHistory: (history) => set({ history: history.slice(0, 10) }),
  addHistory: (item) =>
    set((state) => ({
      history: [
        { ...item, id: crypto.randomUUID(), createdAt: Date.now() },
        ...state.history
      ].slice(0, 10)
    })),
  clearHistory: () => set({ history: [] }),
  applyHistory: (id) => {
    const item = get().history.find((entry) => entry.id === id)
    if (!item) {
      return undefined
    }
    set({
      category: item.category,
      input: item.input,
      fromUnitId: item.fromUnitId,
      toUnitId: item.toUnitId
    })
    return item
  }
}))

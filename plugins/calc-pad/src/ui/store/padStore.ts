// src/ui/store/padStore.ts

export interface CalcLine {
  id: string
  expression: string
  result: string
  note: string
  timestamp: number
}

export interface Pad {
  id: string
  name: string
  lines: CalcLine[]
  createdAt: number
  updatedAt: number
}

export interface PadState {
  pads: Pad[]
  activePadId: string | null
}

let state: PadState = {
  pads: [],
  activePadId: null
}

const listeners = new Set<() => void>()

export function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function notify() {
  listeners.forEach(l => l())
  saveToStorage()
}

// Mulby API shim if not in Mulby environment
const getStorage = () => (window as any).mulby?.storage

export async function loadFromStorage() {
  const storage = getStorage()
  if (!storage) return

  const savedPads = await storage.get('calc-pad:pads')
  const savedActivePadId = await storage.get('calc-pad:activePadId')

  if (savedPads && Array.isArray(savedPads) && savedPads.length > 0) {
    state = {
      ...state,
      pads: savedPads,
      activePadId: savedActivePadId && savedPads.find((p: Pad) => p.id === savedActivePadId) ? savedActivePadId : savedPads[0].id
    }
  } else {
    createPad('稿纸 1')
  }
  listeners.forEach(l => l())
}

let saveTimeout: any
function saveToStorage() {
  const storage = getStorage()
  if (!storage) return

  if (saveTimeout) clearTimeout(saveTimeout)
  saveTimeout = setTimeout(() => {
    storage.set('calc-pad:pads', state.pads)
    storage.set('calc-pad:activePadId', state.activePadId)
  }, 500)
}

export function getState() {
  return state
}

export function getActivePad(): Pad | null {
  if (!state.activePadId) return null
  return state.pads.find(p => p.id === state.activePadId) || null
}

export function createPad(name?: string) {
  const newPad: Pad = {
    id: crypto.randomUUID(),
    name: name || `稿纸 ${state.pads.length + 1}`,
    lines: [],
    createdAt: Date.now(),
    updatedAt: Date.now()
  }
  state = {
    ...state,
    pads: [...state.pads, newPad],
    activePadId: newPad.id
  }
  notify()
}

export function switchPad(id: string) {
  if (state.pads.some(p => p.id === id)) {
    state = { ...state, activePadId: id }
    notify()
  }
}

export function renamePad(id: string, newName: string) {
  const newPads = state.pads.map(p => {
    if (p.id === id) {
      return { ...p, name: newName, updatedAt: Date.now() }
    }
    return p
  })
  state = { ...state, pads: newPads }
  notify()
}

export function deletePad(id: string) {
  const newPads = state.pads.filter(p => p.id !== id)
  let newActivePadId = state.activePadId
  if (state.activePadId === id) {
    newActivePadId = newPads.length > 0 ? newPads[newPads.length - 1].id : null
  }
  state = { ...state, pads: newPads, activePadId: newActivePadId }
  
  if (state.pads.length === 0) {
    createPad('稿纸 1')
  } else {
    notify()
  }
}

export function addLine(expression: string, result: string) {
  const activePad = getActivePad()
  if (!activePad) return

  const newLine: CalcLine = {
    id: crypto.randomUUID(),
    expression,
    result,
    note: '',
    timestamp: Date.now()
  }

  const newPads = state.pads.map(p => {
    if (p.id === activePad.id) {
      return {
        ...p,
        lines: [...p.lines, newLine],
        updatedAt: Date.now()
      }
    }
    return p
  })

  state = { ...state, pads: newPads }
  notify()
}

export function updateLine(lineId: string, updates: Partial<CalcLine>) {
  const activePad = getActivePad()
  if (!activePad) return

  const newPads = state.pads.map(p => {
    if (p.id === activePad.id) {
      return {
        ...p,
        lines: p.lines.map(l => l.id === lineId ? { ...l, ...updates, timestamp: Date.now() } : l),
        updatedAt: Date.now()
      }
    }
    return p
  })

  state = { ...state, pads: newPads }
  notify()
}

export function removeLine(lineId: string) {
  const activePad = getActivePad()
  if (!activePad) return

  const newPads = state.pads.map(p => {
    if (p.id === activePad.id) {
      return {
        ...p,
        lines: p.lines.filter(l => l.id !== lineId),
        updatedAt: Date.now()
      }
    }
    return p
  })

  state = { ...state, pads: newPads }
  notify()
}

export function clearActivePad() {
  const activePad = getActivePad()
  if (!activePad) return

  const newPads = state.pads.map(p => {
    if (p.id === activePad.id) {
      return {
        ...p,
        lines: [],
        updatedAt: Date.now()
      }
    }
    return p
  })

  state = { ...state, pads: newPads }
  notify()
}

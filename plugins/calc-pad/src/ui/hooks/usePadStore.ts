// src/ui/hooks/usePadStore.ts
import { useEffect, useState } from 'react'
import * as padStore from '../store/padStore'
import { PadState, Pad } from '../store/padStore'

export function usePadStore() {
  const [state, setState] = useState<PadState>(padStore.getState())

  useEffect(() => {
    const unsubscribe = padStore.subscribe(() => {
      setState(padStore.getState())
    })
    return unsubscribe
  }, [])

  const activePad = state.activePadId ? state.pads.find((p: Pad) => p.id === state.activePadId) : null

  return {
    state,
    activePad,
    createPad: padStore.createPad,
    switchPad: padStore.switchPad,
    renamePad: padStore.renamePad,
    deletePad: padStore.deletePad,
    addLine: padStore.addLine,
    updateLine: padStore.updateLine,
    removeLine: padStore.removeLine,
    clearActivePad: padStore.clearActivePad
  }
}

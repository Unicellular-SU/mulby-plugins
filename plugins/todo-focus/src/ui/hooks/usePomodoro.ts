import { useCallback, useEffect, useRef, useState } from 'react'
import type { Settings } from '../../types/todo'

export type PomodoroPhase = 'idle' | 'focus' | 'shortBreak' | 'longBreak'

function phaseSeconds(phase: PomodoroPhase, settings: Settings): number {
  switch (phase) {
    case 'focus':
      return settings.pomodoroMinutes * 60
    case 'shortBreak':
      return settings.shortBreakMinutes * 60
    case 'longBreak':
      return settings.longBreakMinutes * 60
    default:
      return settings.pomodoroMinutes * 60
  }
}

export function usePomodoro(
  settings: Settings | null,
  onComplete: (phase: PomodoroPhase, completedFocus: boolean) => void
) {
  const [phase, setPhase] = useState<PomodoroPhase>('idle')
  const [remaining, setRemaining] = useState(0)
  const [running, setRunning] = useState(false)
  const focusCountRef = useRef(0)
  const onCompleteRef = useRef(onComplete)
  onCompleteRef.current = onComplete

  const armPhase = useCallback(
    (next: PomodoroPhase, autoRun = true) => {
      if (!settings) return
      setPhase(next)
      setRemaining(phaseSeconds(next, settings))
      setRunning(autoRun && next !== 'idle')
    },
    [settings]
  )

  useEffect(() => {
    if (!running || remaining <= 0 || phase === 'idle' || !settings) return

    const id = window.setInterval(() => {
      setRemaining((r) => r - 1)
    }, 1000)
    return () => clearInterval(id)
  }, [running, phase, settings])

  useEffect(() => {
    if (remaining > 0 || phase === 'idle' || !settings) return

    if (phase === 'focus') {
      focusCountRef.current += 1
      onCompleteRef.current('focus', true)
      const nextBreak: PomodoroPhase =
        focusCountRef.current % 4 === 0 ? 'longBreak' : 'shortBreak'
      armPhase(nextBreak, true)
      return
    }

    onCompleteRef.current(phase, false)
    armPhase('idle', false)
  }, [remaining, phase, settings, armPhase])

  const toggle = useCallback(() => {
    if (!settings) return
    if (phase === 'idle') {
      armPhase('focus', true)
      return
    }
    setRunning((r) => !r)
  }, [phase, settings, armPhase])

  const reset = useCallback(() => {
    setRunning(false)
    setPhase('idle')
    setRemaining(0)
  }, [])

  const skipBreak = useCallback(() => {
    if (phase === 'shortBreak' || phase === 'longBreak') {
      armPhase('idle', false)
    }
  }, [phase, armPhase])

  const totalSeconds =
    settings && phase !== 'idle' ? phaseSeconds(phase, settings) : settings?.pomodoroMinutes ? settings.pomodoroMinutes * 60 : 1
  const progress = totalSeconds > 0 && phase !== 'idle' ? 1 - remaining / totalSeconds : 0

  return {
    phase,
    remaining,
    running,
    progress,
    toggle,
    reset,
    skipBreak,
    armPhase,
  }
}

export function formatTimer(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

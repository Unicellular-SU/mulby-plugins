import { useCallback, useEffect, useRef, useState } from 'react'

export type TaskKind = 'convert' | 'trim' | 'frame' | 'sequence'
export type TaskStatus = 'queued' | 'running' | 'done' | 'error' | 'cancelled'

export interface TaskItem {
  id: string
  kind: TaskKind
  label: string
  status: TaskStatus
  percent: number
  outputPath?: string
  error?: string
}

export interface RunnerContext {
  totalSec: number | null
}

export interface FFmpegProcess {
  promise: Promise<void>
  kill: () => void
}

export interface FFmpegRunner {
  (args: string[], onProgress: (percent: number) => void, context: RunnerContext): FFmpegProcess
}

interface QueueEntry {
  item: TaskItem
  args: string[]
  totalSec: number | null
}

let taskSeq = 0

export function useTaskQueue(runner: FFmpegRunner, onTaskDone?: (task: TaskItem) => void) {
  const [tasks, setTasks] = useState<TaskItem[]>([])
  const queueRef = useRef<QueueEntry[]>([])
  const busyRef = useRef(false)
  const runningIdRef = useRef<string | null>(null)
  const killRef = useRef<(() => void) | null>(null)
  const cancelledRef = useRef(false)
  const runnerRef = useRef(runner)
  const doneRef = useRef(onTaskDone)
  runnerRef.current = runner
  doneRef.current = onTaskDone

  const patch = useCallback((id: string, changes: Partial<TaskItem>) => {
    setTasks((prev) => prev.map((task) => (task.id === id ? { ...task, ...changes } : task)))
  }, [])

  const pump = useCallback(async () => {
    if (busyRef.current) return
    const entry = queueRef.current.shift()
    if (!entry) return
    busyRef.current = true
    runningIdRef.current = entry.item.id
    cancelledRef.current = false
    patch(entry.item.id, { status: 'running' })
    try {
      const process = runnerRef.current(
        entry.args,
        (percent) => patch(entry.item.id, { percent }),
        { totalSec: entry.totalSec }
      )
      killRef.current = process.kill
      await process.promise
      const finalStatus: TaskStatus = cancelledRef.current ? 'cancelled' : 'done'
      patch(entry.item.id, { status: finalStatus, percent: finalStatus === 'done' ? 100 : cancelledRef.current ? 0 : 100 })
      if (finalStatus === 'done') doneRef.current?.({ ...entry.item, status: finalStatus, percent: 100 })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const wasCancelled = cancelledRef.current || /signal|kill/i.test(message)
      patch(entry.item.id, { status: wasCancelled ? 'cancelled' : 'error', error: wasCancelled ? undefined : message })
    } finally {
      killRef.current = null
      runningIdRef.current = null
      busyRef.current = false
      void pump()
    }
  }, [patch])

  const enqueue = useCallback(
    (spec: { kind: TaskKind; label: string; args: string[]; outputPath?: string; totalSec?: number | null }) => {
      taskSeq += 1
      const id = `task-${taskSeq}-${Date.now()}`
      const item: TaskItem = {
        id,
        kind: spec.kind,
        label: spec.label,
        status: 'queued',
        percent: 0,
        outputPath: spec.outputPath
      }
      queueRef.current.push({ item, args: spec.args, totalSec: spec.totalSec ?? null })
      setTasks((prev) => [...prev, item])
      void pump()
      return id
    },
    [pump]
  )

  const cancel = useCallback(
    (id: string) => {
      const queueIndex = queueRef.current.findIndex((entry) => entry.item.id === id)
      if (queueIndex >= 0) {
        queueRef.current.splice(queueIndex, 1)
        patch(id, { status: 'cancelled' })
        return
      }
      if (runningIdRef.current === id) {
        cancelledRef.current = true
        killRef.current?.()
      }
    },
    [patch]
  )

  const clearFinished = useCallback(() => {
    setTasks((prev) => prev.filter((task) => task.status === 'queued' || task.status === 'running'))
  }, [])

  useEffect(() => {
    return () => {
      cancelledRef.current = true
      killRef.current?.()
    }
  }, [])

  return { tasks, enqueue, cancel, clearFinished }
}

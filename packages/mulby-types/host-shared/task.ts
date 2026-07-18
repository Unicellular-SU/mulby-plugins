/**
 * Task Scheduler Types for Renderer
 */

export type TaskType = 'once' | 'repeat' | 'delay'
export type TaskStatus = 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled'

export interface Task {
  id: string
  pluginId: string
  name: string
  description?: string
  type: TaskType
  status: TaskStatus

  // 时间配置
  time?: number
  cron?: string
  delay?: number
  timezone?: string

  // 执行配置
  callback: string
  payload?: unknown
  maxRetries?: number
  retryDelay?: number
  timeout?: number

  // 重复任务配置
  endTime?: number
  maxExecutions?: number

  // 状态信息
  nextRunTime?: number
  lastRunTime?: number
  executionCount: number
  failureCount: number
  lastError?: string

  // 时间戳
  createdAt: number
  updatedAt: number
}

export interface TaskExecution {
  id: string
  taskId: string
  startTime: number
  endTime?: number
  status: 'success' | 'failed' | 'timeout'
  result?: unknown
  error?: string
  duration?: number
}

export type TaskSchedulerEventType =
  | 'task:created'
  | 'task:cancelled'
  | 'task:paused'
  | 'task:resumed'
  | 'task:success'
  | 'task:failed'
  | 'tasks:deleted'
  | 'tasks:cleaned'

export interface TaskSchedulerEvent {
  type: TaskSchedulerEventType
  timestamp: number
  taskId?: string
  task?: Task
  deletedCount?: number
  taskIds?: string[]
}

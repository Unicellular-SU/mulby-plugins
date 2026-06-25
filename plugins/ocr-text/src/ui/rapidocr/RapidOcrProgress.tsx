import { Loader2, CheckCircle, XCircle } from 'lucide-react'
import type { RapidOcrEngineStatus } from './types'

interface RapidOcrProgressBarProps {
  status: RapidOcrEngineStatus
  percent: number
  message: string
  onRetry?: () => void
}

/**
 * Progress UI for RapidOCR initialization (backend-based, no model download).
 *
 * Three visual states:
 * - initializing: spinner + "正在检测..."
 * - ready: green checkmark + "就绪"
 * - error: red X + error message
 */
export function RapidOcrProgressBar({
  status,
  message,
  onRetry,
}: RapidOcrProgressBarProps) {
  if (status === 'ready') {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <CheckCircle className="w-10 h-10 text-green-500" />
        <span className="text-sm text-green-600 dark:text-green-400">
          {message}
        </span>
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 px-4">
        <XCircle className="w-10 h-10 text-red-500" />
        <p className="text-sm text-red-500 text-center">{message}</p>
        <div className="flex items-center gap-2">
          {onRetry && (
            <button
              onClick={onRetry}
              className="px-3 py-1.5 rounded-md text-xs font-medium bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/30 transition-colors"
            >
              重试
            </button>
          )}
        </div>
        {message.includes('pip install') && (
          <p className="text-xs text-zinc-400 dark:text-zinc-500 text-center mt-1 max-w-xs">
            请在终端执行上述命令安装 RapidOCR，安装完成后重试
          </p>
        )}
      </div>
    )
  }

  // initializing
  return (
    <div className="flex flex-col items-center justify-center h-full gap-3">
      <Loader2 className="w-8 h-8 text-amber-500 animate-spin" />
      <span className="text-sm text-zinc-500 dark:text-zinc-400">
        {message}
      </span>
    </div>
  )
}

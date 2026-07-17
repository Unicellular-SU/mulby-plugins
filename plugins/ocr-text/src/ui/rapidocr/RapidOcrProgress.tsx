import { Loader2, CheckCircle, XCircle } from 'lucide-react'
import type { RapidOcrEngineStatus } from './types'

interface RapidOcrProgressBarProps {
  status: RapidOcrEngineStatus
  percent: number
  message: string
  onRetry?: () => void
}

/**
 * Progress UI while the built-in offline OCR engine loads its WASM runtime
 * and models from the plugin package.
 *
 * Three visual states:
 * - initializing/downloading: spinner + status message
 * - ready: green checkmark + "就绪"
 * - error: red X + error message
 */
export function RapidOcrProgressBar({
  status,
  percent,
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
      </div>
    )
  }

  // downloading / initializing
  return (
    <div className="flex flex-col items-center justify-center h-full gap-3">
      <Loader2 className="w-8 h-8 text-amber-500 animate-spin" />
      <span className="text-sm text-zinc-500 dark:text-zinc-400">
        {message}
      </span>
      {percent > 0 && percent < 100 && (
        <div className="w-40 h-1 rounded-full bg-zinc-200 dark:bg-zinc-700 overflow-hidden">
          <div
            className="h-full bg-amber-500 transition-all duration-300"
            style={{ width: `${percent}%` }}
          />
        </div>
      )}
    </div>
  )
}

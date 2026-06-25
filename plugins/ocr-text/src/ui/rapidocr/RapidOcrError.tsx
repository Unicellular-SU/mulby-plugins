import { AlertTriangle } from 'lucide-react'

interface RapidOcrErrorViewProps {
  error: string
  onRetry?: () => void
}

/**
 * Dedicated error component for RapidOCR recognition failures.
 * Shows the error message with a retry button.
 */
export function RapidOcrErrorView({ error, onRetry }: RapidOcrErrorViewProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-3 px-4">
      <div className="w-10 h-10 rounded-full bg-red-50 dark:bg-red-900/20 flex items-center justify-center">
        <AlertTriangle className="w-5 h-5 text-red-500" />
      </div>
      <p className="text-sm text-red-500 text-center">{error}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="px-3 py-1.5 rounded-md text-xs font-medium bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/30 transition-colors"
        >
          重试
        </button>
      )}
    </div>
  )
}

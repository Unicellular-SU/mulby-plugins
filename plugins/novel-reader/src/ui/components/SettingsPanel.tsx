import { useCallback, useState } from 'react'
import { X, Sun, Moon, BookOpen, Monitor } from 'lucide-react'
import type { ReaderSettings } from '../App'

const FONT_SIZES = [12, 14, 16, 18, 20, 22, 24, 26, 28]
const LINE_HEIGHTS = [
  { label: '紧凑', value: 1.5 },
  { label: '标准', value: 1.8 },
  { label: '舒适', value: 2.0 },
  { label: '宽松', value: 2.5 },
]
const THEMES: { key: ReaderSettings['theme']; label: string; icon: typeof Sun }[] = [
  { key: 'system', label: '系统', icon: Monitor },
  { key: 'light', label: '浅色', icon: Sun },
  { key: 'dark', label: '深色', icon: Moon },
  { key: 'sepia', label: '护眼', icon: BookOpen },
]

export default function SettingsPanel({ settings, onChange, onClose }: {
  settings: ReaderSettings
  onChange: (s: ReaderSettings) => void
  onClose: () => void
}) {
  const [local, setLocal] = useState(settings)

  const update = useCallback((patch: Partial<ReaderSettings>) => {
    const next = { ...local, ...patch }
    setLocal(next)
    onChange(next)
  }, [local, onChange])

  return (
    <div className="absolute inset-0 z-50 flex items-end sm:items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />

      {/* Panel */}
      <div className="relative w-full max-w-sm bg-[var(--surface)] rounded-t-2xl sm:rounded-2xl shadow-2xl p-6">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-semibold">阅读设置</h3>
          <button
            className="p-1 rounded-lg hover:bg-[var(--border)] transition-colors"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>

        {/* Font size */}
        <div className="mb-6">
          <label className="block text-sm text-[var(--text-2)] mb-2">字号</label>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-[var(--text-3)]">A</span>
            <input
              type="range"
              min={0}
              max={FONT_SIZES.length - 1}
              value={FONT_SIZES.indexOf(local.fontSize)}
              onChange={(e) => update({ fontSize: FONT_SIZES[Number(e.target.value)] })}
              className="flex-1 mx-3 accent-[var(--accent)]"
            />
            <span className="text-lg text-[var(--text-3)] font-bold">A</span>
          </div>
          <p className="text-center text-sm text-[var(--accent)]">{local.fontSize}px</p>
        </div>

        {/* Line height */}
        <div className="mb-6">
          <label className="block text-sm text-[var(--text-2)] mb-2">行高</label>
          <div className="grid grid-cols-4 gap-2">
            {LINE_HEIGHTS.map((lh) => (
              <button
                key={lh.value}
                className={`py-2 px-3 rounded-lg text-xs transition-colors ${
                  local.lineHeight === lh.value
                    ? 'bg-[var(--accent)] text-white'
                    : 'bg-[var(--border)] text-[var(--text-2)] hover:bg-[var(--accent-hover)] hover:text-white'
                }`}
                onClick={() => update({ lineHeight: lh.value })}
              >
                {lh.label}
              </button>
            ))}
          </div>
        </div>

        {/* Theme */}
        <div>
          <label className="block text-sm text-[var(--text-2)] mb-2">主题</label>
          <div className="grid grid-cols-4 gap-2">
            {THEMES.map((t) => {
              const Icon = t.icon
              return (
                <button
                  key={t.key}
                  className={`flex flex-col items-center gap-1 py-3 px-2 rounded-lg text-xs transition-colors ${
                    local.theme === t.key
                      ? 'bg-[var(--accent)] text-white'
                      : 'bg-[var(--border)] text-[var(--text-2)] hover:bg-[var(--accent-hover)] hover:text-white'
                  }`}
                  onClick={() => update({ theme: t.key })}
                >
                  <Icon size={16} />
                  {t.label}
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

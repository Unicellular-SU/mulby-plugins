// VideoStudioModal 的共享展示型原语（纯 UI、无 store/副作用）：从 VideoStudioModal.tsx 机械拆出（F1），
// 供主组件与后续拆出的面板/时间轴子文件共用。改动仅为「移动 + 导出」，行为与原内联定义完全一致。
import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

// 秒 → m:ss
export function fmt(s: number): string {
  if (!isFinite(s) || s < 0) return '0:00'
  const m = Math.floor(s / 60)
  const x = Math.floor(s % 60)
  return `${m}:${x.toString().padStart(2, '0')}`
}

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex items-center gap-2 text-[11px]">
      <span className="w-16 shrink-0 opacity-60">{label}</span>
      {children}
    </label>
  )
}

export function SliderRow({ label, value, min, max, step, suffix, onLive, onCommit }: {
  label: string; value: number; min: number; max: number; step: number; suffix?: string
  onLive: (v: number) => void; onCommit: () => void
}) {
  return (
    <Row label={label}>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onLive(Number(e.target.value))}
        onPointerUp={onCommit}
        onKeyUp={onCommit}
        className="flex-1 min-w-[60px]"
      />
      <span className="w-12 text-right tabular-nums opacity-70">{value.toFixed(step < 1 ? 2 : 0)}{suffix || ''}</span>
    </Row>
  )
}

export function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-[11px] cursor-pointer select-none">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  )
}

// 通用小图标按钮（头部/面板操作）
export function IconBtn({ icon: Icon, title, onClick, disabled }: { icon: LucideIcon; title: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button onClick={onClick} title={title} disabled={disabled} className="w-7 h-7 grid place-items-center rounded-md hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-30">
      <Icon size={15} />
    </button>
  )
}

// 播放控制条按钮（深色）
export function TBtn({ icon: Icon, title, onClick }: { icon: LucideIcon; title: string; onClick: () => void }) {
  return <button onClick={onClick} title={title} className="w-7 h-7 grid place-items-center rounded hover:bg-white/15 text-white/85"><Icon size={15} /></button>
}

// 左侧功能面板的工具格子（图标+文字，选中态/圆点）
export function ToolTile({ icon: Icon, label, active, dot, onClick }: { icon: LucideIcon; label: string; active: boolean; dot?: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} title={label}
      className={`relative flex flex-col items-center justify-center gap-1 h-[52px] rounded-lg transition-colors ${active ? 'bg-pink-500/15 text-pink-600 dark:text-pink-300 ring-1 ring-pink-500/50' : 'text-neutral-600 dark:text-neutral-300 hover:bg-black/5 dark:hover:bg-white/10'}`}>
      <Icon size={17} />
      <span className="text-[10px] leading-none">{label}</span>
      {dot && !active && <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-pink-500/70" />}
    </button>
  )
}

// 左侧功能面板的分组容器（标题 + 2 列格子）
export function ToolSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="px-2 pt-2.5">
      <div className="text-[10px] font-medium opacity-40 px-0.5 pb-1">{title}</div>
      <div className="grid grid-cols-2 gap-1">{children}</div>
    </div>
  )
}

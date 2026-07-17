// 底部标注工具栏（从 App.tsx 搬移：JSX 原样，交互逻辑通过 props 传入）。

import {
  Bot,
  Circle,
  Clipboard,
  Crop,
  Droplets,
  Eraser,
  FlipHorizontal,
  FlipVertical,
  Grid3x3,
  Hash,
  History as HistoryIcon,
  Highlighter,
  LucideIcon,
  Minus,
  MousePointer2,
  MoveRight,
  Pencil,
  Redo2,
  RotateCcw,
  RotateCw,
  Save,
  Sparkles,
  Square,
  Trash2,
  Type as TypeIcon,
  Undo2,
  X
} from 'lucide-react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { COLORS } from '../annotations/constants'
import { clamp } from '../annotations/geometry'
import type { Tool } from '../annotations/types'

const TOOL_ITEMS: Array<{ key: Tool; icon: LucideIcon; label: string }> = [
  { key: 'select', icon: MousePointer2, label: '选择/移动' },
  { key: 'line', icon: Minus, label: '直线' },
  { key: 'rect', icon: Square, label: '矩形' },
  { key: 'ellipse', icon: Circle, label: '圆形' },
  { key: 'arrow', icon: MoveRight, label: '箭头' },
  { key: 'pen', icon: Pencil, label: '画笔' },
  { key: 'highlighter', icon: Highlighter, label: '高亮' },
  { key: 'text', icon: TypeIcon, label: '文字' },
  { key: 'step', icon: Hash, label: '编号' },
  { key: 'mosaic', icon: Grid3x3, label: '马赛克' },
  { key: 'blur', icon: Droplets, label: '模糊' },
  { key: 'crop', icon: Crop, label: '裁剪选区' },
  { key: 'eraser', icon: Eraser, label: '橡皮擦' }
]

export interface ToolbarRange {
  label: string
  min: number
  max: number
  value: number
  onChange: (nextValue: number) => void
  /** 一次拖动/按键调整结束（pointerup/keyup）时回调。 */
  onCommit?: () => void
}

export interface ToolbarDragHandlers {
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void
  onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void
  onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void
  onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void
}

export interface ToolbarProps {
  tool: Tool
  onSelectTool: (tool: Tool) => void
  effectiveColor: string
  onColorChange: (color: string) => void
  range: ToolbarRange
  statusText: string
  onOpenHistory: () => void
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
  clearDisabled: boolean
  onClear: () => void
  canEditImage: boolean
  applyCropDisabled: boolean
  cropClearDisabled: boolean
  onApplyCrop: () => void
  onClearCrop: () => void
  onRotateLeft: () => void
  onRotateRight: () => void
  onFlipHorizontal: () => void
  onFlipVertical: () => void
  onGreyscale: () => void
  onEnhance: () => void
  aiDisabled: boolean
  exportDisabled: boolean
  onOpenAi: () => void
  onCopy: () => void
  onSave: () => void
  onClose: () => void
  dragHandlers: ToolbarDragHandlers
}

export default function Toolbar({
  tool,
  onSelectTool,
  effectiveColor,
  onColorChange,
  range,
  statusText,
  onOpenHistory,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  clearDisabled,
  onClear,
  canEditImage,
  applyCropDisabled,
  cropClearDisabled,
  onApplyCrop,
  onClearCrop,
  onRotateLeft,
  onRotateRight,
  onFlipHorizontal,
  onFlipVertical,
  onGreyscale,
  onEnhance,
  aiDisabled,
  exportDisabled,
  onOpenAi,
  onCopy,
  onSave,
  onClose,
  dragHandlers
}: ToolbarProps) {
  return (
    <footer className="toolbar" {...dragHandlers}>
      <div className="toolbar-row">
        <div className="tool-group primary-tools">
          {TOOL_ITEMS.map((item) => {
            const Icon = item.icon
            return (
              <button
                key={item.key}
                className={`icon-button ${tool === item.key ? 'is-active' : ''}`}
                title={item.label}
                type="button"
                onClick={() => onSelectTool(item.key)}
              >
                <Icon size={18} />
              </button>
            )
          })}
        </div>
        <div className="status-line">{statusText}</div>
      </div>

      <div className="toolbar-row">
        <div className="tool-group color-group" aria-label="颜色">
          {COLORS.map((item) => (
            <button
              key={item}
              className={`swatch ${effectiveColor === item ? 'is-active' : ''}`}
              style={{ backgroundColor: item }}
              title={item}
              type="button"
              onClick={() => onColorChange(item)}
            />
          ))}
        </div>

        <label className="size-control" title={range.label}>
          <span>{range.label}</span>
          <strong>{range.value}</strong>
          <input
            min={range.min}
            max={range.max}
            type="range"
            value={clamp(range.value, range.min, range.max)}
            onChange={(event) => range.onChange(Number(event.target.value))}
            onPointerUp={() => range.onCommit?.()}
            onKeyUp={() => range.onCommit?.()}
          />
        </label>

        <div className="tool-group history-group">
          <button className="icon-button" title="截图历史" type="button" onClick={onOpenHistory}>
            <HistoryIcon size={18} />
          </button>
          <button className="icon-button" title="撤销" type="button" onClick={onUndo} disabled={!canUndo}>
            <Undo2 size={18} />
          </button>
          <button className="icon-button" title="重做" type="button" onClick={onRedo} disabled={!canRedo}>
            <Redo2 size={18} />
          </button>
          <button
            className="icon-button"
            title="清空标注"
            type="button"
            onClick={onClear}
            disabled={clearDisabled}
          >
            <Trash2 size={18} />
          </button>
        </div>

        <div className="tool-group adjust-group">
          <button
            className="icon-button"
            title="应用裁剪"
            type="button"
            onClick={onApplyCrop}
            disabled={applyCropDisabled}
          >
            <Crop size={17} />
          </button>
          <button
            className="icon-button"
            title="清除裁剪选区"
            type="button"
            onClick={onClearCrop}
            disabled={cropClearDisabled}
          >
            <X size={17} />
          </button>
          <button className="icon-button" title="向左旋转" type="button" onClick={onRotateLeft} disabled={!canEditImage}>
            <RotateCcw size={17} />
          </button>
          <button className="icon-button" title="向右旋转" type="button" onClick={onRotateRight} disabled={!canEditImage}>
            <RotateCw size={17} />
          </button>
          <button className="icon-button" title="水平翻转" type="button" onClick={onFlipHorizontal} disabled={!canEditImage}>
            <FlipHorizontal size={17} />
          </button>
          <button className="icon-button" title="垂直翻转" type="button" onClick={onFlipVertical} disabled={!canEditImage}>
            <FlipVertical size={17} />
          </button>
          <button className="icon-button" title="灰度" type="button" onClick={onGreyscale} disabled={!canEditImage}>
            <Circle size={17} />
          </button>
          <button className="icon-button" title="增强" type="button" onClick={onEnhance} disabled={!canEditImage}>
            <Sparkles size={17} />
          </button>
        </div>

        <div className="tool-group command-group">
          <button
            className="command-button ai-ask-button"
            type="button"
            title="在独立窗口里把这张截图发给 AI 解释 / 解题 / 提取文字 / 翻译 / 修图"
            onClick={onOpenAi}
            disabled={aiDisabled}
          >
            <Bot size={17} />
            问 AI
          </button>
          <button className="command-button" type="button" onClick={onCopy} disabled={exportDisabled}>
            <Clipboard size={17} />
            复制
          </button>
          <button className="command-button" type="button" onClick={onSave} disabled={exportDisabled}>
            <Save size={17} />
            保存
          </button>
          <button className="icon-button close-button" title="关闭" type="button" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
      </div>
    </footer>
  )
}

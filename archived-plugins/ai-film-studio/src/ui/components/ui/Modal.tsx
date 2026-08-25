/**
 * 模态 Modal/Dialog —— 基于 Radix Dialog（焦点陷阱 / Esc / 滚动锁 / role=dialog+aria-modal / 焦点归还全自动）+ 文本玻璃卡。
 * 遮罩无 backdrop-filter（性能，含动画 spinner 的画布在后），模糊只在卡片上。head(标题+关闭)/body(滚动)/footer 槽。
 * busy 时锁定关闭（Esc/外点/X 全屏蔽）。规格 docs §5.2；样式见 styles.css「Modal」。
 */
import * as RD from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import type { ReactNode } from 'react'

export interface ModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  children: ReactNode
  footer?: ReactNode
  size?: 'sheet' | 'wide' | 'confirm'
  busy?: boolean
  hideClose?: boolean
  description?: ReactNode
  className?: string
}

export default function Modal({ open, onOpenChange, title, children, footer, size = 'sheet', busy, hideClose, description, className }: ModalProps) {
  return (
    <RD.Root open={open} onOpenChange={onOpenChange}>
      <RD.Portal>
        <RD.Overlay className="afs-dialog__scrim" />
        {/* 独立居中层：Radix Overlay/Content 为兄弟节点，故用此层用 grid 居中卡片 */}
        <div className="afs-dialog__center">
          <RD.Content
            className={`afs-dialog${size !== 'sheet' ? ` afs-dialog--${size}` : ''}${className ? ' ' + className : ''}`}
            {...(description ? {} : { 'aria-describedby': undefined })}
            onEscapeKeyDown={(e) => {
              if (busy) e.preventDefault()
            }}
            onPointerDownOutside={(e) => {
              if (busy) e.preventDefault()
            }}
            onInteractOutside={(e) => {
              if (busy) e.preventDefault()
            }}
          >
            <div className="afs-dialog__head">
              <RD.Title className="afs-dialog__title">{title}</RD.Title>
              {!hideClose && (
                <RD.Close asChild>
                  <button className="afs-rv__close" aria-label="关闭" title="关闭" disabled={busy}>
                    <X size={18} />
                  </button>
                </RD.Close>
              )}
            </div>
            {description ? <RD.Description className="afs-dialog__desc">{description}</RD.Description> : null}
            <div className="afs-dialog__body nowheel">{children}</div>
            {footer ? <div className="afs-dialog__foot">{footer}</div> : null}
          </RD.Content>
        </div>
      </RD.Portal>
    </RD.Root>
  )
}

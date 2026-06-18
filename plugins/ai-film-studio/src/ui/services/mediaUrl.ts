/**
 * M6：媒体 URL 解析 hook（渲染侧统一出口）。
 * 复用 M3 在 assets.ts 建立的字节缓存 + blob: + LRU（不再造第二套缓存）：
 *   - 附件 assetId → blob:（assets.ts 字节缓存拥有其生命周期，组件绝不 revoke）
 *   - localPath   → file://（原生 range/seek，视频首选）
 *   - 临时 url(data:/blob:) → 原样（生成时瞬时即时显示）
 *   - 远程 url    → 原样透传
 * 配合 useInView：离屏 tile 不解析、不挂载真实 <img>/<video>，避免一次性铺开大量媒体。
 */
import { useEffect, useRef, useState, type RefObject } from 'react'
import { loadAssetUrl, isEphemeralUrl } from './assets'
import { toFileUrl } from './fsutil'

export interface MediaRef {
  assetId?: string
  localPath?: string
  url?: string
}

function initialUrl(ref?: MediaRef | null): string {
  if (!ref) return ''
  if (ref.localPath) return toFileUrl(ref.localPath)
  if (isEphemeralUrl(ref.url)) return ref.url as string
  return '' // assetId 异步解析；远程 url 在 effect 里赋值
}

/**
 * 解析媒体引用为可显示 URL。优先级：
 * localPath(file://) > 临时 url(data:/blob:，瞬时) > assetId(blob:) > 远程 url(透传)。
 * 附件 blob: 由 assets.ts 缓存拥有；本函数返回的 URL 调用方不可 revoke。
 */
export function useMediaUrl(ref?: MediaRef | null): string {
  const assetId = ref?.assetId
  const localPath = ref?.localPath
  const url = ref?.url
  const [resolved, setResolved] = useState<string>(() => initialUrl(ref))
  useEffect(() => {
    let on = true
    if (localPath) {
      setResolved(toFileUrl(localPath))
      return
    }
    if (isEphemeralUrl(url)) {
      setResolved(url as string)
      return
    }
    if (assetId) {
      void loadAssetUrl(assetId).then((u) => {
        if (on) setResolved(u || url || '')
      })
      return () => {
        on = false
      }
    }
    setResolved(url || '') // 远程 url 透传
    return () => {
      on = false
    }
  }, [assetId, localPath, url])
  return resolved
}

/**
 * 元素进入视口检测（共享 IntersectionObserver 语义，宽裕 rootMargin）。
 * 一旦可见即保持（disconnect），避免来回滚动反复卸载/重载导致闪烁；离屏的绘制开销由
 * CSS content-visibility:auto 兜住。无 IntersectionObserver 环境下退回「始终可见」。
 */
export function useInView<T extends Element>(rootMargin = '400px'): [RefObject<T>, boolean] {
  const ref = useRef<T>(null)
  const [inView, setInView] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || inView) return
    if (typeof IntersectionObserver === 'undefined') {
      setInView(true)
      return
    }
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setInView(true)
            obs.disconnect()
            break
          }
        }
      },
      { rootMargin }
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [rootMargin, inView])
  return [ref, inView]
}

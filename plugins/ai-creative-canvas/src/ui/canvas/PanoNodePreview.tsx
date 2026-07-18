import { useEffect, useRef, useState } from 'react'
import { X, Camera, RotateCw, RefreshCw } from 'lucide-react'
import type { Card } from '../types'
import { useGraph } from '../store/graphStore'
import { useUi } from '../store/uiStore'
import { useDialog } from '../store/dialogStore'
import { saveBase64 } from '../services/media'
import { toast } from '../store/toastStore'
import { isImeComposing } from '../util'

// 节点内 360 预览（取代旧全屏 PanoViewer）：uiStore.panoCardId 指向的全景卡把卡面图换成
// three.js 内壁球环视画布，直接在卡片里拖动环视、滚轮缩放；「截图」把当前视角高清落成新图片卡。
// three.js 仍动态 import 代码分割——仅开启预览时拉 three chunk，主包不变。
// 做法对齐 three 官方 webgl_panorama_equirectangular：内壁球 scale(-1,1,1) 从中心看不镜像；
// 抓取式拖动 + 阻尼(lerp) 治晕；FOV 35–90 默认 60；俯仰限 ±85；贴图 sRGB+各向异性+mipmap 治糊。

const FOV_DEFAULT = 60
const FOV_MIN = 35
const FOV_MAX = 90
const SNAP_W = 1600 // 截图重渲宽度（视角所见构图不变，仅提升分辨率）

export function PanoNodePreview({ card }: { card: Card }) {
  const url = card.assetUrl
  const mountRef = useRef<HTMLDivElement>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [auto, setAuto] = useState(false)
  const [shooting, setShooting] = useState(false)
  const autoRef = useRef(false)
  const resetRef = useRef<() => void>(() => {})
  const snapRef = useRef<() => string | null>(() => null)
  const close = () => useUi.getState().setPanoCardId(null)

  const snapshot = async () => {
    if (shooting || loading || err) return // 贴图未就绪/失败时截出来是纯黑帧；in-flight 防连点出重叠双卡
    const dataUrl = snapRef.current()
    const b64 = dataUrl?.split(',')[1]
    if (!dataUrl || !b64 || b64.length < 100) {
      toast('截图失败：画面尚未就绪', 'error') // toDataURL 异常/上下文丢失时返回空白帧
      return
    }
    setShooting(true)
    try {
      const g = useGraph.getState()
      const src = g.getCard(card.id)
      if (!src) return
      const boardId = g.boardIdOfCard(card.id)
      const saved = await saveBase64(g.project.id, `${card.id}_shot`, b64, 'png')
      const id = g.addCard(
        'image',
        { x: src.x + src.w + 200, y: src.y + src.h / 2 },
        { title: (src.title || '全景') + ' · 视角截图', status: 'done', refIds: [src.id], assetUrl: saved.url, assetLocalPath: saved.path, mime: 'image/png' },
        boardId
      )
      const now = useGraph.getState() // await 期间可能切板：以最新状态判断是否可选中
      if (boardId === now.project.activeBoardId) now.setSelection([id])
      toast('已截图为新图片卡', 'success')
    } catch (e: any) {
      toast('截图失败：' + (e?.message || String(e)), 'error')
    } finally {
      setShooting(false)
    }
  }

  useEffect(() => {
    if (!url) return
    let disposed = false
    let cleanup = () => {}
    // url 变化（重新生成/修复落新图）时重建整套栈：状态须一并复位，否则旧的错误浮层会盖住新画面
    setLoading(true)
    setErr(null)
    void (async () => {
      let THREE: typeof import('three')
      try {
        THREE = await import('three')
      } catch {
        if (!disposed) setErr('three.js 加载失败')
        return
      }
      const mount = mountRef.current
      if (disposed || !mount) return
      const W = mount.clientWidth || 1
      const H = mount.clientHeight || 1

      // preserveDrawingBuffer：卡片尺寸的小画布，代价可忽略；令 toDataURL 截图随时可用
      const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
      renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1))
      renderer.setSize(W, H)
      mount.appendChild(renderer.domElement)

      const scene = new THREE.Scene()
      const camera = new THREE.PerspectiveCamera(FOV_DEFAULT, W / H, 1, 1100)

      const geo = new THREE.SphereGeometry(500, 64, 40)
      geo.scale(-1, 1, 1) // 翻成内壁，从中心看不镜像

      const tex = new THREE.TextureLoader().load(
        url,
        () => { if (!disposed) setLoading(false) },
        undefined,
        () => { if (!disposed) { setErr('贴图加载失败'); setLoading(false) } }
      )
      tex.colorSpace = THREE.SRGBColorSpace
      tex.anisotropy = renderer.capabilities.getMaxAnisotropy() // 各向异性过滤 → 斜视更清晰
      const mat = new THREE.MeshBasicMaterial({ map: tex })
      const mesh = new THREE.Mesh(geo, mat)
      scene.add(mesh)

      let lon = 0
      let lat = 0
      let tLon = 0
      let tLat = 0
      let fov = FOV_DEFAULT
      let down = false
      let downX = 0
      let downY = 0
      let downLon = 0
      let downLat = 0
      const dom = renderer.domElement
      dom.style.touchAction = 'none'
      dom.style.cursor = 'grab'

      const applyCam = () => {
        const phi = THREE.MathUtils.degToRad(90 - lat)
        const theta = THREE.MathUtils.degToRad(lon)
        camera.lookAt(
          500 * Math.sin(phi) * Math.cos(theta),
          500 * Math.cos(phi),
          500 * Math.sin(phi) * Math.sin(theta)
        )
      }

      const onDown = (e: PointerEvent) => {
        e.stopPropagation() // 卡内环视拖动，不触发画布拖卡/框选
        down = true
        downX = e.clientX
        downY = e.clientY
        downLon = tLon
        downLat = tLat
        dom.style.cursor = 'grabbing'
        try { dom.setPointerCapture(e.pointerId) } catch { /* ignore */ }
      }
      const onMove = (e: PointerEvent) => {
        if (!down) return
        // 对齐 three 官方：右拖→lon 减、下拖→lat 增（抓取式，两轴一致）
        tLon = (downX - e.clientX) * 0.14 + downLon
        tLat = (e.clientY - downY) * 0.14 + downLat
      }
      const onUp = (e: PointerEvent) => {
        down = false
        dom.style.cursor = 'grab'
        try { dom.releasePointerCapture(e.pointerId) } catch { /* ignore */ }
      }
      const onWheel = (e: WheelEvent) => {
        e.preventDefault()
        e.stopPropagation() // 预览内滚轮改 FOV，不缩放画布
        fov = Math.max(FOV_MIN, Math.min(FOV_MAX, fov + e.deltaY * 0.05))
        camera.fov = fov
        camera.updateProjectionMatrix()
      }
      dom.addEventListener('pointerdown', onDown)
      dom.addEventListener('pointermove', onMove)
      dom.addEventListener('pointerup', onUp)
      dom.addEventListener('pointercancel', onUp)
      dom.addEventListener('wheel', onWheel, { passive: false })

      resetRef.current = () => {
        tLon = 0
        tLat = 0
        fov = FOV_DEFAULT
        camera.fov = FOV_DEFAULT
        camera.updateProjectionMatrix()
      }
      // 截图：临时放大重渲（保持画幅比例 → 所见即所得），取帧后恢复卡面尺寸。
      // pixelRatio 临时归 1：否则 retina 下 drawingBuffer 是 SNAP_W×dpr（3200px），输出尺寸随设备漂移
      snapRef.current = () => {
        try {
          const cw = mount.clientWidth || 1
          const ch = mount.clientHeight || 1
          const pr = renderer.getPixelRatio()
          const sw = SNAP_W
          const sh = Math.max(1, Math.round((SNAP_W * ch) / cw))
          renderer.setPixelRatio(1)
          renderer.setSize(sw, sh, false)
          applyCam()
          renderer.render(scene, camera)
          const dataUrl = renderer.domElement.toDataURL('image/png')
          renderer.setPixelRatio(pr)
          renderer.setSize(cw, ch, false)
          renderer.render(scene, camera)
          return dataUrl
        } catch {
          return null
        }
      }

      let raf = 0
      const animate = () => {
        raf = requestAnimationFrame(animate)
        if (autoRef.current && !down) tLon += 0.06
        lon += (tLon - lon) * 0.12 // 阻尼：平滑跟随，减轻眩晕
        lat += (tLat - lat) * 0.12
        lat = Math.max(-85, Math.min(85, lat))
        tLat = Math.max(-85, Math.min(85, tLat))
        applyCam()
        renderer.render(scene, camera)
      }
      animate()

      const ro = new ResizeObserver(() => {
        const w = mount.clientWidth || 1
        const h = mount.clientHeight || 1
        renderer.setSize(w, h)
        camera.aspect = w / h
        camera.updateProjectionMatrix()
      })
      ro.observe(mount)

      cleanup = () => {
        cancelAnimationFrame(raf)
        ro.disconnect()
        dom.removeEventListener('pointerdown', onDown)
        dom.removeEventListener('pointermove', onMove)
        dom.removeEventListener('pointerup', onUp)
        dom.removeEventListener('pointercancel', onUp)
        dom.removeEventListener('wheel', onWheel)
        snapRef.current = () => null
        tex.dispose()
        geo.dispose()
        mat.dispose()
        renderer.dispose()
        renderer.forceContextLoss() // dispose 不释放 WebGL 上下文（懒 GC，浏览器 ~16 个上限）；与 DirectorStage 同款
        if (dom.parentNode) dom.parentNode.removeChild(dom)
      }
    })()
    return () => {
      disposed = true
      cleanup()
    }
  }, [url])

  // Esc 退出预览。预览不算模态，但 Esc 要让位：模态/对话框/右键菜单开着时归它们关；
  // 输入框聚焦或 IME 组合期不退（Esc 意在取消候选/失焦）。画布 Esc 的清选中会一并执行，可接受。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || isImeComposing(e)) return
      const ui = useUi.getState()
      if (ui.anyModalOpen() || ui.ctxMenu || useDialog.getState().current) return
      const el = document.activeElement as HTMLElement | null
      const tag = (el?.tagName || '').toLowerCase()
      if (tag === 'input' || tag === 'textarea' || el?.isContentEditable) return
      ui.setPanoCardId(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (!url) return null
  return (
    <div data-interactive className="absolute inset-0 bg-black" onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      <div ref={mountRef} className="absolute inset-0" />
      {loading && !err && <div className="absolute inset-0 grid place-items-center text-white/70 text-xs pointer-events-none">正在加载全景…</div>}
      {err && <div className="absolute inset-0 grid place-items-center text-red-300 text-xs pointer-events-none">{err}</div>}
      <div className="absolute top-1 right-1 z-20 flex items-center gap-1">
        <button
          onClick={() => { const v = !auto; setAuto(v); autoRef.current = v }}
          title="自动旋转"
          className={`w-6 h-6 grid place-items-center rounded-md text-white ${auto ? 'bg-cyan-600' : 'bg-black/55 hover:bg-black/75'}`}
        >
          <RotateCw size={12} />
        </button>
        <button onClick={() => resetRef.current()} title="复位视角" className="w-6 h-6 grid place-items-center rounded-md bg-black/55 hover:bg-black/75 text-white">
          <RefreshCw size={12} />
        </button>
        <button
          onClick={() => void snapshot()}
          disabled={loading || !!err || shooting}
          title={loading || err ? '贴图未就绪，暂不可截图' : '截取当前视角 → 新图片卡'}
          className="w-6 h-6 grid place-items-center rounded-md bg-black/55 hover:bg-black/75 text-white disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Camera size={12} />
        </button>
        <button onClick={close} title="退出预览（Esc）" className="w-6 h-6 grid place-items-center rounded-md bg-black/55 hover:bg-black/75 text-white">
          <X size={13} />
        </button>
      </div>
      <div className="absolute bottom-1 left-1.5 text-[9px] text-white/70 pointer-events-none">拖动环视 · 滚轮缩放</div>
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'
import { X, Compass, RotateCw, RefreshCw } from 'lucide-react'
import { useGraph } from '../store/graphStore'
import { useUi } from '../store/uiStore'

// three.js 等距柱状全景查看器（动态 import 代码分割——仅打开时拉 three chunk，主包不变）。
// 做法对齐 three 官方 webgl_panorama_equirectangular：内壁球 scale(-1,1,1) 从中心看不镜像；
// 抓取式拖动 + 阻尼(lerp) 治晕；FOV 35–90 默认 60；俯仰限 ±85；贴图 sRGB+各向异性+mipmap 治糊。

const FOV_DEFAULT = 60
const FOV_MIN = 35
const FOV_MAX = 90

export function PanoViewer() {
  const id = useUi((s) => s.panoCardId)
  const url = useGraph((s) => (id ? s.getActiveBoard().cards[id]?.assetUrl : null))
  if (!id || !url) return null
  return <Inner url={url} />
}

function Inner({ url }: { url: string }) {
  const mountRef = useRef<HTMLDivElement>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [auto, setAuto] = useState(false)
  const autoRef = useRef(false)
  const resetRef = useRef<() => void>(() => {})
  const close = () => useUi.getState().setPanoCardId(null)

  useEffect(() => {
    let disposed = false
    let cleanup = () => {}
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

      const renderer = new THREE.WebGLRenderer({ antialias: true })
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

      const onDown = (e: PointerEvent) => {
        down = true
        downX = e.clientX
        downY = e.clientY
        downLon = tLon
        downLat = tLat
        try { dom.setPointerCapture(e.pointerId) } catch { /* ignore */ }
      }
      const onMove = (e: PointerEvent) => {
        if (!down) return
        // 对齐 three 官方：右拖→lon 减、下拖→lat 增（抓取式，两轴一致）
        tLon = (downX - e.clientX) * 0.1 + downLon
        tLat = (e.clientY - downY) * 0.1 + downLat
      }
      const onUp = (e: PointerEvent) => {
        down = false
        try { dom.releasePointerCapture(e.pointerId) } catch { /* ignore */ }
      }
      const onWheel = (e: WheelEvent) => {
        e.preventDefault()
        fov = Math.max(FOV_MIN, Math.min(FOV_MAX, fov + e.deltaY * 0.05))
        camera.fov = fov
        camera.updateProjectionMatrix()
      }
      dom.addEventListener('pointerdown', onDown)
      dom.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      dom.addEventListener('wheel', onWheel, { passive: false })

      resetRef.current = () => {
        tLon = 0
        tLat = 0
        fov = FOV_DEFAULT
        camera.fov = FOV_DEFAULT
        camera.updateProjectionMatrix()
      }

      let raf = 0
      const animate = () => {
        raf = requestAnimationFrame(animate)
        if (autoRef.current && !down) tLon += 0.06
        lon += (tLon - lon) * 0.12 // 阻尼：平滑跟随，减轻眩晕
        lat += (tLat - lat) * 0.12
        lat = Math.max(-85, Math.min(85, lat))
        tLat = Math.max(-85, Math.min(85, tLat))
        const phi = THREE.MathUtils.degToRad(90 - lat)
        const theta = THREE.MathUtils.degToRad(lon)
        camera.lookAt(
          500 * Math.sin(phi) * Math.cos(theta),
          500 * Math.cos(phi),
          500 * Math.sin(phi) * Math.sin(theta)
        )
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
        window.removeEventListener('pointerup', onUp)
        dom.removeEventListener('wheel', onWheel)
        tex.dispose()
        geo.dispose()
        mat.dispose()
        renderer.dispose()
        if (dom.parentNode) dom.parentNode.removeChild(dom)
      }
    })()
    return () => {
      disposed = true
      cleanup()
    }
  }, [url])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') useUi.getState().setPanoCardId(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="fixed inset-0 z-[90] bg-black" data-interactive>
      <div ref={mountRef} className="absolute inset-0 cursor-grab active:cursor-grabbing" style={{ touchAction: 'none' }} />
      {loading && !err && <div className="absolute inset-0 grid place-items-center text-white/70 text-sm pointer-events-none">正在加载全景…</div>}
      {err && <div className="absolute inset-0 grid place-items-center text-red-300 text-sm">{err}</div>}
      <div className="absolute top-3 left-3 flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-black/55 text-white text-xs pointer-events-none">
        <Compass size={14} className="text-emerald-400" /> 360 全景 · 拖动环视 · 滚轮缩放
      </div>
      <div className="absolute top-3 right-3 flex items-center gap-1.5">
        <button
          onClick={() => { const v = !auto; setAuto(v); autoRef.current = v }}
          title="自动旋转"
          className={`w-8 h-8 grid place-items-center rounded-lg text-white ${auto ? 'bg-emerald-600' : 'bg-black/55 hover:bg-black/70'}`}
        >
          <RotateCw size={15} />
        </button>
        <button onClick={() => resetRef.current()} title="复位视角" className="w-8 h-8 grid place-items-center rounded-lg bg-black/55 hover:bg-black/70 text-white">
          <RefreshCw size={15} />
        </button>
        <button onClick={close} title="关闭（Esc）" className="w-8 h-8 grid place-items-center rounded-lg bg-black/55 hover:bg-black/70 text-white">
          <X size={16} />
        </button>
      </div>
    </div>
  )
}

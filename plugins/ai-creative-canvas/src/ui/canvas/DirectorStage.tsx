import { useEffect, useRef, useState } from 'react'
import { X, Loader2, Film, User, Box as BoxIcon, Move, Rotate3d, Trash2, Copy, Crosshair } from 'lucide-react'
import { useGraph } from '../store/graphStore'
import { useUi } from '../store/uiStore'
import { toast } from '../store/toastStore'

// 3D 导演台 v1：three 场景里摆人台/道具 + 摆机位（焦段/镜别/角度）→ 视口截图当 img2img 参考 +
// 结构化镜头提示词 → 生成图像卡。three 动态分割，主包不增。人台=程序化人形(胶囊/球，零资源)。

const FILM_GAUGE = 36 // 35mm 全画幅

export function DirectorStage() {
  const show = useUi((s) => s.showDirector)
  if (!show) return null
  return <Inner />
}

interface Subject {
  obj: any
  kind: string
}

function Inner() {
  const mountRef = useRef<HTMLDivElement>(null)
  const api = useRef<any>({})
  const [ready, setReady] = useState(false)
  const [focal, setFocal] = useState(35)
  const [mode, setMode] = useState<'translate' | 'rotate'>('translate')
  const [hasSel, setHasSel] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState(false)
  const [shots, setShots] = useState<{ id: string; name: string; cam: any }[]>([])
  const saveScene = () => {
    try {
      const only = api.current.serializeSceneOnly?.()
      if (only) useGraph.getState().setDirectorScene({ subjects: only.subjects, cam: only.cam, shots, prompt })
    } catch { /* ignore */ }
  }
  const close = () => {
    if (busy) return
    saveScene()
    useUi.getState().setShowDirector(false)
  }
  const closeRef = useRef(close)
  closeRef.current = close

  useEffect(() => {
    let disposed = false
    let cleanup = () => {}
    void (async () => {
      let THREE: typeof import('three')
      let OrbitControls: any
      let TransformControls: any
      try {
        THREE = await import('three')
        OrbitControls = (await import('three/examples/jsm/controls/OrbitControls.js')).OrbitControls
        TransformControls = (await import('three/examples/jsm/controls/TransformControls.js')).TransformControls
      } catch {
        return
      }
      const mount = mountRef.current
      if (disposed || !mount) return
      try {
      const W = mount.clientWidth || 1
      const H = mount.clientHeight || 1

      const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
      renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1))
      renderer.setSize(W, H)
      mount.appendChild(renderer.domElement)

      const scene = new THREE.Scene()
      scene.background = new THREE.Color(0x1b1d23)
      const cam = new THREE.PerspectiveCamera(50, W / H, 0.05, 1000)
      cam.filmGauge = FILM_GAUGE
      cam.position.set(0, 1.5, 4)
      cam.setFocalLength(35)

      scene.add(new THREE.HemisphereLight(0xffffff, 0x404050, 1.1))
      const dir = new THREE.DirectionalLight(0xffffff, 1.0)
      dir.position.set(3, 6, 4)
      scene.add(dir)
      const grid = new THREE.GridHelper(20, 20, 0x445566, 0x2a3340)
      scene.add(grid)
      const ground = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.MeshStandardMaterial({ color: 0x23272f, roughness: 1 }))
      ground.rotation.x = -Math.PI / 2
      ground.position.y = -0.001
      scene.add(ground)
      const depthMat = new THREE.MeshDepthMaterial({ depthPacking: THREE.BasicDepthPacking }) // 深度控制图

      const orbit = new OrbitControls(cam, renderer.domElement)
      orbit.enableDamping = true
      orbit.target.set(0, 1, 0)
      const tcontrol = new TransformControls(cam, renderer.domElement)
      tcontrol.addEventListener('dragging-changed', (e: any) => { orbit.enabled = !e.value })
      // three r0.169：TransformControls 不再是 Object3D，需把它的 helper 加进场景
      const tHelper = typeof tcontrol.getHelper === 'function' ? tcontrol.getHelper() : tcontrol
      scene.add(tHelper)

      const subjects: Subject[] = []
      const raycaster = new THREE.Raycaster()
      const ndc = new THREE.Vector2()

      // 可摆姿人台：root=整体；各 joint 组绕关节旋转摆姿（旋转模式点关节即可）
      const makeMannequin = (color: number) => {
        const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.6 })
        const mesh = (geo: any, y = 0) => { const m = new THREE.Mesh(geo, mat); m.position.y = y; return m }
        const joint = (name: string, x: number, y: number, z: number) => { const g = new THREE.Group(); g.position.set(x, y, z); g.userData.joint = name; return g }
        const root = new THREE.Group()
        root.userData.kind = '人台'
        const hips = new THREE.Group(); hips.position.set(0, 0.9, 0); root.add(hips) // 结构组
        const chest = new THREE.Group(); chest.position.set(0, 0.02, 0); hips.add(chest)
        chest.add(mesh(new THREE.CapsuleGeometry(0.17, 0.4, 4, 10), 0.22))
        const head = joint('头', 0, 0.5, 0); chest.add(head)
        head.add(mesh(new THREE.SphereGeometry(0.13, 18, 16), 0.13))
        const arm = (side: 'L' | 'R') => {
          const sh = joint(side === 'L' ? '左肩' : '右肩', side === 'L' ? -0.22 : 0.22, 0.42, 0); chest.add(sh)
          sh.add(mesh(new THREE.CapsuleGeometry(0.055, 0.26, 4, 8), -0.17))
          const el = joint(side === 'L' ? '左肘' : '右肘', 0, -0.34, 0); sh.add(el)
          el.add(mesh(new THREE.CapsuleGeometry(0.05, 0.24, 4, 8), -0.16))
        }
        arm('L'); arm('R')
        const leg = (side: 'L' | 'R') => {
          const hp = joint(side === 'L' ? '左髋' : '右髋', side === 'L' ? -0.1 : 0.1, 0, 0); hips.add(hp)
          hp.add(mesh(new THREE.CapsuleGeometry(0.075, 0.32, 4, 8), -0.22))
          const kn = joint(side === 'L' ? '左膝' : '右膝', 0, -0.44, 0); hp.add(kn)
          kn.add(mesh(new THREE.CapsuleGeometry(0.07, 0.3, 4, 8), -0.2))
        }
        leg('L'); leg('R')
        return root
      }
      let curRoot: any = null
      let curJoint: any = null // 当前点选的关节（旋转用）；null=操作整体
      let curMode: 'translate' | 'rotate' = 'translate'
      const attachByMode = () => {
        if (!curRoot) { tcontrol.detach(); return }
        tcontrol.attach(curMode === 'rotate' && curJoint ? curJoint : curRoot)
      }
      const select = (root: any | null, jnt: any | null) => {
        curRoot = root
        curJoint = jnt
        attachByMode()
        if (!disposed) setHasSel(!!root)
      }
      const addMannequin = () => {
        const g = makeMannequin(0xc7ccd6)
        g.position.set((subjects.length % 3) * 0.9 - 0.9, 0, 0)
        scene.add(g)
        subjects.push({ obj: g, kind: '人台' })
        select(g, null)
      }
      const addProp = () => {
        const m = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), new THREE.MeshStandardMaterial({ color: 0x8a93a6, roughness: 0.8 }))
        m.position.set(0.7, 0.25, 0.6)
        m.userData.kind = '道具'
        scene.add(m)
        subjects.push({ obj: m, kind: '道具' })
        select(m, null)
      }
      const removeSelected = () => {
        if (!curRoot) return
        tcontrol.detach()
        scene.remove(curRoot)
        const i = subjects.findIndex((s) => s.obj === curRoot)
        if (i >= 0) subjects.splice(i, 1)
        select(null, null)
      }
      const duplicateSelected = () => {
        if (!curRoot) return
        const clone = curRoot.clone(true)
        clone.position.x += 0.7
        scene.add(clone)
        subjects.push({ obj: clone, kind: curRoot.userData.kind || '人台' })
        select(clone, null)
      }
      const lookAtSelected = () => {
        if (!curRoot) return
        const p = new THREE.Vector3()
        curRoot.getWorldPosition(p)
        orbit.target.set(p.x, p.y + 0.9, p.z)
      }

      const onPointerDown = (e: PointerEvent) => {
        if (tcontrol.dragging) return
        const r = renderer.domElement.getBoundingClientRect()
        ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
        raycaster.setFromCamera(ndc, cam)
        const hits = raycaster.intersectObjects(subjects.map((s) => s.obj), true)
        if (!hits.length) return
        let o: any = hits[0].object
        let jnt: any = null
        let root: any = null
        while (o) {
          if (!jnt && o.userData && o.userData.joint) jnt = o
          if (subjects.some((s) => s.obj === o)) { root = o; break }
          o = o.parent
        }
        if (root) select(root, jnt)
      }
      renderer.domElement.addEventListener('pointerdown', onPointerDown)

      let raf = 0
      const animate = () => {
        raf = requestAnimationFrame(animate)
        orbit.update()
        renderer.render(scene, cam)
      }
      animate()
      const ro = new ResizeObserver(() => {
        const w = mount.clientWidth || 1
        const h = mount.clientHeight || 1
        renderer.setSize(w, h)
        cam.aspect = w / h
        cam.updateProjectionMatrix()
      })
      ro.observe(mount)

      // ── v3：序列化/恢复、机位读写、深度控制图 ──
      const getCam = () => ({
        pos: [cam.position.x, cam.position.y, cam.position.z] as [number, number, number],
        target: [orbit.target.x, orbit.target.y, orbit.target.z] as [number, number, number],
        focal: cam.getFocalLength()
      })
      const applyCam = (c: any) => {
        cam.position.set(c.pos[0], c.pos[1], c.pos[2])
        orbit.target.set(c.target[0], c.target[1], c.target[2])
        cam.setFocalLength(c.focal)
        cam.updateProjectionMatrix()
      }
      const buildFromState = (st: any) => {
        const obj: any = st.kind === '道具'
          ? new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), new THREE.MeshStandardMaterial({ color: 0x8a93a6, roughness: 0.8 }))
          : makeMannequin(0xc7ccd6)
        obj.position.set(st.pos[0], st.pos[1], st.pos[2])
        obj.rotation.set(st.rot[0], st.rot[1], st.rot[2])
        obj.scale.setScalar(st.scale || 1)
        obj.userData.kind = st.kind
        if (st.joints) obj.traverse((c: any) => { const j = c.userData && c.userData.joint; if (j && st.joints[j]) c.rotation.set(st.joints[j][0], st.joints[j][1], st.joints[j][2]) })
        scene.add(obj)
        subjects.push({ obj, kind: st.kind })
      }
      const serializeSceneOnly = () => ({
        subjects: subjects.map((s) => {
          const o: any = s.obj
          const joints: Record<string, [number, number, number]> = {}
          if (s.kind === '人台') o.traverse((c: any) => { const j = c.userData && c.userData.joint; if (j) joints[j] = [c.rotation.x, c.rotation.y, c.rotation.z] })
          return { kind: s.kind, pos: [o.position.x, o.position.y, o.position.z] as [number, number, number], rot: [o.rotation.x, o.rotation.y, o.rotation.z] as [number, number, number], scale: o.scale.x, joints: s.kind === '人台' ? joints : undefined }
        }),
        cam: getCam()
      })
      const captureDepth = (): string => {
        tcontrol.detach()
        const pf = cam.far
        cam.far = 14
        cam.updateProjectionMatrix()
        const pbg = scene.background
        scene.background = new THREE.Color(0x000000)
        scene.overrideMaterial = depthMat
        renderer.render(scene, cam)
        scene.overrideMaterial = null as any
        scene.background = pbg
        cam.far = pf
        cam.updateProjectionMatrix()
        const cw = renderer.domElement.width
        const ch = renderer.domElement.height
        const c = document.createElement('canvas')
        c.width = cw
        c.height = ch
        const cx = c.getContext('2d')!
        cx.drawImage(renderer.domElement, 0, 0)
        const idata = cx.getImageData(0, 0, cw, ch)
        const dd = idata.data
        for (let i = 0; i < dd.length; i += 4) { const v = 255 - dd[i]; dd[i] = v; dd[i + 1] = v; dd[i + 2] = v; dd[i + 3] = 255 } // 反相：近=亮（controlnet-depth 约定）
        cx.putImageData(idata, 0, 0)
        attachByMode()
        return c.toDataURL('image/png')
      }

      // 恢复持久化场景，否则放一个默认人台
      const saved0 = useGraph.getState().project.director
      if (saved0 && Array.isArray(saved0.subjects) && saved0.subjects.length) {
        saved0.subjects.forEach(buildFromState)
        if (saved0.cam) applyCam(saved0.cam)
        select(null, null)
        if (!disposed) {
          setShots(saved0.shots || [])
          if (saved0.prompt) setPrompt(saved0.prompt)
          setFocal(Math.round((saved0.cam && saved0.cam.focal) || 35))
        }
      } else {
        addMannequin()
      }

      // 由相机几何 + 主体布局推导结构化镜头提示词
      const shotFragment = (): string => {
        const target = orbit.target
        const d = cam.position.distanceTo(target)
        const dy = cam.position.y - target.y
        const ang = Math.asin(Math.max(-1, Math.min(1, dy / Math.max(0.001, d)))) * 180 / Math.PI
        const f = cam.getFocalLength()
        const lens = f < 28 ? '广角镜头(wide-angle)' : f <= 50 ? '标准镜头(normal)' : f <= 85 ? '中长焦(short telephoto)' : '长焦(telephoto)'
        const angle = ang > 18 ? '俯拍(high angle)' : ang < -12 ? '仰拍(low angle)' : '平视(eye level)'
        const shot = d < 1.6 ? '特写(close-up)' : d < 3.2 ? '中景(medium shot)' : d < 6 ? '全景(full shot)' : '远景(wide shot)'
        const people = subjects.filter((s) => s.kind === '人台')
        const v = new THREE.Vector3()
        const layout = people
          .map((s, i) => {
            s.obj.getWorldPosition(v)
            v.project(cam)
            if (!isFinite(v.x) || v.z > 1 || Math.abs(v.x) > 1.3) return ''
            const where = v.x < -0.25 ? '居左' : v.x > 0.25 ? '居右' : '居中'
            return `角色${i + 1}${where}`
          })
          .filter(Boolean)
          .join('，')
        const count = people.length ? `画面中有 ${people.length} 个角色（${layout || '居中'}）。` : ''
        return `镜头：${lens}，${Math.round(f)}mm，${angle}，${shot}。${count}`
      }

      api.current = {
        addMannequin,
        addProp,
        removeSelected,
        duplicateSelected,
        lookAtSelected,
        setMode: (m: 'translate' | 'rotate') => { curMode = m; tcontrol.setMode(m); attachByMode() },
        setFocal: (mm: number) => cam.setFocalLength(mm),
        // 镜别预设：沿当前视线方向调整相机到 target 的距离
        shotSize: (kind: 'cu' | 'ms' | 'fs') => {
          const dist = kind === 'cu' ? 1.3 : kind === 'ms' ? 2.6 : 5
          const v = cam.position.clone().sub(orbit.target).normalize().multiplyScalar(dist)
          cam.position.copy(orbit.target).add(v)
        },
        angle: (kind: 'low' | 'eye' | 'high') => {
          const flat = new THREE.Vector3(cam.position.x - orbit.target.x, 0, cam.position.z - orbit.target.z)
          const horiz = flat.length() || 2.6
          const y = kind === 'low' ? 0.4 : kind === 'eye' ? orbit.target.y : orbit.target.y + horiz * 0.9
          cam.position.set(orbit.target.x + flat.x, y, orbit.target.z + flat.z)
        },
        capture: (): string => {
          tcontrol.detach()
          renderer.render(scene, cam)
          const url = renderer.domElement.toDataURL('image/png')
          attachByMode()
          return url
        },
        captureDepth,
        getCam,
        applyCam,
        serializeSceneOnly,
        shotFragment
      }
      if (!disposed) setReady(true)

      cleanup = () => {
        // 逐步兜底：r169 的 tcontrol.dispose() 在此会抛 this.traverse，不能让它中断卸载
        const safe = (fn: () => void) => { try { fn() } catch { /* ignore */ } }
        safe(() => cancelAnimationFrame(raf))
        safe(() => ro.disconnect())
        safe(() => renderer.domElement.removeEventListener('pointerdown', onPointerDown))
        safe(() => tcontrol.detach())
        safe(() => scene.remove(tHelper))
        safe(() => tcontrol.dispose())
        safe(() => orbit.dispose())
        safe(() => renderer.dispose())
        safe(() => { if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement) })
      }
      } catch (err) {
        console.error('[DirectorStage] setup failed', err)
      }
    })()
    return () => {
      disposed = true
      cleanup()
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const onFocal = (mm: number) => {
    setFocal(mm)
    api.current.setFocal?.(mm)
  }
  const onMode = (m: 'translate' | 'rotate') => {
    setMode(m)
    api.current.setMode?.(m)
  }

  // 单次生成（placeIndex 用于批量时把成片排成一行）。返回是否成功。
  const doGenerate = async (placeIndex: number): Promise<boolean> => {
    const proj = useGraph.getState().project
    const controlModel = proj.defaultControlModel
    const model = controlModel || proj.defaultImageModel
    if (!model) {
      toast('请在工程设置（顶栏 ⚙）选「默认图像模型」或「ControlNet 控制模型」', 'error')
      return false
    }
    try {
      const ai = (window as any).mulby.ai
      const useControl = !!controlModel
      const dataUrl = (useControl ? api.current.captureDepth() : api.current.capture()) as string
      const b64 = dataUrl.split(',')[1]
      const bin = atob(b64)
      const buf = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i)
      const att = await ai.attachments.upload({ buffer: buf.buffer, mimeType: 'image/png', purpose: 'image' })
      const note = useControl
        ? '【输入为 3D 导演台导出的深度控制图：请严格据此构图、机位、人物站位与姿态，渲染为成片画面。】'
        : '【以上为 3D 导演台的机位/构图参考（灰色人台=角色站位/姿态），请据此构图与镜头渲染成片，忽略灰模材质。】'
      const full = `${prompt.trim()}\n\n${api.current.shotFragment()}${note}`
      const res = await ai.images.edit({ model, imageAttachmentId: att.attachmentId, prompt: full })
      const out = res?.images?.[0]
      if (!out) throw new Error('模型未返回图像')
      const { saveBase64 } = await import('../services/media')
      const g = useGraph.getState()
      const boardId = g.project.activeBoardId
      const saved = await saveBase64(g.project.id, `director_${Date.now()}_${placeIndex}`, out, 'png')
      const vp = g.getActiveBoard().viewport
      const wx = (-vp.x + 360) / vp.zoom + placeIndex * 340
      const wy = (-vp.y + 320) / vp.zoom
      g.addCard('image', { x: wx, y: wy }, { title: '导演台成片', status: 'done', modelId: model, prompt: prompt.trim(), assetUrl: saved.url, assetLocalPath: saved.path, mime: 'image/png' }, boardId)
      return true
    } catch (e: any) {
      toast('生成失败：' + (e?.message || String(e)), 'error')
      return false
    }
  }

  const run = async () => {
    if (!prompt.trim()) { toast('请先填写场景/角色描述', 'error'); return }
    setBusy(true)
    const ok = await doGenerate(0)
    setBusy(false)
    if (ok) toast('已生成（导演台）', 'success')
  }

  const batchGenerate = async () => {
    if (!prompt.trim()) { toast('请先填写场景/角色描述', 'error'); return }
    if (!shots.length) { toast('请先「记录机位」添加 shot', 'error'); return }
    setBusy(true)
    let ok = 0
    for (let i = 0; i < shots.length; i++) {
      api.current.applyCam?.(shots[i].cam)
      if (await doGenerate(i)) ok++
    }
    setBusy(false)
    toast(`已生成 ${ok}/${shots.length} 个机位`, ok ? 'success' : 'error')
  }

  const addShot = () => {
    const cam = api.current.getCam?.()
    if (!cam) return
    setShots((s) => [...s, { id: 'shot_' + Date.now().toString(36), name: `机位${s.length + 1}`, cam }])
  }
  const applyShot = (sh: { cam: any }) => {
    api.current.applyCam?.(sh.cam)
    setFocal(Math.round(sh.cam?.focal || 35))
  }
  const delShot = (id: string) => setShots((s) => s.filter((x) => x.id !== id))

  const Btn = ({ on, onClick, children, title }: { on?: boolean; onClick: () => void; children: any; title: string }) => (
    <button onClick={onClick} title={title} className={`px-2 py-1 rounded-md text-xs flex items-center gap-1 ${on ? 'bg-indigo-600 text-white' : 'bg-white/10 hover:bg-white/20 text-white'}`}>
      {children}
    </button>
  )

  return (
    <div className="fixed inset-0 z-[90] bg-black flex flex-col" data-interactive>
      <div ref={mountRef} className="absolute inset-0" style={{ touchAction: 'none' }} />
      {!ready && <div className="absolute inset-0 grid place-items-center text-white/70 text-sm pointer-events-none">正在加载 3D 导演台…</div>}

      {/* 顶部工具栏 */}
      <div className="absolute top-3 left-3 right-3 flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-black/55">
          <Film size={14} className="text-indigo-400" />
          <span className="text-white text-xs font-medium">3D 导演台</span>
        </div>
        <Btn onClick={() => api.current.addMannequin?.()} title="添加人台"><User size={13} /> 人台</Btn>
        <Btn onClick={() => api.current.addProp?.()} title="添加道具"><BoxIcon size={13} /> 道具</Btn>
        <Btn on={mode === 'translate'} onClick={() => onMode('translate')} title="移动整体"><Move size={13} /> 移动</Btn>
        <Btn on={mode === 'rotate'} onClick={() => onMode('rotate')} title="旋转（旋转模式下点关节可摆姿）"><Rotate3d size={13} /> 旋转/摆姿</Btn>
        {hasSel && <Btn onClick={() => api.current.duplicateSelected?.()} title="复制选中"><Copy size={13} /> 复制</Btn>}
        {hasSel && <Btn onClick={() => api.current.lookAtSelected?.()} title="相机看向选中"><Crosshair size={13} /> 看向</Btn>}
        {hasSel && <Btn onClick={() => api.current.removeSelected?.()} title="删除选中"><Trash2 size={13} /> 删除</Btn>}
        <div className="ml-auto" />
        <button onClick={close} className="w-8 h-8 grid place-items-center rounded-lg bg-black/55 hover:bg-black/70 text-white"><X size={16} /></button>
      </div>

      {/* 机位/镜别 */}
      <div className="absolute top-14 left-3 flex flex-col gap-2 w-52 p-2.5 rounded-lg bg-black/55 text-white text-xs">
        <div className="flex items-center gap-2">
          <span className="opacity-60 w-10">焦段</span>
          <input type="range" min={18} max={135} value={focal} onChange={(e) => onFocal(Number(e.target.value))} className="flex-1" />
          <span className="w-10 text-right tabular-nums">{focal}mm</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="opacity-60 w-10">预设</span>
          {[24, 35, 50, 85].map((mm) => <Btn key={mm} on={focal === mm} onClick={() => onFocal(mm)} title={`${mm}mm`}>{mm}</Btn>)}
        </div>
        <div className="flex items-center gap-1">
          <span className="opacity-60 w-10">镜别</span>
          <Btn onClick={() => api.current.shotSize?.('cu')} title="特写">特写</Btn>
          <Btn onClick={() => api.current.shotSize?.('ms')} title="中景">中景</Btn>
          <Btn onClick={() => api.current.shotSize?.('fs')} title="全景">全景</Btn>
        </div>
        <div className="flex items-center gap-1">
          <span className="opacity-60 w-10">角度</span>
          <Btn onClick={() => api.current.angle?.('low')} title="仰拍">仰拍</Btn>
          <Btn onClick={() => api.current.angle?.('eye')} title="平视">平视</Btn>
          <Btn onClick={() => api.current.angle?.('high')} title="俯拍">俯拍</Btn>
        </div>
        <div className="opacity-50 leading-snug">拖拽空白=转相机 · 滚轮推拉 · 点人台=选中 · 移动=挪整体 · 旋转/摆姿模式下点关节(肩/肘/髋/膝/头)可掰姿势</div>
      </div>

      {/* 多机位 shot list */}
      <div className="absolute top-14 right-3 flex flex-col gap-1.5 w-44 p-2.5 rounded-lg bg-black/55 text-white text-xs">
        <div className="flex items-center justify-between">
          <span className="opacity-70 font-medium">机位列表（{shots.length}）</span>
          <Btn onClick={addShot} title="把当前机位记为一个 shot">+记录</Btn>
        </div>
        <div className="flex flex-col gap-1 max-h-40 overflow-auto ace-scroll">
          {shots.map((s) => (
            <div key={s.id} className="flex items-center gap-1">
              <button onClick={() => applyShot(s)} className="flex-1 text-left px-1.5 py-1 rounded bg-white/10 hover:bg-white/20 truncate" title="切到此机位">{s.name}</button>
              <button onClick={() => delShot(s.id)} className="px-1 opacity-60 hover:opacity-100" title="删除"><Trash2 size={12} /></button>
            </div>
          ))}
          {!shots.length && <span className="opacity-40">摆好机位后点「+记录」</span>}
        </div>
        {shots.length > 0 && (
          <button onClick={() => void batchGenerate()} disabled={busy} className="mt-1 px-2 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-xs flex items-center justify-center gap-1 disabled:opacity-60">
            <Film size={13} /> 批量生成 {shots.length} 机位
          </button>
        )}
      </div>

      {/* 生成 */}
      <div className="absolute bottom-3 left-3 right-3 flex items-end gap-2">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="场景/角色描述（如：中式书房，一位穿长衫的老者站在书桌前…）"
          className="flex-1 h-16 resize-none rounded-lg bg-black/55 text-white text-sm p-2 outline-none placeholder:text-white/40"
        />
        <button
          onClick={() => void run()}
          disabled={busy}
          className="h-16 px-5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium flex items-center gap-2 disabled:opacity-60"
        >
          {busy ? <><Loader2 size={16} className="animate-spin" /> 生成中…</> : <><Film size={16} /> 用此机位生成</>}
        </button>
      </div>
    </div>
  )
}

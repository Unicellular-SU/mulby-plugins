import { useEffect, useRef, useState } from 'react'
import { X, Loader2, Film, User, Box as BoxIcon, Move, Rotate3d, Maximize, Hand, Trash2, Copy, Crosshair, Upload, Eye, EyeOff } from 'lucide-react'
import { useGraph } from '../store/graphStore'
import { useUi } from '../store/uiStore'
import { toast } from '../store/toastStore'
import { uid } from '../util'

// 3D 导演台 v4：Outliner + Inspector + 模型导入 + 缩放 + 拖拽摆姿 + 镜头/机位/生成。
// three 动态分割，主包不增。默认人台=程序化骨架人形（零资源、有关节、可摆姿/缩放）；可导入 GLB/GLTF。

const FILM_GAUGE = 36 // 35mm 全画幅

// 一键姿势预设（关节名→欧拉角；粗摆即可，AI 据深度/截图 + 姿势名渲染）
const POSES: { k: string; m: Record<string, [number, number, number]> }[] = [
  { k: '站立', m: {} },
  { k: 'T姿', m: { 左肩: [0, 0, -1.45], 右肩: [0, 0, 1.45] } },
  { k: '叉腰', m: { 左肩: [0, 0, -0.5], 左肘: [0, 0, -1.6], 右肩: [0, 0, 0.5], 右肘: [0, 0, 1.6] } },
  { k: '举双手', m: { 左肩: [0, 0, -2.9], 右肩: [0, 0, 2.9] } },
  { k: '招手', m: { 右肩: [0, 0, 2.5], 右肘: [0, 0, 0.6] } },
  { k: '行走', m: { 左髋: [0.5, 0, 0], 右髋: [-0.5, 0, 0], 左肩: [-0.4, 0, 0], 右肩: [0.4, 0, 0], 左膝: [-0.3, 0, 0] } },
  { k: '坐', m: { 左髋: [1.5, 0, 0], 右髋: [1.5, 0, 0], 左膝: [-1.5, 0, 0], 右膝: [-1.5, 0, 0] } },
  { k: '指向前', m: { 右肩: [-1.4, 0, 0] } }
]
const FACINGS: { k: string; r: number }[] = [
  { k: '面向', r: 0 },
  { k: '背向', r: Math.PI },
  { k: '朝左', r: Math.PI / 2 },
  { k: '朝右', r: -Math.PI / 2 }
]

// COCO-18 OpenPose：关键点顺序、连接、配色（controlnet_aux 同款）
const KP_ORDER = ['鼻', '颈', '右肩', '右肘', '右腕', '左肩', '左肘', '左腕', '右髋', '右膝', '右踝', '左髋', '左膝', '左踝', '右眼', '左眼', '右耳', '左耳']
const OP_LIMBS: [number, number][] = [
  [1, 2], [1, 5], [2, 3], [3, 4], [5, 6], [6, 7], [1, 8], [8, 9], [9, 10], [1, 11], [11, 12], [12, 13], [1, 0], [0, 14], [14, 16], [0, 15], [15, 17]
]
const OP_COLORS = [
  [255, 0, 0], [255, 85, 0], [255, 170, 0], [255, 255, 0], [170, 255, 0], [85, 255, 0], [0, 255, 0], [0, 255, 85], [0, 255, 170],
  [0, 255, 255], [0, 170, 255], [0, 85, 255], [0, 0, 255], [85, 0, 255], [170, 0, 255], [255, 0, 255], [255, 0, 170], [255, 0, 85]
]
// Mixamo 骨骼名（小写后缀）→ 我们的标准关节名（用于导入 rigged 人物的摆姿/骨架导出）
const MIXAMO_MAP: { suf: string; joint: string }[] = [
  { suf: 'head', joint: '头' }, { suf: 'neck', joint: '颈' },
  { suf: 'leftarm', joint: '左肩' }, { suf: 'leftforearm', joint: '左肘' }, { suf: 'lefthand', joint: '左腕' },
  { suf: 'rightarm', joint: '右肩' }, { suf: 'rightforearm', joint: '右肘' }, { suf: 'righthand', joint: '右腕' },
  { suf: 'leftupleg', joint: '左髋' }, { suf: 'leftleg', joint: '左膝' }, { suf: 'leftfoot', joint: '左踝' },
  { suf: 'rightupleg', joint: '右髋' }, { suf: 'rightleg', joint: '右膝' }, { suf: 'rightfoot', joint: '右踝' }
]

type TMode = 'translate' | 'rotate' | 'scale' | 'pose'

export function DirectorStage() {
  const show = useUi((s) => s.showDirector)
  if (!show) return null
  return <Inner />
}

interface ObjRow {
  id: string
  name: string
  kind: string
  visible: boolean
}

function Inner() {
  const mountRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const api = useRef<any>({})
  const [ready, setReady] = useState(false)
  const [focal, setFocal] = useState(35)
  const [mode, setMode] = useState<TMode>('translate')
  const [objs, setObjs] = useState<ObjRow[]>([])
  const [selId, setSelId] = useState<string | null>(null)
  const [selKind, setSelKind] = useState<string | null>(null)
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState(false)
  const [shots, setShots] = useState<{ id: string; name: string; cam: any }[]>([])
  const [ctrlType, setCtrlType] = useState<'depth' | 'pose'>('depth')
  const hasControlModel = useGraph((s) => !!s.project.defaultControlModel)

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
      let GLTFLoader: any
      try {
        THREE = await import('three')
        OrbitControls = (await import('three/examples/jsm/controls/OrbitControls.js')).OrbitControls
        TransformControls = (await import('three/examples/jsm/controls/TransformControls.js')).TransformControls
        GLTFLoader = (await import('three/examples/jsm/loaders/GLTFLoader.js')).GLTFLoader
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

        scene.add(new THREE.HemisphereLight(0xffffff, 0x404050, 1.15))
        const dirLight = new THREE.DirectionalLight(0xffffff, 1.1)
        dirLight.position.set(3, 6, 4)
        scene.add(dirLight)
        const grid = new THREE.GridHelper(20, 20, 0x445566, 0x2a3340)
        scene.add(grid)
        const ground = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.MeshStandardMaterial({ color: 0x23272f, roughness: 1 }))
        ground.rotation.x = -Math.PI / 2
        ground.position.y = -0.001
        scene.add(ground)
        const depthMat = new THREE.MeshDepthMaterial({ depthPacking: THREE.BasicDepthPacking })

        const orbit = new OrbitControls(cam, renderer.domElement)
        orbit.enableDamping = true
        orbit.target.set(0, 1, 0)
        const tcontrol = new TransformControls(cam, renderer.domElement)
        tcontrol.addEventListener('dragging-changed', (e: any) => { orbit.enabled = !e.value })
        const tHelper = typeof tcontrol.getHelper === 'function' ? tcontrol.getHelper() : tcontrol
        scene.add(tHelper)

        interface Subj { obj: any; kind: string; id: string; name: string }
        const subjects: Subj[] = []
        const raycaster = new THREE.Raycaster()
        const ndc = new THREE.Vector2()
        let curMode: TMode = 'translate'
        const counters: Record<string, number> = {}
        const nextName = (kind: string) => { counters[kind] = (counters[kind] || 0) + 1; return `${kind}${counters[kind]}` }

        const sync = () => { if (!disposed) setObjs(subjects.map((s) => ({ id: s.id, name: s.name, kind: s.kind, visible: s.obj.visible !== false }))) }

        const makeMannequin = (color: number) => {
          const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.6 })
          const mesh = (geo: any, y = 0) => { const m = new THREE.Mesh(geo, mat); m.position.y = y; return m }
          const joint = (name: string, x: number, y: number, z: number) => { const g = new THREE.Group(); g.position.set(x, y, z); g.userData.joint = name; return g }
          const root = new THREE.Group()
          root.userData.kind = '人台'
          const hips = new THREE.Group(); hips.position.set(0, 0.9, 0); root.add(hips)
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
        const attachByMode = () => {
          if (!curRoot || curMode === 'pose') { tcontrol.detach(); return }
          tcontrol.setMode(curMode)
          tcontrol.attach(curRoot)
        }
        const select = (root: any | null) => {
          curRoot = root
          attachByMode()
          if (!disposed) {
            const sub = subjects.find((s) => s.obj === root)
            setSelId(sub ? sub.id : null)
            setSelKind(root ? root.userData.kind || '' : null)
          }
        }
        const addSubject = (obj: any, kind: string) => {
          const id = uid('obj')
          const name = nextName(kind)
          obj.userData.kind = kind
          scene.add(obj)
          subjects.push({ obj, kind, id, name })
          sync()
          select(obj)
          return id
        }
        const addMannequin = () => {
          const g = makeMannequin(0xc7ccd6)
          g.position.set((subjects.length % 3) * 0.9 - 0.9, 0, 0)
          addSubject(g, '人台')
        }
        const addProp = () => {
          const m = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), new THREE.MeshStandardMaterial({ color: 0x8a93a6, roughness: 0.8 }))
          m.position.set(0.7, 0.25, 0.6)
          addSubject(m, '道具')
        }
        const disposeTree = (o: any) => {
          o.traverse?.((c: any) => {
            c.geometry?.dispose?.()
            const m = c.material
            ;(Array.isArray(m) ? m : [m]).forEach((mm: any) => {
              if (!mm) return
              ;['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap'].forEach((k) => mm[k]?.dispose?.())
              mm.dispose?.()
            })
          })
        }
        const importGLTF = (arrayBuffer: ArrayBuffer, fname: string) => {
          const loader = new GLTFLoader()
          loader.parse(
            arrayBuffer,
            '',
            (gltf: any) => {
              const obj = gltf.scene || gltf.scenes?.[0]
              if (!obj) { toast('模型为空', 'error'); return }
              if (disposed) { disposeTree(obj); return } // 卸载后回调：清理，勿挂到孤立场景
              // 识别 Mixamo 人形骨骼 → 标记标准关节名（用于摆姿/OpenPose 导出）
              let bones = 0
              obj.traverse((c: any) => {
                const nl = String(c.name || '').toLowerCase()
                const hit = MIXAMO_MAP.find((mm) => nl.endsWith(mm.suf))
                if (hit && !c.userData.joint) { c.userData.joint = hit.joint; bones++ }
              })
              obj.userData.rigged = bones >= 6
              // 归一化：缩放到约 2 单位高，脚落地面、水平居中（无可见网格则跳过）
              const box = new THREE.Box3().setFromObject(obj)
              if (!box.isEmpty()) {
                const size = box.getSize(new THREE.Vector3())
                const m = Math.max(size.x, size.y, size.z)
                const maxDim = isFinite(m) && m > 0 ? m : 1
                obj.scale.setScalar(2 / maxDim)
                obj.updateMatrixWorld(true)
                const box2 = new THREE.Box3().setFromObject(obj)
                const c = box2.getCenter(new THREE.Vector3())
                obj.position.x -= c.x
                obj.position.z -= c.z
                obj.position.y -= box2.min.y
              }
              const k = (fname.replace(/\.(glb|gltf)$/i, '') || '模型').slice(0, 16)
              const id = uid('obj')
              obj.userData.kind = '模型'
              scene.add(obj)
              subjects.push({ obj, kind: '模型', id, name: k })
              sync()
              select(obj)
              toast('已导入模型：' + k, 'success')
            },
            (err: any) => { if (!disposed) toast('模型导入失败（.gltf 仅支持全内嵌；Draco 压缩暂不支持）：' + (err?.message || String(err)), 'error') }
          )
        }

        const findById = (id: string) => subjects.find((s) => s.id === id)
        const removeById = (id: string) => {
          const sub = findById(id)
          if (!sub) return
          if (curRoot === sub.obj) { tcontrol.detach(); curRoot = null }
          scene.remove(sub.obj)
          subjects.splice(subjects.indexOf(sub), 1)
          sync()
          if (curRoot === null && !disposed) { setSelId(null); setSelKind(null) }
        }
        const duplicateById = (id: string) => {
          const sub = findById(id)
          if (!sub) return
          const clone = sub.obj.clone(true)
          clone.position.x += 0.7
          addSubject(clone, sub.kind)
        }
        const toggleVisById = (id: string) => {
          const sub = findById(id)
          if (!sub) return
          sub.obj.visible = !sub.obj.visible
          sync()
        }
        const lookAtSelected = () => {
          if (!curRoot) return
          const p = new THREE.Vector3()
          curRoot.getWorldPosition(p)
          orbit.target.set(p.x, p.y + 0.9, p.z)
        }

        // ── 拖拽摆姿（摆姿模式）：点关节 → 拖动鼠标按相机方向旋转该关节 ──
        let posing: { joint: any; sx: number; sy: number; startQ: any; parentInv: any } | null = null
        const camAxis = (col: number) => new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, col).normalize()

        const onPointerDown = (e: PointerEvent) => {
          if (tcontrol.dragging) return
          const r = renderer.domElement.getBoundingClientRect()
          ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
          raycaster.setFromCamera(ndc, cam)
          const hits = raycaster.intersectObjects(subjects.map((s) => s.obj).filter((o) => o.visible !== false), true)
          if (!hits.length) return
          let o: any = hits[0].object
          let jnt: any = null
          let root: any = null
          while (o) {
            if (!jnt && o.userData && o.userData.joint) jnt = o
            if (subjects.some((s) => s.obj === o)) { root = o; break }
            o = o.parent
          }
          if (!root) return
          select(root)
          // 导入 rigged 模型：蒙皮网格命中点找不到关节祖先 → 取最近的已标记骨骼
          if (curMode === 'pose' && !jnt && root.userData.rigged && hits[0].point) {
            let best: any = null
            let bd = Infinity
            const wp = new THREE.Vector3()
            root.traverse((c: any) => {
              if (!c.userData || !c.userData.joint) return
              c.getWorldPosition(wp)
              const d = wp.distanceTo(hits[0].point)
              if (d < bd) { bd = d; best = c }
            })
            jnt = best
          }
          if (curMode === 'pose' && jnt && jnt.parent) {
            const parentWorld = jnt.parent.getWorldQuaternion(new THREE.Quaternion())
            posing = { joint: jnt, sx: e.clientX, sy: e.clientY, startQ: jnt.quaternion.clone(), parentInv: parentWorld.clone().invert() }
            orbit.enabled = false
            try { renderer.domElement.setPointerCapture(e.pointerId) } catch { /* ignore */ }
          }
        }
        const onPointerMove = (e: PointerEvent) => {
          if (!posing) return
          const dx = (e.clientX - posing.sx) * 0.012
          const dy = (e.clientY - posing.sy) * 0.012
          const right = camAxis(0)
          const up = camAxis(1)
          const qWorld = new THREE.Quaternion().setFromAxisAngle(up, dx).multiply(new THREE.Quaternion().setFromAxisAngle(right, dy))
          // 世界增量 → 关节父空间局部增量：localΔ = parentInv * qWorld * parent
          const parentWorld = posing.parentInv.clone().invert()
          const localDelta = posing.parentInv.clone().multiply(qWorld).multiply(parentWorld)
          posing.joint.quaternion.copy(localDelta.multiply(posing.startQ))
        }
        const onPointerUp = (e: PointerEvent) => {
          if (!posing) return
          posing = null
          orbit.enabled = true
          try { renderer.domElement.releasePointerCapture(e.pointerId) } catch { /* ignore */ }
        }
        renderer.domElement.addEventListener('pointerdown', onPointerDown)
        window.addEventListener('pointermove', onPointerMove)
        window.addEventListener('pointerup', onPointerUp)

        // 拖拽导入
        const onDragOver = (e: DragEvent) => { e.preventDefault() }
        const onDrop = (e: DragEvent) => {
          e.preventDefault()
          const f = e.dataTransfer?.files?.[0]
          if (f && /\.(glb|gltf)$/i.test(f.name)) f.arrayBuffer().then((ab) => importGLTF(ab, f.name))
        }
        renderer.domElement.addEventListener('dragover', onDragOver)
        renderer.domElement.addEventListener('drop', onDrop)

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
        // 持久化只存程序生成的人台/道具（导入模型为二进制，无法序列化）
        const buildFromState = (st: any) => {
          if (st.kind !== '人台' && st.kind !== '道具') return
          const obj: any = st.kind === '道具'
            ? new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), new THREE.MeshStandardMaterial({ color: 0x8a93a6, roughness: 0.8 }))
            : makeMannequin(0xc7ccd6)
          obj.position.set(st.pos[0], st.pos[1], st.pos[2])
          obj.rotation.set(st.rot[0], st.rot[1], st.rot[2])
          obj.scale.setScalar(st.scale || 1)
          obj.userData.kind = st.kind
          if (st.poseName) obj.userData.poseName = st.poseName
          if (st.joints) obj.traverse((c: any) => { const j = c.userData && c.userData.joint; if (j && st.joints[j]) c.rotation.set(st.joints[j][0], st.joints[j][1], st.joints[j][2]) })
          const id = uid('obj')
          scene.add(obj)
          subjects.push({ obj, kind: st.kind, id, name: nextName(st.kind) })
        }
        const serializeSceneOnly = () => ({
          subjects: subjects
            .filter((s) => s.kind === '人台' || s.kind === '道具')
            .map((s) => {
              const o: any = s.obj
              const joints: Record<string, [number, number, number]> = {}
              if (s.kind === '人台') o.traverse((c: any) => { const j = c.userData && c.userData.joint; if (j) joints[j] = [c.rotation.x, c.rotation.y, c.rotation.z] })
              return { kind: s.kind, pos: [o.position.x, o.position.y, o.position.z] as [number, number, number], rot: [o.rotation.x, o.rotation.y, o.rotation.z] as [number, number, number], scale: o.scale.x, joints: s.kind === '人台' ? joints : undefined, poseName: o.userData.poseName }
            }),
          cam: getCam()
        })
        // 采集一个主体的 OpenPose 关键点（世界坐标）。人台从关节组推导；rigged 模型读已标记骨骼。
        const collectKeypoints = (obj: any): Record<string, any> => {
          const by: Record<string, any> = {}
          obj.traverse((c: any) => { const j = c.userData && c.userData.joint; if (j && !by[j]) by[j] = c })
          const wp = (o: any) => (o ? o.getWorldPosition(new THREE.Vector3()) : undefined)
          const lt = (o: any, x: number, y: number, z: number) => (o ? o.localToWorld(new THREE.Vector3(x, y, z)) : undefined)
          const k: Record<string, any> = {}
          for (const n of ['右肩', '左肩', '右肘', '左肘', '右髋', '左髋', '右膝', '左膝']) k[n] = wp(by[n])
          k['头'] = wp(by['头'])
          if (obj.userData.rigged) {
            k['右腕'] = wp(by['右腕']); k['左腕'] = wp(by['左腕'])
            k['右踝'] = wp(by['右踝']); k['左踝'] = wp(by['左踝'])
            k['颈'] = wp(by['颈']) || (k['左肩'] && k['右肩'] ? k['左肩'].clone().add(k['右肩']).multiplyScalar(0.5) : k['头'])
            k['鼻'] = k['头']
          } else {
            k['右腕'] = lt(by['右肘'], 0, -0.33, 0); k['左腕'] = lt(by['左肘'], 0, -0.33, 0)
            k['右踝'] = lt(by['右膝'], 0, -0.4, 0); k['左踝'] = lt(by['左膝'], 0, -0.4, 0)
            k['颈'] = k['左肩'] && k['右肩'] ? k['左肩'].clone().add(k['右肩']).multiplyScalar(0.5) : k['头']
            k['鼻'] = lt(by['头'], 0, 0.13, 0.12)
            k['右眼'] = lt(by['头'], 0.05, 0.18, 0.1); k['左眼'] = lt(by['头'], -0.05, 0.18, 0.1)
            k['右耳'] = lt(by['头'], 0.12, 0.13, 0); k['左耳'] = lt(by['头'], -0.12, 0.13, 0)
          }
          return k
        }
        // OpenPose 控制图：黑底 + 标准配色骨架（投影所有人台/rigged 模型的关键点）
        const captureOpenPose = (): string => {
          const cw = renderer.domElement.width
          const ch = renderer.domElement.height
          const c = document.createElement('canvas')
          c.width = cw
          c.height = ch
          const ctx = c.getContext('2d')!
          ctx.fillStyle = '#000'
          ctx.fillRect(0, 0, cw, ch)
          ctx.lineCap = 'round'
          const project = (p: any): [number, number] | null => {
            if (!p) return null
            const cs = p.clone().applyMatrix4(cam.matrixWorldInverse)
            if (cs.z > -0.02) return null // 在相机后方
            const v = p.clone().project(cam)
            return [(v.x * 0.5 + 0.5) * cw, (1 - (v.y * 0.5 + 0.5)) * ch]
          }
          const lineW = Math.max(2, Math.round(ch * 0.012))
          const dotR = Math.max(2, Math.round(ch * 0.009))
          const targets = subjects.filter((s) => s.kind === '人台' || (s.kind === '模型' && s.obj.userData.rigged))
          for (const s of targets) {
            const k = collectKeypoints(s.obj)
            const pts = KP_ORDER.map((n) => project(k[n]))
            OP_LIMBS.forEach((pair, li) => {
              const a = pts[pair[0]]
              const b = pts[pair[1]]
              if (a && b) {
                const col = OP_COLORS[li % OP_COLORS.length]
                ctx.strokeStyle = `rgb(${col[0]},${col[1]},${col[2]})`
                ctx.lineWidth = lineW
                ctx.beginPath()
                ctx.moveTo(a[0], a[1])
                ctx.lineTo(b[0], b[1])
                ctx.stroke()
              }
            })
            pts.forEach((p, i) => {
              if (!p) return
              const col = OP_COLORS[i % OP_COLORS.length]
              ctx.fillStyle = `rgb(${col[0]},${col[1]},${col[2]})`
              ctx.beginPath()
              ctx.arc(p[0], p[1], dotR, 0, Math.PI * 2)
              ctx.fill()
            })
          }
          return c.toDataURL('image/png')
        }
        const captureDepth = (): string => {
          tcontrol.detach()
          const pf = cam.far
          cam.far = 14
          cam.updateProjectionMatrix()
          const pbg = scene.background
          scene.background = new THREE.Color(0x000000)
          const gv = grid.visible
          const gdv = ground.visible
          grid.visible = false
          ground.visible = false // 网格/地面会污染深度图（底部强梯度+网格线），主体专注
          scene.overrideMaterial = depthMat
          renderer.render(scene, cam)
          scene.overrideMaterial = null as any
          grid.visible = gv
          ground.visible = gdv
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
          for (let i = 0; i < dd.length; i += 4) { const v = 255 - dd[i]; dd[i] = v; dd[i + 1] = v; dd[i + 2] = v; dd[i + 3] = 255 }
          cx.putImageData(idata, 0, 0)
          attachByMode()
          return c.toDataURL('image/png')
        }

        // 恢复持久化场景，否则默认一个人台
        const saved0 = useGraph.getState().project.director
        if (saved0 && Array.isArray(saved0.subjects) && saved0.subjects.length) {
          saved0.subjects.forEach(buildFromState)
          sync()
          if (saved0.cam) applyCam(saved0.cam)
          select(null)
          if (!disposed) {
            setShots(saved0.shots || [])
            if (saved0.prompt) setPrompt(saved0.prompt)
            setFocal(Math.round((saved0.cam && saved0.cam.focal) || 35))
          }
        } else {
          addMannequin()
        }

        const shotFragment = (): string => {
          const target = orbit.target
          const d = cam.position.distanceTo(target)
          const dy = cam.position.y - target.y
          const ang = (Math.asin(Math.max(-1, Math.min(1, dy / Math.max(0.001, d)))) * 180) / Math.PI
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
              const pose = (s.obj as any).userData?.poseName
              return `角色${i + 1}${where}${pose ? `(${pose})` : ''}`
            })
            .filter(Boolean)
            .join('，')
          const count = people.length ? `画面中有 ${people.length} 个角色（${layout || '居中'}）。` : ''
          return `镜头：${lens}，${Math.round(f)}mm，${angle}，${shot}。${count}`
        }

        api.current = {
          addMannequin,
          addProp,
          importFile: (ab: ArrayBuffer, name: string) => importGLTF(ab, name),
          selectById: (id: string) => { const s = findById(id); if (s) select(s.obj) },
          removeById,
          duplicateById,
          toggleVisById,
          lookAtSelected,
          setMode: (m: TMode) => { curMode = m; attachByMode() },
          setFocal: (mm: number) => cam.setFocalLength(mm),
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
          applyPose: (name: string, map: Record<string, [number, number, number]>) => {
            if (!curRoot || curRoot.userData.kind !== '人台') return
            curRoot.traverse((c: any) => { if (c.userData && c.userData.joint) c.rotation.set(0, 0, 0) })
            curRoot.traverse((c: any) => { const j = c.userData && c.userData.joint; if (j && map[j]) c.rotation.set(map[j][0], map[j][1], map[j][2]) })
            curRoot.userData.poseName = name === '站立' ? '' : name
          },
          setFacing: (rad: number) => { if (curRoot) curRoot.rotation.y = rad },
          capture: (): string => {
            tcontrol.detach()
            renderer.render(scene, cam)
            const url = renderer.domElement.toDataURL('image/png')
            attachByMode()
            return url
          },
          captureDepth,
          captureOpenPose,
          poseTargetCount: () => subjects.filter((s) => s.kind === '人台' || (s.kind === '模型' && s.obj.userData.rigged)).length,
          getCam,
          applyCam,
          serializeSceneOnly,
          shotFragment
        }
        if (!disposed) setReady(true)

        cleanup = () => {
          const safe = (fn: () => void) => { try { fn() } catch { /* ignore */ } }
          safe(() => cancelAnimationFrame(raf))
          safe(() => ro.disconnect())
          safe(() => renderer.domElement.removeEventListener('pointerdown', onPointerDown))
          safe(() => window.removeEventListener('pointermove', onPointerMove))
          safe(() => window.removeEventListener('pointerup', onPointerUp))
          safe(() => renderer.domElement.removeEventListener('dragover', onDragOver))
          safe(() => renderer.domElement.removeEventListener('drop', onDrop))
          safe(() => tcontrol.detach())
          safe(() => scene.remove(tHelper))
          safe(() => tcontrol.dispose())
          safe(() => orbit.dispose())
          safe(() => scene.traverse((o: any) => disposeTree(o))) // 释放各 mesh 的 geometry/material/texture
          safe(() => depthMat.dispose())
          safe(() => renderer.dispose())
          safe(() => renderer.forceContextLoss())
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
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeRef.current() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const onFocal = (mm: number) => { setFocal(mm); api.current.setFocal?.(mm) }
  const onMode = (m: TMode) => { setMode(m); api.current.setMode?.(m) }
  const onImportClick = () => fileRef.current?.click()
  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    api.current.importFile?.(await f.arrayBuffer(), f.name)
  }

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
      const usePose = useControl && ctrlType === 'pose'
      if (usePose && (api.current.poseTargetCount?.() || 0) === 0) {
        toast('骨架控制需要至少一个人台或带骨骼的导入模型', 'error')
        return false
      }
      const dataUrl = (usePose ? api.current.captureOpenPose() : useControl ? api.current.captureDepth() : api.current.capture()) as string
      const b64 = dataUrl.split(',')[1]
      const bin = atob(b64)
      const buf = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i)
      const att = await ai.attachments.upload({ buffer: buf.buffer, mimeType: 'image/png', purpose: 'image' })
      const note = usePose
        ? '【输入为 OpenPose 骨架控制图：请严格按骨架表达的人物姿态与站位渲染为成片画面。】'
        : useControl
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
  const applyShot = (sh: { cam: any }) => { api.current.applyCam?.(sh.cam); setFocal(Math.round(sh.cam?.focal || 35)) }
  const delShot = (id: string) => setShots((s) => s.filter((x) => x.id !== id))

  const Btn = ({ on, onClick, children, title }: { on?: boolean; onClick: () => void; children: any; title: string }) => (
    <button onClick={onClick} title={title} className={`px-2 py-1 rounded-md text-xs flex items-center gap-1 ${on ? 'bg-indigo-600 text-white' : 'bg-white/10 hover:bg-white/20 text-white'}`}>
      {children}
    </button>
  )

  const kindIcon = (k: string) => (k === '人台' ? <User size={12} /> : k === '道具' ? <BoxIcon size={12} /> : <Upload size={12} />)

  return (
    <div className="fixed inset-0 z-[90] bg-black flex flex-col text-white" data-interactive>
      <div ref={mountRef} className="absolute inset-0" style={{ touchAction: 'none' }} />
      {!ready && <div className="absolute inset-0 grid place-items-center text-white/70 text-sm pointer-events-none">正在加载 3D 导演台…</div>}
      <input ref={fileRef} type="file" accept=".glb,.gltf" className="hidden" onChange={onFile} />

      {/* 顶栏：标题 + 变换模式 + 关闭 */}
      <div className="absolute top-3 left-3 right-3 flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-black/55">
          <Film size={14} className="text-indigo-400" />
          <span className="text-xs font-medium">3D 导演台</span>
        </div>
        <Btn on={mode === 'translate'} onClick={() => onMode('translate')} title="移动整体"><Move size={13} /> 移动</Btn>
        <Btn on={mode === 'rotate'} onClick={() => onMode('rotate')} title="旋转整体"><Rotate3d size={13} /> 旋转</Btn>
        <Btn on={mode === 'scale'} onClick={() => onMode('scale')} title="缩放整体"><Maximize size={13} /> 缩放</Btn>
        <Btn on={mode === 'pose'} onClick={() => onMode('pose')} title="摆姿：点人台关节后拖动鼠标摆姿"><Hand size={13} /> 摆姿</Btn>
        <div className="ml-auto" />
        <button onClick={close} className="w-8 h-8 grid place-items-center rounded-lg bg-black/55 hover:bg-black/70"><X size={16} /></button>
      </div>

      {/* 左：Outliner */}
      <div className="absolute top-14 left-3 bottom-24 w-44 flex flex-col gap-1.5 p-2.5 rounded-lg bg-black/55 text-xs">
        <div className="flex items-center justify-between">
          <span className="opacity-70 font-medium">场景对象</span>
        </div>
        <div className="flex items-center gap-1">
          <Btn onClick={() => api.current.addMannequin?.()} title="添加人台"><User size={12} /> 人台</Btn>
          <Btn onClick={() => api.current.addProp?.()} title="添加道具"><BoxIcon size={12} /> 道具</Btn>
          <Btn onClick={onImportClick} title="导入 GLB/GLTF"><Upload size={12} /> 导入</Btn>
        </div>
        <div className="flex flex-col gap-1 overflow-auto ace-scroll flex-1">
          {objs.map((o) => (
            <div key={o.id} className={`flex items-center gap-1 px-1.5 py-1 rounded ${selId === o.id ? 'bg-indigo-600' : 'bg-white/5 hover:bg-white/10'}`}>
              <button onClick={() => api.current.selectById?.(o.id)} className="flex-1 flex items-center gap-1.5 text-left truncate">
                {kindIcon(o.kind)} <span className="truncate">{o.name}</span>
              </button>
              <button onClick={() => api.current.toggleVisById?.(o.id)} className="opacity-60 hover:opacity-100" title="显隐">{o.visible ? <Eye size={12} /> : <EyeOff size={12} />}</button>
              <button onClick={() => api.current.duplicateById?.(o.id)} className="opacity-60 hover:opacity-100" title="复制"><Copy size={12} /></button>
              <button onClick={() => api.current.removeById?.(o.id)} className="opacity-60 hover:opacity-100" title="删除"><Trash2 size={12} /></button>
            </div>
          ))}
          {!objs.length && <span className="opacity-40">用上面按钮添加/导入对象</span>}
        </div>
        <div className="opacity-45 leading-snug">拖 .glb/.gltf 到画面也可导入</div>
      </div>

      {/* 右：Inspector + 镜头 + 机位 */}
      <div className="absolute top-14 right-3 bottom-24 w-56 flex flex-col gap-2 p-2.5 rounded-lg bg-black/55 text-xs overflow-auto ace-scroll">
        {selId && (
          <div className="flex flex-col gap-2 pb-2 border-b border-white/10">
            <span className="opacity-70 font-medium">选中：{objs.find((o) => o.id === selId)?.name}</span>
            <div className="flex items-center gap-1 flex-wrap">
              <Btn onClick={() => selId && api.current.duplicateById?.(selId)} title="复制"><Copy size={12} /> 复制</Btn>
              <Btn onClick={() => api.current.lookAtSelected?.()} title="相机看向"><Crosshair size={12} /> 看向</Btn>
              <Btn onClick={() => selId && api.current.removeById?.(selId)} title="删除"><Trash2 size={12} /> 删除</Btn>
            </div>
            {selKind === '人台' && (
              <>
                <div className="flex items-start gap-1">
                  <span className="opacity-60 w-8 mt-1">姿势</span>
                  <div className="flex-1 flex flex-wrap gap-1">{POSES.map((p) => <Btn key={p.k} onClick={() => api.current.applyPose?.(p.k, p.m)} title={`一键姿势：${p.k}`}>{p.k}</Btn>)}</div>
                </div>
                <div className="flex items-center gap-1 flex-wrap">
                  <span className="opacity-60 w-8">朝向</span>
                  {FACINGS.map((f) => <Btn key={f.k} onClick={() => api.current.setFacing?.(f.r)} title={`朝向：${f.k}`}>{f.k}</Btn>)}
                </div>
                <div className="opacity-45 leading-snug">一键姿势最省事；微调用顶栏「摆姿」点关节后拖动鼠标。</div>
              </>
            )}
          </div>
        )}
        {/* 镜头 */}
        <div className="flex flex-col gap-2 pb-2 border-b border-white/10">
          <span className="opacity-70 font-medium">镜头</span>
          <div className="flex items-center gap-2">
            <span className="opacity-60 w-8">焦段</span>
            <input type="range" min={18} max={135} value={focal} onChange={(e) => onFocal(Number(e.target.value))} className="flex-1" />
            <span className="w-9 text-right tabular-nums">{focal}</span>
          </div>
          <div className="flex items-center gap-1 flex-wrap">
            {[24, 35, 50, 85].map((mm) => <Btn key={mm} on={focal === mm} onClick={() => onFocal(mm)} title={`${mm}mm`}>{mm}</Btn>)}
          </div>
          <div className="flex items-center gap-1 flex-wrap">
            <span className="opacity-60 w-8">镜别</span>
            <Btn onClick={() => api.current.shotSize?.('cu')} title="特写">特写</Btn>
            <Btn onClick={() => api.current.shotSize?.('ms')} title="中景">中景</Btn>
            <Btn onClick={() => api.current.shotSize?.('fs')} title="全景">全景</Btn>
          </div>
          <div className="flex items-center gap-1 flex-wrap">
            <span className="opacity-60 w-8">角度</span>
            <Btn onClick={() => api.current.angle?.('low')} title="仰拍">仰拍</Btn>
            <Btn onClick={() => api.current.angle?.('eye')} title="平视">平视</Btn>
            <Btn onClick={() => api.current.angle?.('high')} title="俯拍">俯拍</Btn>
          </div>
          {hasControlModel && (
            <div className="flex items-center gap-1 flex-wrap">
              <span className="opacity-60 w-8">控制</span>
              <Btn on={ctrlType === 'depth'} onClick={() => setCtrlType('depth')} title="深度控制图">深度</Btn>
              <Btn on={ctrlType === 'pose'} onClick={() => setCtrlType('pose')} title="OpenPose 骨架控制图">骨架</Btn>
            </div>
          )}
        </div>
        {/* 机位 */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <span className="opacity-70 font-medium">机位（{shots.length}）</span>
            <Btn onClick={addShot} title="记录当前机位">+记录</Btn>
          </div>
          {shots.map((s) => (
            <div key={s.id} className="flex items-center gap-1">
              <button onClick={() => applyShot(s)} className="flex-1 text-left px-1.5 py-1 rounded bg-white/10 hover:bg-white/20 truncate" title="切到此机位">{s.name}</button>
              <button onClick={() => delShot(s.id)} className="px-1 opacity-60 hover:opacity-100" title="删除"><Trash2 size={12} /></button>
            </div>
          ))}
          {shots.length > 0 && (
            <button onClick={() => void batchGenerate()} disabled={busy} className="mt-1 px-2 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-xs flex items-center justify-center gap-1 disabled:opacity-60">
              <Film size={13} /> 批量生成 {shots.length} 机位
            </button>
          )}
        </div>
      </div>

      {/* 底：场景描述 + 生成 */}
      <div className="absolute bottom-3 left-48 right-60 flex items-end gap-2">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="场景/角色描述（如：中式书房，一位穿长衫的老者站在书桌前…）"
          className="flex-1 h-16 resize-none rounded-lg bg-black/55 text-sm p-2 outline-none placeholder:text-white/40"
        />
        <button onClick={() => void run()} disabled={busy} className="h-16 px-4 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-sm font-medium flex items-center gap-2 disabled:opacity-60 whitespace-nowrap">
          {busy ? <><Loader2 size={16} className="animate-spin" /> 生成中…</> : <><Film size={16} /> 生成</>}
        </button>
      </div>

      {/* 生成中：遮罩拦截一切交互，避免改动场景/相机影响抓帧（尤其批量逐机位） */}
      {busy && (
        <div className="absolute inset-0 z-[95] grid place-items-center bg-black/30 cursor-wait">
          <span className="px-3 py-1.5 rounded-lg bg-black/75 text-sm flex items-center gap-2"><Loader2 size={16} className="animate-spin" /> 生成中…请稍候</span>
        </div>
      )}
    </div>
  )
}

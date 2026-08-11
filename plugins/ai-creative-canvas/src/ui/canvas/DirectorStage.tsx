import { useEffect, useRef, useState } from 'react'
import { X, Loader2, Film, User, Box as BoxIcon, Move, Rotate3d, Maximize, Hand, Trash2, Copy, Crosshair, Upload, Eye, EyeOff, Lock, Unlock, Camera, Undo2, Redo2, Grid3x3, ArrowDownToLine, Users, Package, Clapperboard, Search, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { useGraph } from '../store/graphStore'
import { useUi } from '../store/uiStore'
import { toast } from '../store/toastStore'
import { saveBase64 } from '../services/media'
import { uid, isImeComposing } from '../util'
import {
  DIRECTOR_BODY_GROUPS,
  DIRECTOR_BODY_PRESETS,
  DIRECTOR_POSES as POSES,
  getDirectorDetailedJointDegrees,
  getDirectorBodyPreset,
  getDirectorPose,
  isDirectorNeutralBodyType,
  type DirectorBodyType
} from './directorMannequin'
import { DirectorAsyncResourceCache } from './directorAssetCache'
import { DirectorShotStrip } from './DirectorShotStrip'
import { DirectorPosePanel, type DirectorJointEditorState } from './DirectorPosePanel'
import { DirectorCameraPresetGrid } from './DirectorCameraPresetGrid'
import { createDirectorPresetCamera, DIRECTOR_CAMERA_PRESETS } from './directorCameraPresets'
import { solveDirectorCcdIk } from './directorIk'
import {
  clampDirectorJointDegrees,
  validateDirectorJointRotations,
  type DirectorJointAxis,
  type DirectorPoseSafetySummary
} from './directorPoseTools'
import {
  classifyDirectorShot,
  createDirectorShotSnapshot,
  inferDirectorInspectorTab,
  reorderDirectorShots,
  type DirectorInspectorTab
} from './directorWorkflow'
import type { DirectorShot } from '../types'

// 3D 导演台 v11：13 套独立人物网格、20 种语义姿势 + CC0 humanoid 人台；
// 高精模型加载失败时自动回退到程序化人台，仍可导入用户自己的 GLB/GLTF。

const FILM_GAUGE = 36 // 35mm 全画幅
const directorTemplateCache = new DirectorAsyncResourceCache<DirectorBodyType, any>()
const directorPosePreviewCache = new DirectorAsyncResourceCache<DirectorBodyType, Record<string, string>>()

const readDirectorPanelWidth = (key: string, fallback: number, min: number, max: number) => {
  if (typeof window === 'undefined') return fallback
  try {
    const stored = window.localStorage.getItem(key)
    if (stored === null) return fallback
    const value = Number(stored)
    return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback
  } catch {
    return fallback
  }
}

const writeDirectorPanelWidth = (key: string, value: number) => {
  try {
    window.localStorage.setItem(key, String(value))
  } catch {
    // 宿主禁用持久化时仅退化为当前会话宽度，不影响导演台启动。
  }
}

const FACINGS: { k: string; r: number }[] = [
  { k: '面向', r: 0 },
  { k: '背向', r: Math.PI },
  { k: '朝左', r: Math.PI / 2 },
  { k: '朝右', r: -Math.PI / 2 }
]

// 人台锚定色：按添加顺序分配。参考图里的颜色块是模型最易锁定的特征，
// prompt 里用「颜色标记+方位+占比+朝向」多重锚定对应角色（note 声明颜色只是站位标记）。
// 注意命名用「红标」不用「红衣」——后者字面=服装颜色，模型会把僵尸画成穿红衣服
const MANNEQUIN_COLORS: { hex: number; name: string }[] = [
  { hex: 0xd95f4b, name: '红标' },
  { hex: 0x4b7fd9, name: '蓝标' },
  { hex: 0x53b96a, name: '绿标' },
  { hex: 0xd9b84b, name: '黄标' },
  { hex: 0x9b5fd9, name: '紫标' },
  { hex: 0x4bbfd9, name: '青标' }
]
// 旧工程存的「红衣/蓝衣…」标签 → 新名（同序号同色）
const LEGACY_COLOR_NAMES = ['红衣', '蓝衣', '绿衣', '黄衣', '紫衣', '青衣']

// 出图画幅预设：宿主 images.edit 不支持尺寸参数，模型自己定画幅——所以抓帧按选定画幅居中裁剪，
// 视口内用 letterbox 画框标示真实出图范围（所见即所得）；ar=0 表示不裁剪（跟随视口）
const ASPECTS: { k: string; ar: number }[] = [
  { k: '视口', ar: 0 },
  { k: '1:1', ar: 1 },
  { k: '3:2', ar: 1.5 },
  { k: '2:3', ar: 2 / 3 },
  { k: '16:9', ar: 16 / 9 },
  { k: '9:16', ar: 9 / 16 }
]

// 灯光预设：两盏灯 + 背景色；frag 为追加进提示词的氛围描述（AI 据此渲染对应光线）
const LIGHTINGS: { k: string; hemiSky: number; hemiGround: number; hemiInt: number; dirColor: number; dirInt: number; dirPos: [number, number, number]; bg: number; frag: string }[] = [
  { k: '默认', hemiSky: 0xffffff, hemiGround: 0x404050, hemiInt: 1.15, dirColor: 0xffffff, dirInt: 1.1, dirPos: [3, 6, 4], bg: 0x1b1d23, frag: '' },
  { k: '棚拍柔光', hemiSky: 0xffffff, hemiGround: 0x909098, hemiInt: 1.5, dirColor: 0xfff4e6, dirInt: 0.5, dirPos: [2, 7, 3], bg: 0x24262c, frag: '柔和均匀的棚拍布光(soft studio lighting, low contrast)' },
  { k: '黄昏暖调', hemiSky: 0xffd9a0, hemiGround: 0x40302a, hemiInt: 0.8, dirColor: 0xffa040, dirInt: 1.6, dirPos: [-6, 2, 2], bg: 0x2a2226, frag: '黄昏金色时刻的暖调逆光(warm golden-hour rim light)' },
  { k: '夜景冷调', hemiSky: 0x8090c0, hemiGround: 0x101018, hemiInt: 0.5, dirColor: 0x6080ff, dirInt: 0.9, dirPos: [-3, 5, -4], bg: 0x0e1016, frag: '夜晚冷调月光氛围(cool moonlit night ambience)' }
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
  locked: boolean
  bodyType?: DirectorBodyType
  poseName?: string
}

interface TransformDraft {
  position: [number, number, number]
  rotation: [number, number, number]
  scale: [number, number, number]
}

function Inner() {
  const mountRef = useRef<HTMLDivElement>(null)
  const pipRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const api = useRef<any>({})
  const [ready, setReady] = useState(false)
  const [focal, setFocal] = useState(35)
  const [mode, setMode] = useState<TMode>('translate')
  const [locked, setLocked] = useState(false) // 取景锁定（出图相机冻结）
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)
  const [objs, setObjs] = useState<ObjRow[]>([])
  const [selId, setSelId] = useState<string | null>(null)
  const [selKind, setSelKind] = useState<string | null>(null)
  const [transformDraft, setTransformDraft] = useState<TransformDraft | null>(null)
  const [editId, setEditId] = useState<string | null>(null) // Outliner 行内改名中的对象 id
  const [editName, setEditName] = useState('')
  const [objectQuery, setObjectQuery] = useState('')
  const [panelsCollapsed, setPanelsCollapsed] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState(false)
  const [shots, setShots] = useState<DirectorShot[]>([])
  const [activeShotId, setActiveShotId] = useState<string | null>(null)
  const [shotStripExpanded, setShotStripExpanded] = useState(true)
  const [inspectorTab, setInspectorTab] = useState<DirectorInspectorTab>('camera')
  const [bodyLoading, setBodyLoading] = useState<DirectorBodyType | null>(null)
  const [posePreviews, setPosePreviews] = useState<Record<string, string>>({})
  const [posePreviewStatus, setPosePreviewStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [posePreviewNonce, setPosePreviewNonce] = useState(0)
  const [jointEditor, setJointEditor] = useState<DirectorJointEditorState | null>(null)
  const [poseSafety, setPoseSafety] = useState<DirectorPoseSafetySummary>({ level: 'safe', issues: [] })
  const [leftPanelWidth, setLeftPanelWidth] = useState(() => readDirectorPanelWidth('director.leftPanelWidth', 208, 184, 320))
  const [rightPanelWidth, setRightPanelWidth] = useState(() => readDirectorPanelWidth('director.rightPanelWidth', 288, 280, 420))
  const [showGuides, setShowGuides] = useState(true) // 三分构图线
  const [lighting, setLighting] = useState('默认')
  const [aspect, setAspectK] = useState('视口') // 出图画幅（ASPECTS 的 k）
  const curAr = ASPECTS.find((a) => a.k === aspect)?.ar ?? 0
  const [descDraft, setDescDraft] = useState('') // 选中对象的语义描述草稿（blur 提交）
  const [ctrlType, setCtrlType] = useState<'depth' | 'pose'>('depth')
  const hasControlModel = useGraph((s) => !!s.project.defaultControlModel)

  const saveScene = () => {
    try {
      const only = api.current.serializeSceneOnly?.()
      if (only) useGraph.getState().setDirectorScene({ schemaVersion: 2, subjects: only.subjects, cam: only.cam, shots, prompt, lighting: api.current.getLighting?.(), aspect })
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
      let cloneSkeleton: any
      try {
        THREE = await import('three')
        OrbitControls = (await import('three/examples/jsm/controls/OrbitControls.js')).OrbitControls
        TransformControls = (await import('three/examples/jsm/controls/TransformControls.js')).TransformControls
        GLTFLoader = (await import('three/examples/jsm/loaders/GLTFLoader.js')).GLTFLoader
        cloneSkeleton = (await import('three/examples/jsm/utils/SkeletonUtils.js')).clone
      } catch {
        return
      }
      const mount = mountRef.current
      if (disposed || !mount) return
      try {
        const W = mount.clientWidth || 1
        const H = mount.clientHeight || 1

        // mac 防闪烁：preserveDrawingBuffer 不开（retained buffer 在双显卡 MacBook 上迁移时周期性出空白帧；
        // 本文件所有抓帧都是 render 后同步读取，规范上不需要保留）；powerPreference 钉独显避免 GPU 自动切换
        const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
        renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1))
        renderer.setSize(W, H)
        mount.appendChild(renderer.domElement)

        const scene = new THREE.Scene()
        scene.background = new THREE.Color(0x1b1d23)
        const cam = new THREE.PerspectiveCamera(50, W / H, 0.05, 1000)
        cam.filmGauge = FILM_GAUGE
        cam.position.set(0, 1.5, 4)
        cam.setFocalLength(35)

        const hemi = new THREE.HemisphereLight(0xffffff, 0x404050, 1.15)
        scene.add(hemi)
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
        tcontrol.addEventListener('dragging-changed', (e: any) => { orbit.enabled = !e.value; if (!e.value) commit() })
        const tHelper = typeof tcontrol.getHelper === 'function' ? tcontrol.getHelper() : tcontrol
        scene.add(tHelper)
        const jointMarker = new THREE.Mesh(
          new THREE.SphereGeometry(0.045, 14, 10),
          new THREE.MeshBasicMaterial({ color: 0xfcd34d, depthTest: false, transparent: true, opacity: 0.92 })
        )
        jointMarker.visible = false
        jointMarker.renderOrder = 1000
        scene.add(jointMarker)

        // 取景双相机：cam=视图(轨道自由查看)；shotCam=出图相机(PiP/取景框/生成都用它)。
        // 默认 shotLocked=false → shotCam 每帧跟随 cam（与单相机行为一致，零回归）；锁定后冻结，
        // 可绕到侧面查看/摆姿而出图构图不变；CameraHelper 在主视图显示出图机位的取景框。
        const shotCam = new THREE.PerspectiveCamera(50, W / H, 0.05, 1000)
        shotCam.filmGauge = FILM_GAUGE
        shotCam.position.set(0, 1.5, 4)
        shotCam.setFocalLength(35)
        const shotTarget = new THREE.Vector3(0, 1, 0)
        let shotLocked = false
        const camHelper = new THREE.CameraHelper(shotCam)
        camHelper.visible = false
        scene.add(camHelper)
        const outCam = () => (shotLocked ? shotCam : cam)
        const outTarget = () => (shotLocked ? shotTarget : orbit.target)
        // PiP：角落小渲染器，实时显示 shotCam 取景（出图构图预览）
        let pip: any = null
        const pipMount = pipRef.current
        if (pipMount) {
          pip = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
          pip.setPixelRatio(Math.min(2, window.devicePixelRatio || 1))
          pip.setSize(240, Math.round(240 / (W / H)))
          pipMount.appendChild(pip.domElement)
        }

        interface Subj { obj: any; kind: string; id: string; name: string; desc?: string; colorName?: string }
        const subjects: Subj[] = []
        const raycaster = new THREE.Raycaster()
        const ndc = new THREE.Vector2()
        let curMode: TMode = 'translate'
        const counters: Record<string, number> = {}
        const nextName = (kind: string) => { counters[kind] = (counters[kind] || 0) + 1; return `${kind}${counters[kind]}` }

        const sync = () => {
          if (!disposed) {
            setObjs(subjects.map((s) => ({
              id: s.id,
              name: s.name,
              kind: s.kind,
              visible: s.obj.visible !== false,
              locked: !!s.obj.userData.locked,
              bodyType: s.kind === '人台' ? getDirectorBodyPreset(s.obj.userData.bodyType).bodyType : undefined,
              poseName: s.kind === '人台' ? s.obj.userData.poseName || '' : undefined
            })))
          }
        }

        // ── 撤销/重做：栈顶=当前态，快照 serializeSceneOnly()（含导入模型 assetId/姿势）──
        const history: any[] = []
        const redoStack: any[] = []
        let restoring = false
        let sceneGen = 0 // 场景代次：整体重建(undo/redo/恢复)时自增，丢弃过期的异步模型重建结果
        const syncHistoryUi = () => { if (!disposed) { setCanUndo(history.length > 1); setCanRedo(redoStack.length > 0) } }
        const commit = () => {
          if (restoring || disposed) return // 重建（含异步模型加载）期间不快照，避免漏掉未到达的模型
          let snap: any
          try { snap = serializeSceneOnly() } catch { return }
          history.push(snap)
          if (history.length > 60) history.shift()
          redoStack.length = 0
          syncHistoryUi()
        }
        const applyState = (state: any) => {
          if (!state) return
          restoring = true
          sceneGen++
          tcontrol.detach(); curRoot = null
          for (const s of subjects) { scene.remove(s.obj); disposeTree(s.obj) }
          subjects.length = 0
          const ps: Promise<void>[] = []
          for (const st of state.subjects || []) { if (st.kind === '模型') ps.push(buildModelFromState(st)); else buildFromState(st) }
          if (state.cam) applyCam(state.cam)
          sync()
          if (!disposed) { setSelId(null); setSelKind(null); setTransformDraft(null); if (state.cam) setFocal(Math.round(state.cam.focal || 35)) }
          // 异步模型到齐后才解除 restoring（期间抑制 commit，避免快照漏模型 / 与现场脱节）
          void Promise.all(ps).then(() => { restoring = false; if (!disposed) sync() })
        }
        const undo = () => {
          if (restoring || history.length <= 1) return
          redoStack.push(history.pop())
          applyState(history[history.length - 1])
          syncHistoryUi()
        }
        const redoFn = () => {
          if (restoring) return
          const s = redoStack.pop()
          if (!s) return
          history.push(s)
          applyState(s)
          syncHistoryUi()
        }

        const directorAssetUrl = (file: string) => new URL(`./models/director/${file}`, window.location.href).href
        const directorLoader = new GLTFLoader()
        const ensureDirectorTemplate = (bodyType: DirectorBodyType) => {
          const preset = getDirectorBodyPreset(bodyType)
          return directorTemplateCache.load(preset.bodyType, async () => {
            const loaded = await directorLoader.loadAsync(directorAssetUrl(preset.assetFile))
            return loaded.scene
          })
        }
        // 默认只加载基础人物；恢复旧工程时额外加载场景实际使用的素体。
        // 其余 12 套在用户首次选择时请求并进入会话缓存，避免每次打开先下载约 16MB。
        const saved0 = useGraph.getState().project.director
        const initialBodyTypes = new Set<DirectorBodyType>(['mannequin'])
        for (const subject of saved0?.subjects || []) {
          if (subject.kind === '人台') initialBodyTypes.add(getDirectorBodyPreset(subject.bodyType).bodyType)
        }
        await Promise.all(Array.from(initialBodyTypes, (bodyType) => ensureDirectorTemplate(bodyType)))
        if (disposed) return

        const DETAILED_BONE_MAP: Record<string, string> = {
          pelvis: '骨盆',
          spine_03: '胸',
          neck_01: '颈',
          Head: '头',
          head: '头',
          upperarm_l: '左肩',
          lowerarm_l: '左肘',
          hand_l: '左腕',
          upperarm_r: '右肩',
          lowerarm_r: '右肘',
          hand_r: '右腕',
          thigh_l: '左髋',
          calf_l: '左膝',
          foot_l: '左踝',
          thigh_r: '右髋',
          calf_r: '右膝',
          foot_r: '右踝'
        }
        const makeDetailedMannequin = (color: number, bodyType: DirectorBodyType) => {
          const preset = getDirectorBodyPreset(bodyType)
          const template = directorTemplateCache.peek(preset.bodyType)
          if (!template) return null
          const neutralPresentation = isDirectorNeutralBodyType(bodyType)

          const model = cloneSkeleton(template)
          const root = new THREE.Group()
          const rigRoot = new THREE.Group()
          rigRoot.userData.rigRoot = true
          root.add(rigRoot)
          rigRoot.add(model)
          root.userData.kind = '人台'
          root.userData.bodyType = bodyType
          root.userData.bodyAssetFile = preset.assetFile
          root.userData.poseOffsetY = 0
          root.userData.detailedMannequin = true
          root.userData.rigged = true
          root.userData.poseSchemaVersion = 2

          model.traverse((object: any) => {
            if (object.isMesh) {
              object.frustumCulled = false
              object.userData.directorSharedAssets = true
              const materials = (Array.isArray(object.material) ? object.material : [object.material]).map((source: any) => {
                const sourceName = source.name || ''
                const isEyeMaterial = /(?:eye|high-poly)/i.test(sourceName)
                const isBodyMaterial = !isEyeMaterial && sourceName !== 'Director_Brow'
                // 中性女性人台用高粗糙、低对比的自发光材质弱化胸腹等裸模明暗细节；
                // 网格、骨架、轮廓和姿势精度保持不变。
                const material = source.clone()
                material.name = sourceName
                if (isBodyMaterial) {
                  material.color.setHex(color)
                  if (neutralPresentation && material.emissive?.setHex) {
                    material.emissive.setHex(color)
                    material.emissiveIntensity = 0.45
                    material.metalness = 0
                    material.roughness = 1
                  } else {
                    material.metalness = 0.02
                    material.roughness = 0.7
                  }
                } else if (material.name === 'Director_Brow') {
                  material.color.setHex(0x17191e)
                } else if (isEyeMaterial) {
                  material.color.setHex(0xffffff)
                  material.metalness = 0
                  material.roughness = 0.32
                }
                material.needsUpdate = true
                return material
              })
              object.material = Array.isArray(object.material) ? materials : materials[0]
            }
            if (!object.isBone) return
            const jointName = DETAILED_BONE_MAP[object.name]
            if (jointName) object.userData.joint = jointName

          })

          // 原模型是 T pose。直接用“肩 → 肘”的世界方向求落臂旋转，
          // 不假设骨骼局部 +Y（不同导出器的局部轴并不一致）。
          model.updateMatrixWorld(true)
          model.traverse((object: any) => {
            if (object.name !== 'upperarm_l' && object.name !== 'upperarm_r') return
            const lowerArmName = object.name === 'upperarm_l' ? 'lowerarm_l' : 'lowerarm_r'
            const lowerArm = object.children.find((child: any) => child.name === lowerArmName)
            if (!lowerArm) return
            const shoulderPosition = object.getWorldPosition(new THREE.Vector3())
            const elbowPosition = lowerArm.getWorldPosition(new THREE.Vector3())
            const armDirection = elbowPosition.sub(shoulderPosition).normalize()
            if (armDirection.lengthSq() < 0.5) return
            const worldRotation = object.getWorldQuaternion(new THREE.Quaternion())
            const targetWorld = new THREE.Quaternion()
              .setFromUnitVectors(armDirection, new THREE.Vector3(0, -1, 0))
              .multiply(worldRotation)
            const parentWorld = object.parent?.getWorldQuaternion(new THREE.Quaternion()) || new THREE.Quaternion()
            object.quaternion.copy(parentWorld.invert().multiply(targetWorld))
          })
          model.updateMatrixWorld(true)
          model.traverse((object: any) => {
            if (!object.isBone) return
            if (object.parent?.isBone && (object.name.startsWith('lowerarm_') || object.name.startsWith('calf_'))) {
              // 肘向人物正面屈、膝向人物背面屈；轴先存到父骨骼局部空间，
              // 摆姿时会随上臂/大腿的 pitch、spread、twist 一起转动。
              const characterAxis = object.name.startsWith('lowerarm_')
                ? new THREE.Vector3(-1, 0, 0)
                : new THREE.Vector3(1, 0, 0)
              const parentWorld = object.parent.getWorldQuaternion(new THREE.Quaternion())
              const localBendAxis = characterAxis.applyQuaternion(parentWorld.invert()).normalize()
              object.userData.poseBendAxisLocal = [localBendAxis.x, localBendAxis.y, localBendAxis.z]
            }
            object.userData.poseBasePosition = [object.position.x, object.position.y, object.position.z]
            object.userData.poseBaseQuaternion = [object.quaternion.x, object.quaternion.y, object.quaternion.z, object.quaternion.w]
            object.userData.poseBaseScale = [object.scale.x, object.scale.y, object.scale.z]
          })

          model.updateMatrixWorld(true)
          const unscaledBounds = new THREE.Box3().setFromObject(model, true)
          const sourceHeight = Math.max(0.001, unscaledBounds.max.y - unscaledBounds.min.y)
          // FBX 导出器以厘米级父节点保存同一套模型，因此这里只做整个人体的等比单位换算。
          // 三轴始终使用同一个数值；体宽、厚度、头身比和年龄差异全部来自各自独立网格。
          const assetUnitScale = sourceHeight > 5 ? 0.1 : 1
          rigRoot.scale.setScalar(assetUnitScale)
          root.userData.bodyUnitScale = sourceHeight * assetUnitScale / 1.82
          root.userData.sourceHeight = sourceHeight
          root.updateMatrixWorld(true)
          const bounds = new THREE.Box3().setFromObject(root, true)
          const restY = bounds.isEmpty() || !isFinite(bounds.min.y) ? 0 : -bounds.min.y
          rigRoot.position.y = restY
          rigRoot.userData.restY = restY
          root.updateMatrixWorld(true)
          return root
        }

        const makeMannequin = (color: number, bodyType: DirectorBodyType = 'mannequin') => {
          const detailed = makeDetailedMannequin(color, bodyType)
          if (detailed) return detailed
          const preset = getDirectorBodyPreset(bodyType)
          const p = preset.proportions
          const mat = new THREE.MeshStandardMaterial({ color, metalness: 0.04, roughness: 0.72 })
          const detailMat = new THREE.MeshStandardMaterial({ color: 0x2a2d33, metalness: 0.02, roughness: 0.82 })
          const root = new THREE.Group()
          root.userData.kind = '人台'
          root.userData.bodyType = preset.bodyType
          root.userData.poseOffsetY = 0
          root.userData.bodyUnitScale = 0.78 // 保持成人素体约 1.8m，兼容现有 35mm 默认机位与镜别预设

          const mesh = (
            geo: any,
            position: [number, number, number] = [0, 0, 0],
            scale: [number, number, number] = [1, 1, 1],
            material: any = mat
          ) => {
            const m = new THREE.Mesh(geo, material)
            m.position.set(position[0], position[1], position[2])
            m.scale.set(scale[0], scale[1], scale[2])
            return m
          }
          const joint = (name: string, x: number, y: number, z: number) => {
            const g = new THREE.Group()
            g.position.set(x, y, z)
            g.userData.joint = name
            return g
          }
          const addJointBall = (g: any, radius: number) => {
            g.add(mesh(new THREE.SphereGeometry(radius, 16, 14), [0, 0, 0], [p.jointRadiusScale, p.jointRadiusScale, p.jointRadiusScale]))
          }
          const addSegment = (g: any, radius: number, length: number) => {
            g.add(mesh(new THREE.CapsuleGeometry(radius, length, 8, 14), [0, -(length * 0.5 + radius), 0]))
          }

          // rigRoot 负责姿势预设的整体俯仰/偏移；restY 在构建末尾按包围盒自动贴地。
          const rigRoot = joint('骨盆', 0, 0, 0)
          rigRoot.userData.rigRoot = true
          rigRoot.scale.setScalar(root.userData.bodyUnitScale)
          root.add(rigRoot)

          const pelvis = mesh(new THREE.SphereGeometry(p.pelvisRadius, 22, 18), [0, p.hipY, 0], p.pelvisScale)
          rigRoot.add(pelvis)

          // 胸腹分成两个体块，以髋部为旋转枢轴；比旧版单胶囊更能表达弯腰和体型差异。
          const torso = joint('胸', 0, p.hipY, 0)
          rigRoot.add(torso)
          const abdomenY = p.pelvisRadius * 0.55 + p.torsoLowerHeight * 0.5
          const chestY = abdomenY + p.torsoLowerHeight * 0.5 + p.torsoUpperHeight * 0.5 + p.torsoUpperRadius * 0.12
          torso.add(mesh(new THREE.CapsuleGeometry(p.torsoLowerRadius, p.torsoLowerHeight, 10, 18), [0, abdomenY, 0], p.torsoLowerScale))
          torso.add(mesh(new THREE.CapsuleGeometry(p.torsoUpperRadius, p.torsoUpperHeight, 12, 20), [0, chestY, 0], p.torsoUpperScale))
          const chestRing = mesh(
            new THREE.TorusGeometry(p.torsoUpperRadius * p.torsoUpperScale[0] * 0.77, Math.max(0.005, p.torsoUpperRadius * 0.026), 8, 32),
            [0, chestY - p.torsoUpperHeight * 0.38, 0],
            [1, p.torsoUpperScale[2] / p.torsoUpperScale[0], 1],
            detailMat
          )
          chestRing.rotation.x = Math.PI / 2
          torso.add(chestRing)

          const neckY = chestY + p.torsoUpperHeight * 0.5 + p.neckHeight * 0.5 + p.torsoUpperRadius * 0.18
          const neck = joint('颈', 0, neckY, 0)
          torso.add(neck)
          neck.add(mesh(new THREE.CylinderGeometry(p.neckRadius * 0.9, p.neckRadius, p.neckHeight, 16)))
          const headY = p.neckHeight * 0.5 + p.headRadius * 0.78
          const head = joint('头', 0, headY, 0)
          neck.add(head)
          head.add(mesh(new THREE.SphereGeometry(p.headRadius, 24, 20), [0, 0, 0], p.headScale))
          head.add(mesh(new THREE.SphereGeometry(p.headRadius * 0.36, 14, 10), [0, -p.headRadius * 0.08, p.faceOffsetZ], [0.72, 0.52, 0.26]))
          const eyeY = p.headRadius * 0.15
          const eyeX = p.headRadius * 0.25
          const eyeZ = p.faceOffsetZ + p.headRadius * 0.08
          head.add(mesh(new THREE.SphereGeometry(p.eyeRadius, 9, 7), [-eyeX, eyeY, eyeZ], [1, 0.62, 0.36], detailMat))
          head.add(mesh(new THREE.SphereGeometry(p.eyeRadius, 9, 7), [eyeX, eyeY, eyeZ], [1, 0.62, 0.36], detailMat))
          const nose = mesh(new THREE.ConeGeometry(p.headRadius * 0.075, p.headRadius * 0.24, 8), [0, -p.headRadius * 0.02, eyeZ + p.headRadius * 0.08], [0.75, 1, 0.75], detailMat)
          nose.rotation.x = Math.PI / 2
          head.add(nose)
          head.add(mesh(new THREE.BoxGeometry(p.headRadius * 0.34, p.headRadius * 0.035, p.headRadius * 0.025), [0, -p.headRadius * 0.2, eyeZ + p.headRadius * 0.035], [1, 1, 1], detailMat))

          const shoulderY = chestY + p.torsoUpperHeight * 0.16
          const arm = (side: 'L' | 'R') => {
            const isLeft = side === 'L'
            const sh = joint(isLeft ? '左肩' : '右肩', isLeft ? -p.shoulderWidth : p.shoulderWidth, shoulderY, 0)
            torso.add(sh)
            addJointBall(sh, p.shoulderRadius)
            addSegment(sh, p.upperArmRadius, p.upperArmLength)
            const elbowY = -(p.upperArmLength + p.upperArmRadius + p.elbowRadius)
            const elbow = joint(isLeft ? '左肘' : '右肘', 0, elbowY, 0)
            elbow.userData.poseBendAxisLocal = [-1, 0, 0]
            sh.add(elbow)
            addJointBall(elbow, p.elbowRadius)
            addSegment(elbow, p.forearmRadius, p.forearmLength)
            const wristY = -(p.forearmLength + p.forearmRadius + p.wristRadius)
            const wrist = joint(isLeft ? '左腕' : '右腕', 0, wristY, 0)
            elbow.add(wrist)
            addJointBall(wrist, p.wristRadius)
            const palm = mesh(new THREE.SphereGeometry(p.handRadius, 14, 12), [0, -p.handRadius * 1.05, 0.015], p.handScale)
            wrist.add(palm)
            const thumb = mesh(
              new THREE.CapsuleGeometry(p.handRadius * 0.24, p.handRadius * 0.5, 6, 8),
              [isLeft ? -p.handRadius * 0.62 : p.handRadius * 0.62, -p.handRadius * 0.95, p.handRadius * 0.28],
              [0.58, 0.82, 0.52]
            )
            thumb.rotation.z = isLeft ? 0.68 : -0.68
            wrist.add(thumb)
          }
          arm('L')
          arm('R')

          const leg = (side: 'L' | 'R') => {
            const isLeft = side === 'L'
            const hip = joint(isLeft ? '左髋' : '右髋', isLeft ? -p.legSpread : p.legSpread, p.hipY - p.pelvisRadius * 0.22, 0)
            rigRoot.add(hip)
            addJointBall(hip, p.thighRadius * 1.08)
            addSegment(hip, p.thighRadius, p.thighLength)
            const kneeY = -(p.thighLength + p.thighRadius + p.kneeRadius)
            const knee = joint(isLeft ? '左膝' : '右膝', 0, kneeY, 0)
            knee.userData.poseBendAxisLocal = [1, 0, 0]
            hip.add(knee)
            addJointBall(knee, p.kneeRadius)
            addSegment(knee, p.calfRadius, p.calfLength)
            const ankleY = -(p.calfLength + p.calfRadius + p.ankleRadius)
            const ankle = joint(isLeft ? '左踝' : '右踝', 0, ankleY, 0)
            knee.add(ankle)
            addJointBall(ankle, p.ankleRadius)
            const foot = mesh(
              new THREE.CapsuleGeometry(p.footRadius, p.footLength, 8, 14),
              [0, -p.footRadius * 0.72, p.footLength * 0.5],
              p.footScale
            )
            foot.rotation.x = Math.PI / 2
            ankle.add(foot)
            ankle.add(mesh(new THREE.SphereGeometry(p.footRadius, 14, 10), [0, -p.footRadius * 0.72, p.footLength * 1.18], [p.footScale[0] * 0.92, p.footScale[1] * 0.72, p.footScale[2] * 0.48]))
          }
          leg('L')
          leg('R')

          root.updateMatrixWorld(true)
          const bounds = new THREE.Box3().setFromObject(root)
          const restY = bounds.isEmpty() || !isFinite(bounds.min.y) ? 0 : -bounds.min.y
          rigRoot.position.y = restY
          rigRoot.userData.restY = restY
          root.updateMatrixWorld(true)
          return root
        }

        let curRoot: any = null
        let curJoint: any = null
        const roundTransform = (value: number) => Number(value.toFixed(3))
        const readTransform = (root: any): TransformDraft => ({
          position: [roundTransform(root.position.x), roundTransform(root.position.y), roundTransform(root.position.z)],
          rotation: [
            roundTransform((root.rotation.x * 180) / Math.PI),
            roundTransform((root.rotation.y * 180) / Math.PI),
            roundTransform((root.rotation.z * 180) / Math.PI)
          ],
          scale: [roundTransform(root.scale.x), roundTransform(root.scale.y), roundTransform(root.scale.z)]
        })
        const emitTransform = () => {
          if (!disposed) setTransformDraft(curRoot ? readTransform(curRoot) : null)
        }
        const baseJointQuaternion = (joint: any) => {
          const value = joint?.userData?.poseBaseQuaternion
          return Array.isArray(value)
            ? new THREE.Quaternion(value[0], value[1], value[2], value[3])
            : new THREE.Quaternion()
        }
        const readJointDeltaDegrees = (joint: any): [number, number, number] => {
          if (!joint) return [0, 0, 0]
          // applyMannequinPose 的局部关系为 current = delta * base。
          const delta = joint.quaternion.clone().multiply(baseJointQuaternion(joint).invert())
          const euler = new THREE.Euler().setFromQuaternion(delta, 'XYZ')
          return [euler.x, euler.y, euler.z].map((value) => roundTransform(THREE.MathUtils.radToDeg(value))) as [number, number, number]
        }
        const writeJointDeltaDegrees = (joint: any, rotation: [number, number, number]) => {
          const euler = new THREE.Euler(
            THREE.MathUtils.degToRad(rotation[0]),
            THREE.MathUtils.degToRad(rotation[1]),
            THREE.MathUtils.degToRad(rotation[2]),
            'XYZ'
          )
          const delta = new THREE.Quaternion().setFromEuler(euler)
          joint.quaternion.copy(delta.multiply(baseJointQuaternion(joint)))
        }
        const clampJointObject = (joint: any) => {
          const name = String(joint?.userData?.joint || '')
          const rotation = readJointDeltaDegrees(joint).map((value, axis) =>
            clampDirectorJointDegrees(name, axis as DirectorJointAxis, value)
          ) as [number, number, number]
          writeJointDeltaDegrees(joint, rotation)
        }
        const collectJointDeltaDegrees = (root: any): Record<string, [number, number, number]> => {
          const rotations: Record<string, [number, number, number]> = {}
          root?.traverse?.((joint: any) => {
            const name = joint.userData?.joint
            if (name && !rotations[name]) rotations[name] = readJointDeltaDegrees(joint)
          })
          return rotations
        }
        const emitPoseEditor = () => {
          if (disposed) return
          const isPoseTarget = curRoot && (curRoot.userData.kind === '人台' || curRoot.userData.rigged)
          if (!isPoseTarget) {
            setJointEditor(null)
            setPoseSafety({ level: 'safe', issues: [] })
            return
          }
          setJointEditor(curJoint ? { name: curJoint.userData.joint, rotation: readJointDeltaDegrees(curJoint) } : null)
          setPoseSafety(validateDirectorJointRotations(collectJointDeltaDegrees(curRoot)))
        }
        const findJointByName = (root: any, name: string) => {
          let found: any = null
          root?.traverse?.((joint: any) => { if (!found && joint.userData?.joint === name) found = joint })
          return found
        }
        const attachByMode = () => {
          if (!curRoot || curMode === 'pose' || curRoot.userData.locked) { tcontrol.detach(); return }
          tcontrol.setMode(curMode)
          tcontrol.attach(curRoot)
        }
        const onTransformObjectChange = () => emitTransform()
        tcontrol.addEventListener('objectChange', onTransformObjectChange)
        const select = (root: any | null) => {
          if (curRoot !== root) curJoint = null
          curRoot = root
          attachByMode()
          emitTransform()
          emitPoseEditor()
          if (!disposed) {
            const sub = subjects.find((s) => s.obj === root)
            setSelId(sub ? sub.id : null)
            setSelKind(root ? root.userData.kind || '' : null)
          }
        }
        const addSubject = (obj: any, kind: string, desc?: string, colorName?: string) => {
          const id = uid('obj')
          const name = nextName(kind)
          obj.userData.kind = kind
          obj.userData.locked = false
          scene.add(obj)
          subjects.push({ obj, kind, id, name, desc, colorName })
          sync()
          select(obj)
          commit()
          return id
        }
        // 取第一个未被占用的锚定色（删过人台后按数量取模会撞车——两个人台同色=角色绑定必乱）
        const nextMannequinColor = () => {
          const used = new Set(subjects.filter((s) => s.kind === '人台').map((s) => s.colorName))
          return MANNEQUIN_COLORS.find((c) => !used.has(c.name)) || MANNEQUIN_COLORS[used.size % MANNEQUIN_COLORS.length]
        }
        const addMannequin = () => {
          const c = nextMannequinColor()
          const g = makeMannequin(c.hex, 'mannequin')
          g.position.set((subjects.length % 3) * 0.9 - 0.9, 0, 0)
          addSubject(g, '人台', undefined, c.name)
        }
        const findRigRoot = (root: any) => {
          let rig: any = null
          root?.traverse?.((c: any) => { if (!rig && c.userData?.rigRoot) rig = c })
          return rig
        }
        const groundMannequinRig = (root: any) => {
          const rig = findRigRoot(root)
          if (!rig) return
          root.updateMatrixWorld(true)
          const inverseRoot = root.matrixWorld.clone().invert()
          const localBounds = new THREE.Box3()
          root.traverse((c: any) => {
            if (!c.isMesh || !c.geometry) return
            // SkinnedMesh 的 geometry.boundingBox 是绑定姿势；每次姿势变化后必须重算蒙皮顶点包围盒，
            // 否则跪/坐时仍按站立脚底落地，视觉上会整个人悬空。
            if (c.isSkinnedMesh) c.computeBoundingBox?.()
            else if (!c.geometry.boundingBox) c.geometry.computeBoundingBox?.()
            const boundingBox = c.isSkinnedMesh ? c.boundingBox : c.geometry.boundingBox
            if (!boundingBox) return
            const relative = inverseRoot.clone().multiply(c.matrixWorld)
            localBounds.union(boundingBox.clone().applyMatrix4(relative))
          })
          if (localBounds.isEmpty() || !isFinite(localBounds.min.y)) return
          rig.position.y -= localBounds.min.y
          root.userData.poseOffsetY = rig.position.y - Number(rig.userData.restY || 0)
          root.updateMatrixWorld(true)
        }
        const applyMannequinPose = (
          root: any,
          name: string,
          map: Record<string, [number, number, number]>,
          offsetY = 0,
          controls: Record<string, number> = {}
        ) => {
          if (!root || root.userData.kind !== '人台') return
          root.traverse((c: any) => {
            if (c.userData?.poseBaseQuaternion) {
              const position = c.userData.poseBasePosition
              const quaternion = c.userData.poseBaseQuaternion
              const scale = c.userData.poseBaseScale
              c.position.set(position[0], position[1], position[2])
              c.quaternion.set(quaternion[0], quaternion[1], quaternion[2], quaternion[3])
              c.scale.set(scale[0], scale[1], scale[2])
            } else if (c.userData?.joint) {
              c.rotation.set(0, 0, 0)
            }
          })
          const rig = findRigRoot(root)
          const scaledOffset = offsetY * Number(root.userData.bodyUnitScale || 1)
          if (rig) rig.position.y = Number(rig.userData.restY || 0) + scaledOffset
          root.userData.poseOffsetY = scaledOffset
          const detailedDegrees = root.userData.detailedMannequin ? getDirectorDetailedJointDegrees(controls) : null
          if (detailedDegrees) {
            const joints: Record<string, any> = {}
            root.traverse((c: any) => { if (c.userData?.joint) joints[c.userData.joint] = c })
            root.updateMatrixWorld(true)
            const characterRotation = root.getWorldQuaternion(new THREE.Quaternion())
            const axes = [
              new THREE.Vector3(1, 0, 0).applyQuaternion(characterRotation).normalize(),
              new THREE.Vector3(0, 1, 0).applyQuaternion(characterRotation).normalize(),
              new THREE.Vector3(0, 0, 1).applyQuaternion(characterRotation).normalize()
            ]
            const rotateWorld = (object: any, axis: any, degrees: number) => {
              if (!object || !degrees) return
              root.updateMatrixWorld(true)
              const worldRotation = object.getWorldQuaternion(new THREE.Quaternion())
              const targetWorld = new THREE.Quaternion()
                .setFromAxisAngle(axis, THREE.MathUtils.degToRad(degrees))
                .multiply(worldRotation)
              const parentWorld = object.parent?.getWorldQuaternion(new THREE.Quaternion()) || new THREE.Quaternion()
              object.quaternion.copy(parentWorld.invert().multiply(targetWorld))
            }
            const twistKeys: Record<string, string> = {
              左肩: 'leftShoulder.twist', 右肩: 'rightShoulder.twist',
              左腕: 'leftHand.twist', 右腕: 'rightHand.twist',
              左髋: 'leftHip.twist', 右髋: 'rightHip.twist',
              左踝: 'leftFoot.twist', 右踝: 'rightFoot.twist'
            }
            const bendKeys: Record<string, string> = {
              左肘: 'leftElbow.bend', 右肘: 'rightElbow.bend',
              左膝: 'leftKnee.bend', 右膝: 'rightKnee.bend'
            }
            const order = ['骨盆', '胸', '头', '左肩', '右肩', '左肘', '右肘', '左腕', '右腕', '左髋', '右髋', '左膝', '右膝', '左踝', '右踝']
            for (const jointName of order) {
              const object = joints[jointName]
              const degrees = detailedDegrees[jointName]
              if (!object || !degrees) continue
              const bendKey = bendKeys[jointName]
              if (bendKey && object.userData.poseBendAxisLocal && object.parent) {
                root.updateMatrixWorld(true)
                const local = object.userData.poseBendAxisLocal
                const bendAxis = new THREE.Vector3(local[0], local[1], local[2])
                  .applyQuaternion(object.parent.getWorldQuaternion(new THREE.Quaternion()))
                  .normalize()
                rotateWorld(object, bendAxis, Number(controls[bendKey] || 0))
              } else {
                const isBallJoint = jointName.endsWith('肩') || jointName.endsWith('髋')
                if (isBallJoint) {
                  // 球窝关节先前后抬、再内外展；反过来会让 T 型/抱臂里的 pitch 在手臂水平后失效。
                  rotateWorld(object, axes[0], degrees[0])
                  rotateWorld(object, axes[2], degrees[2])
                } else {
                  rotateWorld(object, axes[1], degrees[1])
                  rotateWorld(object, axes[2], degrees[2])
                  rotateWorld(object, axes[0], degrees[0])
                }
              }
              const twistKey = twistKeys[jointName]
              const twist = twistKey ? Number(controls[twistKey] || 0) : 0
              if (twist) {
                root.updateMatrixWorld(true)
                const limbAxis = new THREE.Vector3(0, 1, 0).applyQuaternion(object.getWorldQuaternion(new THREE.Quaternion())).normalize()
                rotateWorld(object, limbAxis, twist)
              }
            }
          } else {
            root.traverse((c: any) => {
              const jointName = c.userData?.joint
              if (jointName && map[jointName]) c.rotation.set(map[jointName][0], map[jointName][1], map[jointName][2])
            })
          }
          root.userData.poseName = name === '站立' ? '' : name
          root.userData.poseSchemaVersion = 2
          groundMannequinRig(root)
          if (root === curRoot) emitPoseEditor()
        }
        const selectJointByName = (name: string) => {
          if (!curRoot || curRoot.userData.locked || (curRoot.userData.kind !== '人台' && !curRoot.userData.rigged)) return
          curJoint = findJointByName(curRoot, name)
          emitPoseEditor()
        }
        const setSelectedJointAxis = (axis: DirectorJointAxis, raw: number) => {
          if (!curRoot || !curJoint || curRoot.userData.locked) return
          const rotation = readJointDeltaDegrees(curJoint)
          rotation[axis] = clampDirectorJointDegrees(curJoint.userData.joint || '', axis, raw)
          writeJointDeltaDegrees(curJoint, rotation)
          curRoot.userData.poseName = '自定义'
          curRoot.updateMatrixWorld(true)
          sync()
          emitPoseEditor()
        }
        const commitJointEdit = () => {
          if (!curRoot || !curJoint || curRoot.userData.locked) return
          curRoot.userData.poseName = '自定义'
          sync()
          emitPoseEditor()
          commit()
        }
        const resetSelectedJoint = () => {
          if (!curRoot || !curJoint || curRoot.userData.locked) return
          curJoint.quaternion.copy(baseJointQuaternion(curJoint))
          curRoot.userData.poseName = '自定义'
          curRoot.updateMatrixWorld(true)
          sync()
          emitPoseEditor()
          commit()
        }
        let bodySwitchRequest = 0
        const setSelectedBodyType = async (bodyType: DirectorBodyType) => {
          const sub = subjects.find((s) => s.obj === curRoot)
          if (!sub || sub.kind !== '人台' || sub.obj.userData.locked) return
          const old = sub.obj
          if (getDirectorBodyPreset(old.userData.bodyType).bodyType === bodyType) return
          const request = ++bodySwitchRequest
          if (!disposed) setBodyLoading(bodyType)
          await ensureDirectorTemplate(bodyType)
          if (disposed || request !== bodySwitchRequest || !subjects.includes(sub) || sub.obj !== old) {
            if (!disposed && request === bodySwitchRequest) setBodyLoading(null)
            return
          }
          const joints: Record<string, [number, number, number]> = {}
          old.traverse((c: any) => {
            const jointName = c.userData?.joint
            if (jointName) joints[jointName] = [c.rotation.x, c.rotation.y, c.rotation.z]
          })
          let color = MANNEQUIN_COLORS.find((c) => c.name === sub.colorName)?.hex
          if (color == null) {
            old.traverse((c: any) => {
              const hex = c.material?.color?.getHex?.()
              if (color == null && typeof hex === 'number' && hex !== 0x2a2d33) color = hex
            })
          }
          const replacement = makeMannequin(color ?? 0xc7ccd6, bodyType)
          replacement.position.copy(old.position)
          replacement.rotation.copy(old.rotation)
          replacement.scale.copy(old.scale)
          replacement.visible = old.visible
          replacement.userData.locked = !!old.userData.locked
          const presetPose = getDirectorPose(old.userData.poseName || '站立')
          if (presetPose) {
            applyMannequinPose(replacement, presetPose.k, presetPose.m, presetPose.offsetY || 0, presetPose.controls)
          } else {
            replacement.userData.poseName = old.userData.poseName || ''
            replacement.userData.poseOffsetY = Number(old.userData.poseOffsetY || 0)
            const nextRig = findRigRoot(replacement)
            if (nextRig) nextRig.position.y = Number(nextRig.userData.restY || 0) + replacement.userData.poseOffsetY
            replacement.traverse((c: any) => {
              const jointName = c.userData?.joint
              if (jointName && joints[jointName]) c.rotation.set(joints[jointName][0], joints[jointName][1], joints[jointName][2])
            })
            groundMannequinRig(replacement)
          }
          tcontrol.detach()
          scene.remove(old)
          scene.add(replacement)
          sub.obj = replacement
          disposeTree(old)
          select(replacement)
          sync()
          commit()
          if (!disposed && request === bodySwitchRequest) setBodyLoading(null)
        }
        const addProp = () => {
          const m = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), new THREE.MeshStandardMaterial({ color: 0x8a93a6, roughness: 0.8 }))
          m.position.set(0.7, 0.25, 0.6)
          addSubject(m, '道具')
        }
        const disposeTree = (o: any) => {
          o.traverse?.((c: any) => {
            const sharedDirectorAsset = !!c.userData?.directorSharedAssets
            if (!sharedDirectorAsset) c.geometry?.dispose?.()
            const m = c.material
            ;(Array.isArray(m) ? m : [m]).forEach((mm: any) => {
              if (!mm) return
              if (!sharedDirectorAsset) {
                ;['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap'].forEach((k) => mm[k]?.dispose?.())
              }
              mm.dispose?.()
            })
          })
        }
        const getPosePreviews = (bodyType: DirectorBodyType) => directorPosePreviewCache.load(bodyType, async () => {
          await ensureDirectorTemplate(bodyType)
          if (disposed) throw new Error('director disposed')
          const canvas = document.createElement('canvas')
          const width = 120
          const height = 90
          const previewRenderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'low-power' })
          previewRenderer.setPixelRatio(1)
          previewRenderer.setSize(width, height, false)
          const previewScene = new THREE.Scene()
          previewScene.background = new THREE.Color(0x202126)
          previewScene.add(new THREE.HemisphereLight(0xffffff, 0x30323a, 1.55))
          const previewKey = new THREE.DirectionalLight(0xfff2dc, 1.2)
          previewKey.position.set(2.5, 4, 3.5)
          previewScene.add(previewKey)
          const previewCamera = new THREE.PerspectiveCamera(30, width / height, 0.01, 100)
          const model = makeMannequin(0xb9aa8d, bodyType)
          previewScene.add(model)
          const result: Record<string, string> = {}
          try {
            for (let index = 0; index < POSES.length; index++) {
              if (index > 0 && index % 4 === 0) {
                await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
                if (disposed) throw new Error('director disposed')
              }
              const pose = POSES[index]
              applyMannequinPose(model, pose.k, pose.m, pose.offsetY || 0, pose.controls)
              model.updateMatrixWorld(true)
              const bounds = new THREE.Box3().setFromObject(model, true)
              const size = bounds.getSize(new THREE.Vector3())
              const center = bounds.getCenter(new THREE.Vector3())
              const halfFov = Math.tan(THREE.MathUtils.degToRad(previewCamera.fov / 2))
              const verticalFit = Math.max(0.2, size.y) / (2 * halfFov)
              const horizontalFit = Math.max(0.2, size.x) / (2 * halfFov * previewCamera.aspect)
              const distance = Math.max(verticalFit, horizontalFit) * 1.16
              previewCamera.position.set(center.x, center.y + size.y * 0.02, center.z + distance)
              previewCamera.lookAt(center)
              previewCamera.updateProjectionMatrix()
              previewRenderer.render(previewScene, previewCamera)
              result[pose.k] = canvas.toDataURL('image/jpeg', 0.76)
            }
            return result
          } finally {
            previewScene.remove(model)
            disposeTree(model)
            previewRenderer.dispose()
            previewRenderer.forceContextLoss()
          }
        })
        // 还原缩放：兼容旧数据(number=均匀)与新数据([x,y,z]=非均匀)
        const applyScale = (o: any, s: any) => { if (Array.isArray(s)) o.scale.set(s[0], s[1], s[2]); else o.scale.setScalar(s || 1) }
        // 解析 GLB/GLTF → 标记 Mixamo 骨骼 + rigged + kind=模型（不归一化/不落场景，由调用方决定）
        const parseGLB = (ab: ArrayBuffer, onOk: (obj: any) => void, onErr?: (e: any) => void) => {
          const loader = new GLTFLoader()
          loader.parse(ab, '', (gltf: any) => {
            const obj = gltf.scene || gltf.scenes?.[0]
            if (!obj) { onErr?.(new Error('模型为空')); return }
            let bones = 0
            obj.traverse((c: any) => {
              const nl = String(c.name || '').toLowerCase()
              const hit = MIXAMO_MAP.find((mm) => nl.endsWith(mm.suf))
              if (hit && !c.userData.joint) { c.userData.joint = hit.joint; bones++ }
            })
            obj.userData.rigged = bones >= 6
            obj.userData.kind = '模型'
            onOk(obj)
          }, (err: any) => onErr?.(err))
        }
        const attachStore = () => window.mulby?.storage?.attachment
        // 用户导入：解析 → 归一化 → GLB 字节存 attachment（据此随工程持久化）→ 落场景
        const importGLTF = (arrayBuffer: ArrayBuffer, fname: string) => {
          const gen = sceneGen // 导入异步期间若发生整体重建(undo)则丢弃本次结果
          parseGLB(
            arrayBuffer,
            async (obj: any) => {
              if (disposed || gen !== sceneGen) { disposeTree(obj); return }
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
              const assetId = uid('glb')
              obj.userData.assetId = assetId
              // 存字节用于持久化；失败（如 >50MB / 存储不可用）则本会话仍可用但不随工程保存
              const mime = /\.gltf$/i.test(fname) ? 'model/gltf+json' : 'model/gltf-binary'
              let stored = false
              // put 返回 { ok, error }（旧宿主可能返回 boolean）——对象恒 !== false，必须取 .ok
              try { const r = await attachStore()?.put?.(assetId, arrayBuffer, mime); stored = r === true || !!(r && (r as any).ok) } catch { stored = false }
              if (disposed || gen !== sceneGen) { disposeTree(obj); return }
              if (!stored) { obj.userData.assetId = undefined; toast('模型较大或存储不可用：本次可用，但不会随工程保存', 'warning') }
              const id = uid('obj')
              scene.add(obj)
              subjects.push({ obj, kind: '模型', id, name: k })
              sync()
              select(obj)
              commit()
              toast('已导入模型：' + k, 'success')
            },
            (err: any) => { if (!disposed) toast('模型导入失败（.gltf 仅支持全内嵌；Draco 压缩暂不支持）：' + (err?.message || String(err)), 'error') }
          )
        }
        // 重开/撤销时按持久化状态重建导入模型：取 attachment 字节 → parse → 应用变换/姿势（不归一化）
        const buildModelFromState = (st: any): Promise<void> => {
          const store = attachStore()
          if (!st.assetId || !store?.get) return Promise.resolve()
          const gen = sceneGen // 本次重建的代次：解析完成时若已过期(又一次 undo)则丢弃
          return Promise.resolve(store.get(st.assetId))
            .then(
              (bytes: any) =>
                new Promise<void>((resolve) => {
                  if (disposed || gen !== sceneGen) { resolve(); return }
                  if (!bytes) { toast('导入模型数据缺失，无法恢复：' + (st.name || ''), 'warning'); resolve(); return }
                  const ab: ArrayBuffer = bytes.buffer ? bytes.buffer.slice(bytes.byteOffset || 0, (bytes.byteOffset || 0) + bytes.byteLength) : bytes
                  parseGLB(
                    ab,
                    (obj: any) => {
                      if (disposed || gen !== sceneGen) { disposeTree(obj); resolve(); return }
                      obj.userData.assetId = st.assetId
                      obj.userData.locked = !!st.locked
                      obj.visible = st.visible !== false
                      obj.position.set(st.pos[0], st.pos[1], st.pos[2])
                      obj.rotation.set(st.rot[0], st.rot[1], st.rot[2])
                      applyScale(obj, st.scale)
                      if (st.poseName) obj.userData.poseName = st.poseName
                      if (st.joints) obj.traverse((c: any) => { const j = c.userData && c.userData.joint; if (j && st.joints[j]) c.rotation.set(st.joints[j][0], st.joints[j][1], st.joints[j][2]) })
                      const id = uid('obj')
                      scene.add(obj)
                      subjects.push({ obj, kind: '模型', id, name: st.name || '模型', desc: st.desc })
                      sync()
                      resolve()
                    },
                    (err: any) => { if (!disposed) toast('恢复导入模型失败：' + (err?.message || String(err)), 'warning'); resolve() }
                  )
                })
            )
            .catch(() => {})
        }

        const findById = (id: string) => subjects.find((s) => s.id === id)
        const removeById = (id: string) => {
          const sub = findById(id)
          if (!sub) return
          if (curRoot === sub.obj) { tcontrol.detach(); curRoot = null }
          scene.remove(sub.obj)
          disposeTree(sub.obj)
          subjects.splice(subjects.indexOf(sub), 1)
          sync()
          if (curRoot === null && !disposed) { setSelId(null); setSelKind(null) }
          if (curRoot === null && !disposed) setTransformDraft(null)
          commit()
        }
        const duplicateById = (id: string) => {
          const sub = findById(id)
          if (!sub) return
          if (sub.kind === '人台') {
            const c = nextMannequinColor()
            const clone = makeMannequin(c.hex, getDirectorBodyPreset(sub.obj.userData.bodyType).bodyType)
            clone.position.copy(sub.obj.position)
            clone.position.x += 0.7
            clone.rotation.copy(sub.obj.rotation)
            clone.scale.copy(sub.obj.scale)
            clone.visible = sub.obj.visible
            clone.userData.locked = false
            const presetPose = getDirectorPose(sub.obj.userData.poseName || '站立')
            if (presetPose) {
              applyMannequinPose(clone, presetPose.k, presetPose.m, presetPose.offsetY || 0, presetPose.controls)
            } else {
              const joints: Record<string, [number, number, number]> = {}
              sub.obj.traverse((joint: any) => {
                if (joint.userData?.joint) joints[joint.userData.joint] = [joint.rotation.x, joint.rotation.y, joint.rotation.z]
              })
              clone.traverse((joint: any) => {
                const saved = joints[joint.userData?.joint]
                if (saved) joint.rotation.set(saved[0], saved[1], saved[2])
              })
            }
            addSubject(clone, sub.kind, sub.desc, c.name)
            return
          }
          const clone = sub.obj.clone(true)
          clone.position.x += 0.7
          clone.userData.locked = false
          addSubject(clone, sub.kind, sub.desc)
        }
        const toggleVisById = (id: string) => {
          const sub = findById(id)
          if (!sub) return
          sub.obj.visible = !sub.obj.visible
          sync()
          commit()
        }
        const toggleLockById = (id: string) => {
          const sub = findById(id)
          if (!sub) return
          sub.obj.userData.locked = !sub.obj.userData.locked
          if (curRoot === sub.obj) attachByMode()
          sync()
          commit()
        }
        const lookAtSelected = () => {
          if (!curRoot) return
          const p = new THREE.Vector3()
          curRoot.getWorldPosition(p)
          orbit.target.set(p.x, p.y + 0.9, p.z)
        }

        // ── 拖拽摆姿：普通拖动旋转关节；Shift 拖手腕/脚踝时用两骨骼 IK 移动末端。 ──
        type PoseDrag =
          | { kind: 'rotate'; root: any; joint: any; sx: number; sy: number; startQ: any; parentInv: any }
          | { kind: 'ik'; root: any; joint: any; chain: any[]; plane: any }
        let posing: PoseDrag | null = null
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
          if (root.userData.locked) return
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
            curJoint = jnt
            emitPoseEditor()
            const name = String(jnt.userData.joint || '')
            const ikNames: Record<string, [string, string]> = {
              左腕: ['左肘', '左肩'], 右腕: ['右肘', '右肩'],
              左踝: ['左膝', '左髋'], 右踝: ['右膝', '右髋']
            }
            const chainNames = e.shiftKey ? ikNames[name] : undefined
            const chain = chainNames?.map((jointName) => findJointByName(root, jointName)).filter(Boolean) || []
            if (chain.length === 2) {
              const normal = cam.getWorldDirection(new THREE.Vector3()).normalize()
              const point = jnt.getWorldPosition(new THREE.Vector3())
              posing = { kind: 'ik', root, joint: jnt, chain, plane: new THREE.Plane().setFromNormalAndCoplanarPoint(normal, point) }
            } else {
              const parentWorld = jnt.parent.getWorldQuaternion(new THREE.Quaternion())
              posing = { kind: 'rotate', root, joint: jnt, sx: e.clientX, sy: e.clientY, startQ: jnt.quaternion.clone(), parentInv: parentWorld.clone().invert() }
            }
            orbit.enabled = false
            try { renderer.domElement.setPointerCapture(e.pointerId) } catch { /* ignore */ }
          }
        }
        const onPointerMove = (e: PointerEvent) => {
          if (!posing) return
          if (posing.kind === 'ik') {
            const rect = renderer.domElement.getBoundingClientRect()
            ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1)
            raycaster.setFromCamera(ndc, cam)
            const target = raycaster.ray.intersectPlane(posing.plane, new THREE.Vector3())
            if (target) {
              solveDirectorCcdIk({ root: posing.root, joints: posing.chain, effector: posing.joint, target })
              posing.chain.forEach(clampJointObject)
              posing.root.updateMatrixWorld(true)
            }
            return
          }
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
          const root = posing.root
          if (posing.kind === 'rotate') clampJointObject(posing.joint)
          posing = null
          orbit.enabled = true
          try { renderer.domElement.releasePointerCapture(e.pointerId) } catch { /* ignore */ }
          root.userData.poseName = '自定义'
          sync()
          emitPoseEditor()
          commit()
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

        // WebGL 上下文丢失/恢复：preventDefault 才允许浏览器恢复上下文；恢复后立刻补渲一帧（mac GPU 切换/内存压力会触发）
        const onCtxLost = (e: Event) => { e.preventDefault() }
        const onCtxRestored = () => { renderer.render(scene, cam) }
        renderer.domElement.addEventListener('webglcontextlost', onCtxLost)
        renderer.domElement.addEventListener('webglcontextrestored', onCtxRestored)

        let raf = 0
        const animate = () => {
          raf = requestAnimationFrame(animate)
          orbit.update()
          if (!shotLocked) { shotCam.copy(cam); shotTarget.copy(orbit.target) } // 未锁定：出图相机跟随视图
          shotCam.updateMatrixWorld(true)
          camHelper.update()
          camHelper.visible = shotLocked // 锁定时主视图显示出图取景框
          jointMarker.visible = curMode === 'pose' && !!curJoint && curRoot?.visible !== false
          if (jointMarker.visible) {
            curJoint.getWorldPosition(jointMarker.position)
            const markerScale = Math.max(0.65, Math.min(2.2, jointMarker.position.distanceTo(cam.position) * 0.16))
            jointMarker.scale.setScalar(markerScale)
          }
          renderer.render(scene, cam)
          if (pip && shotLocked) {
            camHelper.visible = false
            const markerVisible = jointMarker.visible
            jointMarker.visible = false
            pip.render(scene, shotCam)
            jointMarker.visible = markerVisible
          } // PiP 出图预览（不含取景框线和关节定位点）
        }
        animate()
        const ro = new ResizeObserver(() => {
          const w = mount.clientWidth || 1
          const h = mount.clientHeight || 1
          renderer.setSize(w, h)
          cam.aspect = w / h
          cam.updateProjectionMatrix()
          shotCam.aspect = w / h
          shotCam.updateProjectionMatrix()
          if (pip) pip.setSize(240, Math.round(240 / (w / h)))
        })
        ro.observe(mount)

        const getCam = () => {
          const C = outCam()
          const T = outTarget()
          return {
            pos: [C.position.x, C.position.y, C.position.z] as [number, number, number],
            target: [T.x, T.y, T.z] as [number, number, number],
            focal: C.getFocalLength()
          }
        }
        const applyCam = (c: any) => {
          if (shotLocked) {
            shotCam.position.set(c.pos[0], c.pos[1], c.pos[2])
            shotTarget.set(c.target[0], c.target[1], c.target[2])
            shotCam.setFocalLength(c.focal)
            shotCam.lookAt(shotTarget)
            shotCam.updateProjectionMatrix()
          } else {
            cam.position.set(c.pos[0], c.pos[1], c.pos[2])
            orbit.target.set(c.target[0], c.target[1], c.target[2])
            cam.setFocalLength(c.focal)
            cam.updateProjectionMatrix()
          }
        }
        // 参考传统 3D 工具的两态视图：机位视角直接编辑出图相机；导演视角冻结机位，
        // 主视口可自由绕场查看。回到机位视角时先恢复冻结机位，避免把导演观察角度误当成出图构图。
        const setViewMode = (next: 'director' | 'camera') => {
          if (next === 'director') {
            if (!shotLocked) {
              shotCam.copy(cam)
              shotTarget.copy(orbit.target)
              shotCam.updateProjectionMatrix()
              shotCam.updateMatrixWorld(true)
            }
            shotLocked = true
            return
          }
          if (shotLocked) {
            cam.copy(shotCam)
            orbit.target.copy(shotTarget)
            cam.lookAt(orbit.target)
            cam.updateProjectionMatrix()
            cam.updateMatrixWorld(true)
          }
          shotLocked = false
        }
        const setSelectedTransform = (part: keyof TransformDraft, axis: 0 | 1 | 2, value: number) => {
          if (!curRoot || curRoot.userData.locked || !Number.isFinite(value)) return
          if (part === 'position') curRoot.position.setComponent(axis, value)
          else if (part === 'rotation') {
            const rad = (value * Math.PI) / 180
            if (axis === 0) curRoot.rotation.x = rad
            else if (axis === 1) curRoot.rotation.y = rad
            else curRoot.rotation.z = rad
          }
          else curRoot.scale.setComponent(axis, Math.max(0.01, value))
          curRoot.updateMatrixWorld(true)
          emitTransform()
        }
        // ── 灯光预设：只调两盏灯 + 背景色；不进 undo 快照（与视图操作同类）──
        let curLighting = '默认'
        const applyLighting = (k: string) => {
          const L = LIGHTINGS.find((l) => l.k === k) || LIGHTINGS[0]
          curLighting = L.k
          hemi.color.setHex(L.hemiSky)
          ;(hemi.groundColor as any).setHex(L.hemiGround)
          hemi.intensity = L.hemiInt
          dirLight.color.setHex(L.dirColor)
          dirLight.intensity = L.dirInt
          dirLight.position.set(L.dirPos[0], L.dirPos[1], L.dirPos[2])
          scene.background = new THREE.Color(L.bg)
        }
        // 出图画幅：ar=0 不裁剪；kx/ky 为投影修正系数（描述里的方位/占比对应裁剪后画幅）
        let curAspect = 0
        const cropScale = (aspectOverride = curAspect): [number, number] => {
          if (!aspectOverride) return [1, 1]
          const va = cam.aspect || 1 // 视口画幅
          return aspectOverride < va ? [va / aspectOverride, 1] : [1, aspectOverride / va]
        }
        // 居中裁剪 2D 画布到目标画幅（视口内 letterbox 画框显示的就是这个区域）
        const cropCanvas = (src: HTMLCanvasElement): HTMLCanvasElement => {
          if (!curAspect) return src
          const cw = src.width
          const ch = src.height
          let tw = cw
          let th = Math.round(tw / curAspect)
          if (th > ch) { th = ch; tw = Math.round(th * curAspect) }
          if (tw === cw && th === ch) return src
          const c2 = document.createElement('canvas')
          c2.width = tw
          c2.height = th
          c2.getContext('2d')!.drawImage(src, Math.round((cw - tw) / 2), Math.round((ch - th) / 2), tw, th, 0, 0, tw, th)
          return c2
        }
        // 机位缩略图：出图相机渲一帧 → 96px 宽 jpeg（记录机位时调用）
        const captureThumb = (): string => {
          tcontrol.detach()
          const chv = camHelper.visible
          const gv = grid.visible
          const jmv = jointMarker.visible
          camHelper.visible = false
          grid.visible = false // 网格线不进缩略图
          jointMarker.visible = false
          renderer.render(scene, outCam())
          const src = renderer.domElement
          const tw = 96
          const th = Math.max(1, Math.round((tw * src.height) / src.width))
          const c = document.createElement('canvas')
          c.width = tw
          c.height = th
          c.getContext('2d')!.drawImage(src, 0, 0, tw, th)
          camHelper.visible = chv
          grid.visible = gv
          jointMarker.visible = jmv
          attachByMode()
          return cropCanvas(c).toDataURL('image/jpeg', 0.7)
        }
        // 一键落地：包围盒底部贴合地面
        const dropToGround = () => {
          if (!curRoot || curRoot.userData.locked) return
          const box = new THREE.Box3().setFromObject(curRoot)
          if (box.isEmpty() || !isFinite(box.min.y)) return
          curRoot.position.y -= box.min.y
          emitTransform()
          commit()
        }
        const applyCameraPresetById = (presetId: string) => {
          const preset = DIRECTOR_CAMERA_PRESETS.find((item) => item.id === presetId)
          if (!preset) return
          const candidates = preset.scope === 'subject' && curRoot && curRoot.visible !== false
            ? [curRoot]
            : subjects.filter((subject) => subject.obj.visible !== false).map((subject) => subject.obj)
          const bounds = new THREE.Box3()
          for (const object of candidates) bounds.union(new THREE.Box3().setFromObject(object, true))
          const target = bounds.isEmpty() ? outTarget().clone() : bounds.getCenter(new THREE.Vector3())
          const size = bounds.isEmpty() ? new THREE.Vector3(1.2, 1.8, 1.2) : bounds.getSize(new THREE.Vector3())
          const scale = Math.max(0.55, size.y / 1.8, size.x / 2.2, size.z / 2.2)
          const orientationRoot = preset.scope === 'subject' ? curRoot : null
          const orientation = orientationRoot?.getWorldQuaternion?.(new THREE.Quaternion()) || new THREE.Quaternion()
          const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(orientation)
          const right = new THREE.Vector3(1, 0, 0).applyQuaternion(orientation)
          forward.y = 0
          right.y = 0
          if (forward.lengthSq() < 0.01) forward.set(0, 0, 1)
          if (right.lengthSq() < 0.01) right.set(1, 0, 0)
          forward.normalize()
          right.normalize()
          const next = createDirectorPresetCamera(presetId, {
            target: [target.x, target.y, target.z],
            forward: [forward.x, forward.y, forward.z],
            right: [right.x, right.y, right.z],
            scale
          })
          applyCam(next)
          if (!disposed) setFocal(next.focal)
        }
        // 布景预设：追加一组对象并拉一个中景平视机位（不清空现有对象；undo 可逐个回退）
        const stagePreset = async (key: string) => {
          if (key === '双人对话') {
            await ensureDirectorTemplate('female')
            if (disposed) return
            const ca = nextMannequinColor()
            const a = makeMannequin(ca.hex, 'mannequin')
            a.position.set(-0.6, 0, 0)
            a.rotation.y = Math.PI / 2
            addSubject(a, '人台', undefined, ca.name)
            const cb = nextMannequinColor()
            const b = makeMannequin(cb.hex, 'female')
            b.position.set(0.6, 0, 0)
            b.rotation.y = -Math.PI / 2
            addSubject(b, '人台', undefined, cb.name)
          } else if (key === '产品展示') {
            const m = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), new THREE.MeshStandardMaterial({ color: 0x8a93a6, roughness: 0.8 }))
            m.position.set(0, 0.25, 0)
            addSubject(m, '道具')
          } else {
            return
          }
          applyCam({ pos: [0, 1.4, 3.2], target: [0, 0.9, 0], focal: 35 })
          commit()
        }
        // 重建程序生成的人台/道具（导入模型走 buildModelFromState）
        const buildFromState = (st: any) => {
          if (st.kind !== '人台' && st.kind !== '道具') return
          // 旧工程的无色人台：补第一个未占用的锚定色（颜色锚定才有基础），下次保存即固化
          const assigned = st.kind === '人台' && !st.colorName ? nextMannequinColor() : null
          // 旧标签（红衣…）迁移为新名（红标…），同序号同色
          const legacyIdx = st.colorName ? LEGACY_COLOR_NAMES.indexOf(st.colorName) : -1
          const colorName = legacyIdx >= 0 ? MANNEQUIN_COLORS[legacyIdx].name : st.colorName || assigned?.name
          const colorHex = legacyIdx >= 0 ? MANNEQUIN_COLORS[legacyIdx].hex : MANNEQUIN_COLORS.find((c) => c.name === st.colorName)?.hex
          const obj: any = st.kind === '道具'
            ? new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), new THREE.MeshStandardMaterial({ color: 0x8a93a6, roughness: 0.8 }))
            : makeMannequin(assigned?.hex ?? colorHex ?? 0xc7ccd6, getDirectorBodyPreset(st.bodyType).bodyType)
          obj.position.set(st.pos[0], st.pos[1], st.pos[2])
          obj.rotation.set(st.rot[0], st.rot[1], st.rot[2])
          applyScale(obj, st.scale)
          obj.userData.kind = st.kind
          obj.userData.locked = !!st.locked
          obj.visible = st.visible !== false
          if (st.kind === '人台' && st.poseSchemaVersion !== 2) {
            // v9 直接保存程序化骨架的 XYZ，正反面符号也存在错误；高精骨架不能复用这些绝对角。
            // 迁移时按已命名预设重新计算，未命名旧姿势回到安全的正面站姿。
            const migratedPose = getDirectorPose(st.poseName || '站立') || POSES[0]
            applyMannequinPose(obj, migratedPose.k, migratedPose.m, migratedPose.offsetY || 0, migratedPose.controls)
          } else {
            if (st.poseName) obj.userData.poseName = st.poseName
            if (st.kind === '人台') {
              obj.userData.poseOffsetY = Number(st.poseOffsetY || 0)
              const rig = findRigRoot(obj)
              if (rig) rig.position.y = Number(rig.userData.restY || 0) + obj.userData.poseOffsetY
            }
            if (st.joints) obj.traverse((c: any) => { const j = c.userData && c.userData.joint; if (j && st.joints[j]) c.rotation.set(st.joints[j][0], st.joints[j][1], st.joints[j][2]) })
            if (st.kind === '人台' && st.poseOffsetY == null) groundMannequinRig(obj)
          }
          const id = uid('obj')
          scene.add(obj)
          subjects.push({ obj, kind: st.kind, id, name: st.name || nextName(st.kind), desc: st.desc, colorName })
        }
        const serializeSceneOnly = () => ({
          // 人台/道具 + 已存字节的导入模型；导入模型为空 assetId（存储失败）则不持久化
          subjects: subjects
            .filter((s) => s.kind === '人台' || s.kind === '道具' || (s.kind === '模型' && s.obj.userData.assetId))
            .map((s) => {
              const o: any = s.obj
              const posed = s.kind === '人台' || (s.kind === '模型' && o.userData.rigged)
              const joints: Record<string, [number, number, number]> = {}
              if (posed) o.traverse((c: any) => { const j = c.userData && c.userData.joint; if (j) joints[j] = [c.rotation.x, c.rotation.y, c.rotation.z] })
              return {
                kind: s.kind,
                assetId: s.kind === '模型' ? o.userData.assetId : undefined,
                name: s.name,
                desc: s.desc || undefined,
                colorName: s.colorName || undefined,
                bodyType: s.kind === '人台' ? getDirectorBodyPreset(o.userData.bodyType).bodyType : undefined,
                poseSchemaVersion: s.kind === '人台' ? 2 : undefined,
                poseOffsetY: s.kind === '人台' ? Number(o.userData.poseOffsetY || 0) : undefined,
                locked: !!o.userData.locked,
                visible: o.visible !== false,
                pos: [o.position.x, o.position.y, o.position.z] as [number, number, number],
                rot: [o.rotation.x, o.rotation.y, o.rotation.z] as [number, number, number],
                scale: [o.scale.x, o.scale.y, o.scale.z] as [number, number, number],
                joints: posed ? joints : undefined,
                poseName: o.userData.poseName
              }
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
          const C = outCam() // 出图相机（锁定取景时为 shotCam）
          const project = (p: any): [number, number] | null => {
            if (!p) return null
            const cs = p.clone().applyMatrix4(C.matrixWorldInverse)
            if (cs.z > -0.02) return null // 在相机后方
            const v = p.clone().project(C)
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
          return cropCanvas(c).toDataURL('image/png')
        }
        const captureDepth = (): string => {
          tcontrol.detach()
          const C = outCam() // 出图相机
          const pf = C.far
          C.far = 14
          C.updateProjectionMatrix()
          const pbg = scene.background
          scene.background = new THREE.Color(0x000000)
          const gv = grid.visible
          const gdv = ground.visible
          const chv = camHelper.visible
          const jmv = jointMarker.visible
          grid.visible = false
          ground.visible = false // 网格/地面会污染深度图（底部强梯度+网格线），主体专注
          camHelper.visible = false // 取景框不进深度图
          jointMarker.visible = false
          scene.overrideMaterial = depthMat
          renderer.render(scene, C)
          scene.overrideMaterial = null as any
          grid.visible = gv
          ground.visible = gdv
          camHelper.visible = chv
          jointMarker.visible = jmv
          scene.background = pbg
          C.far = pf
          C.updateProjectionMatrix()
          const cw = renderer.domElement.width
          const ch = renderer.domElement.height
          const c = document.createElement('canvas')
          c.width = cw
          c.height = ch
          const cx = c.getContext('2d')!
          cx.drawImage(renderer.domElement, 0, 0)
          // 注意：不要反相。three 的 BasicDepthPacking 输出即「近白远黑」（1.0 - fragCoordZ），
          // 正是 ControlNet 深度模型（MiDaS/Depth Anything）的约定；再反相纵深关系就倒了。
          attachByMode()
          return cropCanvas(c).toDataURL('image/png')
        }

        // 恢复持久化场景，否则默认一个人台
        if (saved0 && Array.isArray(saved0.subjects) && saved0.subjects.length) {
          restoring = true
          sceneGen++
          const ps: Promise<void>[] = []
          saved0.subjects.forEach((st: any) => { if (st.kind === '模型') ps.push(buildModelFromState(st)); else buildFromState(st) })
          sync()
          if (saved0.cam) applyCam(saved0.cam)
          select(null)
          if (!disposed) {
            setShots((saved0.shots || []).map((shot) => ({
              ...shot,
              shotType: shot.shotType || classifyDirectorShot(shot.cam)
            })))
            if (saved0.prompt) setPrompt(saved0.prompt)
            setFocal(Math.round((saved0.cam && saved0.cam.focal) || 35))
            if (saved0.lighting && LIGHTINGS.some((l) => l.k === saved0.lighting)) {
              applyLighting(saved0.lighting)
              setLighting(saved0.lighting)
            }
            if (saved0.aspect && ASPECTS.some((a) => a.k === saved0.aspect)) {
              const ar = ASPECTS.find((a) => a.k === saved0.aspect)?.ar ?? 0
              curAspect = ar
              setAspectK(saved0.aspect)
            }
          }
          // 撤销栈种子：等异步导入模型全部到齐后再快照（否则种子漏模型，undo 回种子会丢模型）
          void Promise.all(ps).then(() => { restoring = false; if (!disposed) { sync(); commit() } })
        } else {
          addMannequin() // addSubject 内已 commit 种子
        }

        // 可传入任意相机/目标点（默认=出图相机）：分镜导出时按各机位相机离线算描述
        const shotFragment = (C?: any, target?: any, settings?: { aspect?: string; lighting?: string }): string => {
          C = C || outCam()
          target = target || outTarget()
          const fragmentAspect = settings?.aspect && ASPECTS.some((item) => item.k === settings.aspect)
            ? ASPECTS.find((item) => item.k === settings.aspect)?.ar || 0
            : curAspect
          const fragmentLighting = settings?.lighting && LIGHTINGS.some((item) => item.k === settings.lighting)
            ? settings.lighting
            : curLighting
          const d = C.position.distanceTo(target)
          const dy = C.position.y - target.y
          const ang = (Math.asin(Math.max(-1, Math.min(1, dy / Math.max(0.001, d)))) * 180) / Math.PI
          const f = C.getFocalLength()
          const lens = f < 28 ? '广角镜头(wide-angle)' : f <= 50 ? '标准镜头(normal)' : f <= 85 ? '中长焦(short telephoto)' : '长焦(telephoto)'
          const angle = ang > 18 ? `俯拍(约 ${Math.round(ang)}° 俯角, high angle looking down)` : ang < -12 ? `仰拍(约 ${Math.round(-ang)}° 仰角, low angle)` : '平视(eye level)'
          const shot = d < 1.6 ? '特写(close-up)' : d < 3.2 ? '中景(medium shot)' : d < 6 ? '全景(full shot)' : '远景(wide shot)'
          const people = subjects.filter((s) => s.kind === '人台' && s.obj.visible !== false)
          const v = new THREE.Vector3()
          const [kx, ky] = cropScale(fragmentAspect) // 画幅裁剪修正：方位/占比对应裁剪后的出图画幅
          // 水平 + 垂直方位（只写水平会让竖排站位无法区分，角色绑定必错）
          const whereOf = (s: Subj): string => {
            s.obj.getWorldPosition(v)
            v.project(C)
            v.x *= kx
            v.y *= ky
            if (!isFinite(v.x) || v.z > 1 || Math.abs(v.x) > 1.3 || Math.abs(v.y) > 1.3) return ''
            const h = v.x < -0.25 ? '居左' : v.x > 0.25 ? '居右' : '居中'
            const vt = v.y > 0.25 ? '偏上' : v.y < -0.25 ? '偏下' : ''
            return h + vt
          }
          // 人物在出图画幅中的纵向占比：按实际包围盒投影，儿童/幼儿/蹲姿都不再套成人固定身高。
          const heightFracOf = (s: Subj): number => {
            const box = new THREE.Box3().setFromObject(s.obj)
            if (box.isEmpty()) return 0
            const ys: number[] = []
            for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
              const projected = new THREE.Vector3(x, y, z).project(C)
              if (isFinite(projected.y)) ys.push(projected.y)
            }
            if (!ys.length) return 0
            return ((Math.max(...ys) - Math.min(...ys)) / 2) * ky
          }
          // 纵深顺序：按角色到相机距离排名（近→远），多角色时给 最前/中间/最后 标记
          const dists = people.map((s) => s.obj.getWorldPosition(new THREE.Vector3()).distanceTo(C.position))
          const nearOrder = dists.map((_, i) => i).sort((a, b) => dists[a] - dists[b])
          const depthOf = (i: number): string => {
            if (people.length < 2) return ''
            const rank = nearOrder.indexOf(i)
            if (people.length === 2) return rank === 0 ? '前景' : '背景'
            return rank === 0 ? '最前' : rank === people.length - 1 ? '最后' : '中间'
          }
          // 角色相对镜头的朝向：人台 forward=+Z，与「角色→相机」的水平夹角判定（面朝/背对/侧向）
          const facingOf = (s: Subj): string => {
            const fw = new THREE.Vector3(0, 0, 1).applyQuaternion(s.obj.quaternion)
            const toCam = C.position.clone().sub(s.obj.getWorldPosition(new THREE.Vector3()))
            fw.y = 0
            toCam.y = 0
            if (!fw.lengthSq() || !toCam.lengthSq()) return ''
            const dot = fw.normalize().dot(toCam.normalize())
            if (dot > 0.7) return '面向镜头'
            if (dot < -0.7) return '背对镜头'
            const crossY = fw.z * toCam.x - fw.x * toCam.z
            return crossY > 0 ? '右侧身对镜头' : '左侧身对镜头'
          }
          // 手动摆姿的粗略文字化：一键预设已有 poseName，手动拖的关节从旋转角推导动作描述
          const poseDescOf = (s: Subj): string => {
            if (s.kind !== '人台') return '' // 导入模型关节轴系不同，不瞎猜
            const j: Record<string, any> = {}
            s.obj.traverse((c: any) => { const k = c.userData && c.userData.joint; if (k && !j[k]) j[k] = c })
            const out: string[] = []
            const arm = (sh: any, el: any, side: string) => {
              if (!sh) return
              const up = side === '左' ? -sh.rotation.z : sh.rotation.z // 参照 POSES：T姿/举手预设的符号约定
              const fwd = -sh.rotation.x // 指向前预设：肩 x=-1.4
              if (up > 2.2) out.push(`${side}手上举`)
              else if (up > 0.7) out.push(`${side}手侧举`)
              if (fwd > 0.7) out.push(`${side}手前伸`)
              if (el && (Math.abs(el.rotation.z) > 0.5 || Math.abs(el.rotation.x) > 0.5)) out.push(`${side}肘弯曲`)
            }
            arm(j['左肩'], j['左肘'], '左')
            arm(j['右肩'], j['右肘'], '右')
            const leg = (hp: any, kn: any, side: string) => {
              if (hp && hp.rotation.x > 0.6) out.push(`${side}腿前抬`)
              if (kn && kn.rotation.x < -0.6) out.push(`${side}膝弯曲`)
            }
            leg(j['左髋'], j['左膝'], '左')
            leg(j['右髋'], j['右膝'], '右')
            if (j['头'] && j['头'].rotation.x > 0.4) out.push('低头')
            else if (j['头'] && j['头'].rotation.x < -0.4) out.push('抬头')
            return out.join('，')
          }
          const layout = people
            .map((s, i) => {
              const where = whereOf(s)
              if (!where) return ''
              const pose = (s.obj as any).userData?.poseName
              // 优先用对象语义描述（场景即提示词）；其次用户改名；否则回落「角色N」；颜色锚点前置
              const nm = (s.colorName ? s.colorName : '') + (s.desc || (s.name && !/^(人台|道具|模型)\d+$/.test(s.name) ? s.name : `角色${i + 1}`))
              const frac = heightFracOf(s)
              const sizeTxt = frac > 0.01 ? `，约占画面高度 ${Math.round(frac * 100)}%` : ''
              const facing = facingOf(s)
              // 纵深 + 悬空 + 朝向：竖排/空中站位也能被模型唯一绑定
              const extras = [depthOf(i), s.obj.getWorldPosition(new THREE.Vector3()).y > 0.3 ? '悬空' : '', facing].filter(Boolean).join('，')
              const action = pose || poseDescOf(s) // 一键预设有名字，手动摆姿从关节推导
              const bodyLabel = getDirectorBodyPreset(s.obj.userData.bodyType).promptLabel
              const traits = [bodyLabel, action].filter(Boolean).join('，')
              return `${nm}${where}${sizeTxt}${extras ? `，${extras}` : ''}${traits ? `(${traits})` : ''}`
            })
            .filter(Boolean)
            .join('，')
          const count = people.length ? `画面中有 ${people.length} 个角色（${layout || '居中'}）。` : ''
          // 道具/导入模型也进提示词：AI 才知道场景里有桌子/产品（未改名对象用 kind 统称）
          const propLayout = subjects
            .filter((s) => s.kind !== '人台' && s.obj.visible !== false)
            .map((s) => {
              const where = whereOf(s)
              if (!where) return ''
              const nm = s.desc || (s.name && !/^(人台|道具|模型)\d+$/.test(s.name) ? s.name : s.kind)
              return `${nm}${where}`
            })
            .filter(Boolean)
            .join('，')
          const propTxt = propLayout ? `场景道具：${propLayout}。` : ''
          const lightTxt = (LIGHTINGS.find((l) => l.k === fragmentLighting) || LIGHTINGS[0]).frag
          const aspectTxt = fragmentAspect ? `画幅比例 ${ASPECTS.find((a) => a.ar === fragmentAspect)?.k || ''}，请严格保持这个宽高比构图。` : ''
          return `镜头：${lens}，${Math.round(f)}mm，${angle}，${shot}。${aspectTxt}${count}${propTxt}${lightTxt ? `灯光：${lightTxt}。` : ''}`
        }

        api.current = {
          addMannequin,
          addProp,
          importFile: (ab: ArrayBuffer, name: string) => importGLTF(ab, name),
          selectById: (id: string) => { const s = findById(id); if (s) select(s.obj) },
          renameById: (id: string, name: string) => { const s = findById(id); if (s) { s.name = name; sync() } },
          getDescById: (id: string) => findById(id)?.desc || '',
          setDescById: (id: string, desc: string) => { const s = findById(id); if (s && (s.desc || '') !== desc) { s.desc = desc || undefined; commit() } },
          removeById,
          duplicateById,
          toggleVisById,
          toggleLockById,
          lookAtSelected,
          setMode: (m: TMode) => { curMode = m; attachByMode() },
          setBodyType: setSelectedBodyType,
          getPosePreviews,
          selectJointByName,
          setSelectedJointAxis,
          commitJointEdit,
          resetSelectedJoint,
          setSelectedTransform,
          commitTransform: commit,
          setFocal: (mm: number) => { const C = outCam(); C.setFocalLength(mm); C.updateProjectionMatrix() },
          shotSize: (kind: 'cu' | 'ms' | 'fs') => {
            const C = outCam(); const T = outTarget()
            const dist = kind === 'cu' ? 1.3 : kind === 'ms' ? 2.6 : 5
            const v = C.position.clone().sub(T).normalize().multiplyScalar(dist)
            C.position.copy(T).add(v)
            if (shotLocked) { shotCam.lookAt(shotTarget); shotCam.updateProjectionMatrix() }
          },
          angle: (kind: 'low' | 'eye' | 'high') => {
            const C = outCam(); const T = outTarget()
            const flat = new THREE.Vector3(C.position.x - T.x, 0, C.position.z - T.z)
            const horiz = flat.length() || 2.6
            const y = kind === 'low' ? 0.4 : kind === 'eye' ? T.y : T.y + horiz * 0.9
            C.position.set(T.x + flat.x, y, T.z + flat.z)
            if (shotLocked) { shotCam.lookAt(shotTarget); shotCam.updateProjectionMatrix() }
          },
          applyCameraPreset: applyCameraPresetById,
          // 锁定取景：冻结当前视图为出图机位（PiP/取景框/生成都用它），主视图可继续自由轨道查看
          setViewMode,
          setLock: (v: boolean) => setViewMode(v ? 'director' : 'camera'),
          // 把出图机位设为当前视图（锁定状态下重新取景）
          setShotFromView: () => {
            shotCam.copy(cam); shotTarget.copy(orbit.target); shotCam.updateProjectionMatrix(); shotCam.updateMatrixWorld(true)
          },
          undo,
          redo: redoFn,
          applyPose: (name: string, map: Record<string, [number, number, number]>, offsetY = 0, controls: Record<string, number> = {}) => {
            if (!curRoot || curRoot.userData.kind !== '人台' || curRoot.userData.locked) return
            applyMannequinPose(curRoot, name, map, offsetY, controls)
            sync()
            commit()
          },
          setFacing: (rad: number) => {
            if (curRoot && !curRoot.userData.locked) { curRoot.rotation.y = rad; emitTransform(); commit() }
          },
          capture: (): string => {
            tcontrol.detach()
            const chv = camHelper.visible
            const gv = grid.visible
            const jmv = jointMarker.visible
            camHelper.visible = false // 取景框不进成片参考图
            grid.visible = false // 网格线是编辑器辅助，不进参考图（地面保留作地面参考）
            jointMarker.visible = false
            renderer.render(scene, outCam())
            const src = renderer.domElement
            const c = document.createElement('canvas')
            c.width = src.width
            c.height = src.height
            c.getContext('2d')!.drawImage(src, 0, 0)
            const url = cropCanvas(c).toDataURL('image/png')
            camHelper.visible = chv
            grid.visible = gv
            jointMarker.visible = jmv
            attachByMode()
            return url
          },
          captureDepth,
          captureOpenPose,
          poseTargetCount: () => subjects.filter((s) => s.kind === '人台' || (s.kind === '模型' && s.obj.userData.rigged)).length,
          getCam,
          applyCam,
          serializeSceneOnly,
          shotFragment,
          // 按给定机位相机离线算镜头描述（分镜导出用；不碰主视图/出图相机）
          fragmentFor: (c: any, settings?: { aspect?: string; lighting?: string }) => {
            const tc = new THREE.PerspectiveCamera(50, cam.aspect, 0.05, 1000)
            tc.filmGauge = FILM_GAUGE
            tc.position.set(c.pos[0], c.pos[1], c.pos[2])
            tc.setFocalLength(c.focal || 35)
            const tv = new THREE.Vector3(c.target[0], c.target[1], c.target[2])
            tc.lookAt(tv)
            tc.updateMatrixWorld(true)
            return shotFragment(tc, tv, settings)
          },
          setLighting: applyLighting,
          getLighting: () => curLighting,
          setAspect: (ar: number) => { curAspect = ar },
          captureThumb,
          dropToGround,
          stagePreset
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
          safe(() => renderer.domElement.removeEventListener('webglcontextlost', onCtxLost))
          safe(() => renderer.domElement.removeEventListener('webglcontextrestored', onCtxRestored))
          safe(() => tcontrol.detach())
          safe(() => tcontrol.removeEventListener('objectChange', onTransformObjectChange))
          safe(() => scene.remove(tHelper))
          safe(() => { scene.remove(camHelper); camHelper.dispose?.() })
          safe(() => tcontrol.dispose())
          safe(() => orbit.dispose())
          safe(() => scene.traverse((o: any) => disposeTree(o))) // 释放各 mesh 的 geometry/material/texture
          safe(() => depthMat.dispose())
          safe(() => renderer.dispose())
          safe(() => renderer.forceContextLoss())
          safe(() => { if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement) })
          safe(() => { if (pip) { pip.dispose(); pip.forceContextLoss(); if (pip.domElement.parentNode) pip.domElement.parentNode.removeChild(pip.domElement) } })
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

  // keyRef 每次渲染重赋值：快捷键闭包始终拿到最新 selId/locked/mode（监听器本身保持稳定）
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {})
  keyRef.current = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { closeRef.current(); return }
    const t = e.target as HTMLElement
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return // 输入框内交给原生
    const meta = e.ctrlKey || e.metaKey
    if (meta && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); if (e.shiftKey) api.current.redo?.(); else api.current.undo?.(); return }
    if (meta && (e.key === 'y' || e.key === 'Y')) { e.preventDefault(); api.current.redo?.(); return }
    if (meta || e.altKey) return // 其余组合键交给系统/浏览器
    const k = e.key.toLowerCase()
    if (k === 'q') onMode('translate')
    else if (k === 'w') onMode('rotate')
    else if (k === 'e') onMode('scale')
    else if (k === 'r') onMode('pose')
    else if (k === 'f') { if (selId) api.current.lookAtSelected?.() }
    else if (k === 'l') onViewMode(locked ? 'camera' : 'director')
    else if (e.key === 'Delete' || e.key === 'Backspace') { if (selId) api.current.removeById?.(selId) }
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keyRef.current(e)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // 切换选中 → 拉取该对象的语义描述进草稿
  const selectedObj = objs.find((o) => o.id === selId)
  useEffect(() => { setDescDraft(selId ? api.current.getDescById?.(selId) || '' : '') }, [selId])
  useEffect(() => { setInspectorTab(inferDirectorInspectorTab(selKind)) }, [selId, selKind])
  useEffect(() => { writeDirectorPanelWidth('director.leftPanelWidth', leftPanelWidth) }, [leftPanelWidth])
  useEffect(() => { writeDirectorPanelWidth('director.rightPanelWidth', rightPanelWidth) }, [rightPanelWidth])
  useEffect(() => {
    const bodyType = selectedObj?.bodyType
    if (!ready || selKind !== '人台' || !bodyType) {
      setPosePreviews({})
      setPosePreviewStatus('idle')
      return
    }
    let cancelled = false
    setPosePreviews({})
    setPosePreviewStatus('loading')
    void Promise.resolve(api.current.getPosePreviews?.(bodyType)).then((result) => {
      if (cancelled) return
      if (result && Object.keys(result).length) {
        setPosePreviews(result)
        setPosePreviewStatus('ready')
      } else {
        setPosePreviewStatus('error')
      }
    }).catch(() => {
      if (!cancelled) setPosePreviewStatus('error')
    })
    return () => { cancelled = true }
  }, [ready, selKind, selectedObj?.bodyType, posePreviewNonce])

  const beginPanelResize = (side: 'left' | 'right', event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = side === 'left' ? leftPanelWidth : rightPanelWidth
    const onMove = (move: PointerEvent) => {
      const delta = move.clientX - startX
      if (side === 'left') setLeftPanelWidth(Math.max(184, Math.min(320, startWidth + delta)))
      else setRightPanelWidth(Math.max(280, Math.min(420, startWidth - delta)))
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const onFocal = (mm: number) => { setFocal(mm); api.current.setFocal?.(mm) }
  const onAspect = (k: string) => { setAspectK(k); api.current.setAspect?.(ASPECTS.find((a) => a.k === k)?.ar ?? 0) }

  const onViewMode = (next: 'director' | 'camera') => {
    const director = next === 'director'
    setLocked(director)
    api.current.setViewMode?.(next)
  }

  const shotStripHeight = shotStripExpanded ? 128 : 40
  const bottomUiInset = 84 + shotStripHeight + 8
  const viewportLeft = panelsCollapsed ? 12 : leftPanelWidth + 16
  const viewportRight = panelsCollapsed ? 12 : rightPanelWidth + 16
  const viewportStyle = { left: viewportLeft, right: viewportRight }

  // letterbox 画框尺寸：中央可视区内按画幅取最大内接矩形；收起侧栏时随视口扩展。
  const [frameRect, setFrameRect] = useState<{ w: number; h: number } | null>(null)
  useEffect(() => {
    if (!curAr) { setFrameRect(null); return }
    const calc = () => {
      const cw = Math.max(1, window.innerWidth - viewportLeft - viewportRight)
      const ch = Math.max(1, window.innerHeight - 64 - bottomUiInset)
      let w = cw
      let h = w / curAr
      if (h > ch) { h = ch; w = h * curAr }
      setFrameRect({ w: Math.round(w), h: Math.round(h) })
    }
    calc()
    window.addEventListener('resize', calc)
    return () => window.removeEventListener('resize', calc)
  }, [curAr, viewportLeft, viewportRight, bottomUiInset])
  const onMode = (m: TMode) => { setMode(m); api.current.setMode?.(m) }
  const onImportClick = () => fileRef.current?.click()
  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    api.current.importFile?.(await f.arrayBuffer(), f.name)
  }

  // 组装完整提示词（生成与「复制提示词」诊断共用同一出口，保证你看到的就是模型收到的）
  const buildFullPrompt = () => {
    const proj = useGraph.getState().project
    const useControl = !!proj.defaultControlModel
    const usePose = useControl && ctrlType === 'pose'
    const note = usePose
      ? '【输入为 OpenPose 骨架控制图：请严格按骨架表达的人物姿态与站位渲染为成片画面。】'
      : useControl
        ? '【输入为 3D 导演台导出的深度控制图：请严格据此构图、机位、人物站位与姿态，渲染为成片画面。】'
        : '【以上为 3D 导演台的机位/构图参考（彩色人台=角色站位/姿态/朝向，颜色只是区分角色的标记），请据此构图与镜头渲染成片。人台颜色仅为站位标记，严禁用于角色的服装或外观配色；忽略人台材质。】'
    // 构图指令前置（导演台的核心诉求就是构图）+ cookbook preserve-list：保留项英文写死（模型服从度更好）
    const preserve =
      'Preserve exactly: camera angle, framing, character positions, facing directions, character count and poses. ' +
      'Change only: materials, textures, lighting, environment and style. Do not re-frame, zoom, crop or move any subject. ' +
      'The mannequin colors are position markers only; never use them for clothing, skin or any appearance color.'
    return { useControl, usePose, full: `${note}${api.current.shotFragment()}\n\n${prompt.trim()}\n\n${preserve}` }
  }

  const doGenerate = async (placeIndex: number, outputAspect = aspect): Promise<string | null> => {
    const proj = useGraph.getState().project
    const controlModel = proj.defaultControlModel
    const model = controlModel || proj.defaultImageModel
    if (!model) {
      toast('请在工程设置（顶栏 ⚙）选「默认图像模型」或「ControlNet 控制模型」', 'error')
      return null
    }
    try {
      const ai = window.mulby.ai
      const { useControl, usePose, full } = buildFullPrompt()
      if (usePose && (api.current.poseTargetCount?.() || 0) === 0) {
        toast('骨架控制需要至少一个人台或带骨骼的导入模型', 'error')
        return null
      }
      const dataUrl = (usePose ? api.current.captureOpenPose() : useControl ? api.current.captureDepth() : api.current.capture()) as string
      const b64 = dataUrl.split(',')[1]
      const bin = atob(b64)
      const buf = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i)
      const att = await ai.attachments.upload({ buffer: buf.buffer, mimeType: 'image/png', purpose: 'image' })
      // size/aspectRatio 透传（宿主已支持）：OpenAI 系用 size 定死输出尺寸，Gemini 系用 aspectRatio
      const editInput: { model: string; imageAttachmentId: string; prompt: string; size?: string; aspectRatio?: string } = { model, imageAttachmentId: att.attachmentId, prompt: full }
      if (outputAspect !== '视口') {
        editInput.aspectRatio = outputAspect
        const sz = ({ '1:1': '1024x1024', '3:2': '1536x1024', '2:3': '1024x1536' } as Record<string, string>)[outputAspect]
        if (sz) editInput.size = sz // gpt-image 系只支持这三档；16:9/9:16 仅 Gemini 系按 aspectRatio 生效
      }
      const res = await ai.images.edit(editInput)
      const out = res?.images?.[0]
      if (!out) throw new Error('模型未返回图像')
      const g = useGraph.getState()
      const boardId = g.project.activeBoardId
      const saved = await saveBase64(g.project.id, `director_${Date.now()}_${placeIndex}`, out, 'png')
      const vp = g.getActiveBoard().viewport
      const wx = (-vp.x + 360) / vp.zoom + placeIndex * 340
      const wy = (-vp.y + 320) / vp.zoom
      g.addCard('image', { x: wx, y: wy }, { title: '导演台成片', status: 'done', modelId: model, prompt: prompt.trim(), assetUrl: saved.url, assetLocalPath: saved.path, mime: 'image/png' }, boardId)
      return saved.url as string
    } catch (e: any) {
      toast('生成失败：' + (e?.message || String(e)), 'error')
      return null
    }
  }

  // 生成 = 抓帧落「参考图节点」→ 右侧创建「生图节点」并引边（含完整提示词与画幅 params）→
  // 保存场景关台回 2D 画布。不自动生成：由用户在画布上手动触发（生成选中/节点生成按钮，可停止/复跑）
  const run = async () => {
    if (!prompt.trim()) { toast('请先填写场景/角色描述', 'error'); return }
    const proj = useGraph.getState().project
    const model = proj.defaultControlModel || proj.defaultImageModel
    if (!model) {
      toast('请在工程设置（顶栏 ⚙）选「默认图像模型」或「ControlNet 控制模型」', 'error')
      return
    }
    const { useControl, usePose, full } = buildFullPrompt()
    if (usePose && (api.current.poseTargetCount?.() || 0) === 0) {
      toast('骨架控制需要至少一个人台或带骨骼的导入模型', 'error')
      return
    }
    setBusy(true)
    try {
      const dataUrl = (usePose ? api.current.captureOpenPose() : useControl ? api.current.captureDepth() : api.current.capture()) as string
      const b64 = dataUrl.split(',')[1]
      const g = useGraph.getState()
      const boardId = g.project.activeBoardId
      const saved = await saveBase64(g.project.id, `director_ref_${Date.now()}`, b64, 'png')
      const vp = g.getActiveBoard().viewport
      const wx = (-vp.x + 360) / vp.zoom
      const wy = (-vp.y + 320) / vp.zoom
      // 两张卡并排共 600×320，避开现有节点（不能压在已有卡片上）
      const spot = findFreeSpot(g.getActiveBoard(), 600, 320, wx + 300, wy)
      const refTitle = usePose ? '导演台·骨架控制图' : useControl ? '导演台·深度控制图' : '导演台·参考图'
      const refId = g.addCard('image', { x: spot.x - 160, y: spot.y }, { title: refTitle, status: 'done', assetUrl: saved.url, assetLocalPath: saved.path, mime: 'image/png' }, boardId)
      const genId = g.addCard(
        'image',
        { x: spot.x + 160, y: spot.y },
        { title: '导演台成片', status: 'idle', modelId: model, prompt: full, params: aspect !== '视口' ? { aspect } : {} },
        boardId
      )
      g.addEdgeBetween(refId, genId)
      g.setSelection([genId])
      saveScene()
      useUi.getState().setShowDirector(false)
      toast('已创建参考图节点 + 生图节点，选中后点「生成选中」即可出图', 'success')
    } catch (e: any) {
      toast('创建生成节点失败：' + (e?.message || String(e)), 'error')
    } finally {
      setBusy(false)
    }
  }
  // 生成指定机位并把成片回贴为该 shot 的 take（机位即分镜；takes 保留最近 6 条历史）
  const genShot = async (i: number): Promise<boolean> => {
    const shot = shots[i]
    if (!shot) return false
    applyShot(shot)
    const url = await doGenerate(i, shot.aspect || aspect)
    if (url) { setShots((ss) => ss.map((x, xi) => (xi === i ? { ...x, take: url, takes: [...(x.takes || []), url].slice(-6) } : x))); return true }
    return false
  }
  // 在 takes 历史里切换当前成片（循环）
  const cycleTake = (i: number, dir: number) => {
    setShots((ss) => ss.map((x, xi) => {
      if (xi !== i || !x.takes || x.takes.length < 2) return x
      const cur = x.takes.indexOf(x.take || '')
      const next = x.takes[(cur + dir + x.takes.length) % x.takes.length]
      return { ...x, take: next }
    }))
  }
  const batchGenerate = async () => {
    if (!prompt.trim()) { toast('请先填写场景/角色描述', 'error'); return }
    if (!shots.length) { toast('请先「记录机位」添加 shot', 'error'); return }
    setBusy(true)
    let ok = 0
    for (let i = 0; i < shots.length; i++) {
      if (await genShot(i)) ok++
    }
    setBusy(false)
    toast(`已生成 ${ok}/${shots.length} 个机位`, ok ? 'success' : 'error')
  }
  const addShot = () => {
    const cam = api.current.getCam?.()
    if (!cam) return
    const thumb = api.current.captureThumb?.()
    const id = uid('shot')
    setShots((current) => [
      ...current,
      createDirectorShotSnapshot({ id, name: `机位${current.length + 1}`, cam, thumb, aspect, lighting: api.current.getLighting?.() || lighting })
    ])
    setActiveShotId(id)
  }
  const applyShot = (shot: DirectorShot) => {
    api.current.applyCam?.(shot.cam)
    setFocal(Math.round(shot.cam?.focal || 35))
    if (shot.aspect && ASPECTS.some((item) => item.k === shot.aspect)) onAspect(shot.aspect)
    if (shot.lighting && LIGHTINGS.some((item) => item.k === shot.lighting)) {
      setLighting(shot.lighting)
      api.current.setLighting?.(shot.lighting)
    }
    setActiveShotId(shot.id)
  }
  const duplicateShot = (id: string) => {
    setShots((current) => {
      const index = current.findIndex((shot) => shot.id === id)
      if (index < 0) return current
      const source = current[index]
      const copy = { ...source, id: uid('shot'), name: `${source.name} 副本`, takes: source.takes ? [...source.takes] : undefined }
      const next = current.slice()
      next.splice(index + 1, 0, copy)
      return next
    })
  }
  const renameShot = (id: string, name: string) => setShots((current) => current.map((shot) => (shot.id === id ? { ...shot, name } : shot)))
  const reorderShots = (draggedId: string, targetId: string) => setShots((current) => reorderDirectorShots(current, draggedId, targetId))
  const delShot = (id: string) => {
    setShots((current) => current.filter((shot) => shot.id !== id))
    if (activeShotId === id) setActiveShotId(null)
  }

  // 避障落位：从首选点向右/向下扫描，找一块 w×h（中心坐标，含边距）不与现有卡片重叠的空位；
  // 视口内全满则放到最低卡片下方
  const findFreeSpot = (
    board: { cards: Record<string, { x: number; y: number; w: number; h: number }> },
    w: number,
    h: number,
    startX: number,
    startY: number
  ): { x: number; y: number } => {
    const M = 24
    const cards = Object.values(board.cards)
    const hit = (cx: number, cy: number) =>
      cards.some((c) => Math.abs(cx - (c.x + c.w / 2)) < (w + c.w) / 2 + M && Math.abs(cy - (c.y + c.h / 2)) < (h + c.h) / 2 + M)
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const cx = startX + col * 120
        const cy = startY + row * 120
        if (!hit(cx, cy)) return { x: cx, y: cy }
      }
    }
    const maxY = cards.reduce((m, c) => Math.max(m, c.y + c.h), startY)
    return { x: startX, y: maxY + M + h / 2 }
  }

  // 分镜导出：机位表 → 画布分镜卡（4 列网格）。有 take 的直接带成片(status=done)，
  // 没出片的带装配好的提示词(status=idle) 可「生成选中」；meta.shot 兼容分镜生态（shotToVideo 等）。
  const exportStoryboard = () => {
    if (!shots.length) { toast('请先「记录机位」添加 shot', 'error'); return }
    const g = useGraph.getState()
    const boardId = g.project.activeBoardId
    const vp = g.getActiveBoard().viewport
    const W = 280
    const H = 320
    const cols = 4
    const gapX = 40
    const gapY = 48
    const rows = Math.ceil(shots.length / cols)
    const totalW = cols * W + (cols - 1) * gapX
    const totalH = rows * H + (rows - 1) * gapY
    // 整个网格找空位，避免压到现有节点
    const spot = findFreeSpot(g.getActiveBoard(), totalW, totalH, (-vp.x + 360) / vp.zoom + totalW / 2, (-vp.y + 200) / vp.zoom + totalH / 2)
    const left = spot.x - totalW / 2
    const top = spot.y - totalH / 2
    const ids: string[] = []
    shots.forEach((s, i) => {
      const col = i % cols
      const row = Math.floor(i / cols)
      const center = { x: left + col * (W + gapX) + W / 2, y: top + row * (H + gapY) + H / 2 }
      const frag = (api.current.fragmentFor?.(s.cam, { aspect: s.aspect, lighting: s.lighting }) as string) || ''
      const full = `${prompt.trim()}\n\n${frag}`.trim()
      const id = g.addCard('image', center, {
        title: s.name,
        prompt: full,
        params: s.aspect && s.aspect !== '视口' ? { aspect: s.aspect } : {},
        status: s.take ? 'done' : 'idle',
        assetUrl: s.take || null,
        mime: s.take ? 'image/png' : null,
        meta: { shot: { shotNumber: i + 1, desc: s.name, imagePrompt: full, camera: frag } }
      }, boardId)
      ids.push(id)
    })
    g.setSelection(ids)
    toast(`已导出 ${shots.length} 个分镜卡到画布（${shots.filter((s) => s.take).length} 个带成片，其余可「生成选中」批量出图）`, 'success')
  }

  // ── 视觉体系：摄影棚监视器语言。暖黑浮板 + 单一钨丝灯琥珀强调色，全台统一 ──
  // 注意：不用 backdrop-filter——macOS 上毛玻璃与 WebGL 画布同层合成会偶发整层丢帧（闪现露出后面的画布）
  const panelCls = 'rounded-2xl border border-white/10 bg-zinc-950/80 shadow-[0_12px_40px_rgba(0,0,0,0.45)]'
  const secCls = 'text-[11px] font-medium text-white/50' // 面板分区小标题
  const hintCls = 'text-white/35 leading-snug text-[11px]'
  const Btn = ({ on, onClick, children, title, disabled }: { on?: boolean; onClick: () => void; children: any; title: string; disabled?: boolean }) => (
    <button
      onClick={onClick}
      title={title}
      disabled={disabled}
      className={`px-1.5 py-1 rounded-lg text-xs flex items-center gap-1 border whitespace-nowrap transition-colors duration-150 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40 ${
        on ? 'border-amber-300/50 bg-amber-300/15 text-amber-200' : 'border-white/10 bg-white/[0.04] text-white/70 hover:bg-white/10 hover:text-white'
      }`}
    >
      {children}
    </button>
  )

  const kindIcon = (k: string) => (k === '人台' ? <User size={12} /> : k === '道具' ? <BoxIcon size={12} /> : <Upload size={12} />)
  const query = objectQuery.trim().toLocaleLowerCase()
  const filteredObjs = query
    ? objs.filter((o) => `${o.name} ${o.kind}`.toLocaleLowerCase().includes(query))
    : objs
  const objectGroups = ['人台', '道具', '模型']
    .map((kind) => ({ kind, items: filteredObjs.filter((o) => o.kind === kind) }))
    .filter((group) => group.items.length > 0)
  const setTransformAxis = (part: keyof TransformDraft, axis: 0 | 1 | 2, raw: string) => {
    const value = Number(raw)
    if (!Number.isFinite(value)) return
    api.current.setSelectedTransform?.(part, axis, value)
  }
  const renderAxisEditor = (label: string, part: keyof TransformDraft, step: number) => {
    if (!transformDraft) return null
    return (
      <div className="flex items-center gap-1.5">
        <span className="w-8 shrink-0 text-white/40">{label}</span>
        {(['X', 'Y', 'Z'] as const).map((axisLabel, axis) => (
          <label key={axisLabel} className="min-w-0 flex-1 flex items-center rounded-lg border border-white/10 bg-white/[0.04] focus-within:border-amber-300/50 transition-colors">
            <span className="pl-1.5 text-[9px] font-semibold text-white/30">{axisLabel}</span>
            <input
              aria-label={`${label} ${axisLabel}`}
              type="number"
              step={step}
              value={transformDraft[part][axis]}
              disabled={selectedObj?.locked}
              onChange={(e) => setTransformAxis(part, axis as 0 | 1 | 2, e.target.value)}
              onBlur={() => api.current.commitTransform?.()}
              className="w-full min-w-0 bg-transparent px-1 py-1 text-right text-[10px] tabular-nums outline-none disabled:opacity-35"
            />
          </label>
        ))}
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-[90] bg-zinc-950 flex flex-col text-white overscroll-none" data-interactive>
      {/* 挂载容器内联不透明底色：即使 WebGL 画布在 mac 合成时偶发丢帧，露出的也是深色而不是后面的画布 */}
      <div ref={mountRef} className="absolute inset-0" style={{ touchAction: 'none', backgroundColor: '#18181b' }} />
      {/* 三分构图线 + 中心十字（DOM overlay，不进 WebGL 渲染，出图/深度图不受污染）。
          范围限制在中央可视取景区内；不带 z-index——按 DOM 顺序沉到左右面板/顶栏/底栏之下，只盖 3D 视口 */}
      {showGuides && ready && (
        <svg className="absolute top-16 pointer-events-none" style={{ ...viewportStyle, bottom: bottomUiInset }} viewBox="0 0 3 3" preserveAspectRatio="none">
          {[1, 2].map((n) => (
            <g key={n} stroke="#fff" strokeOpacity="0.28" strokeWidth="1" vectorEffect="non-scaling-stroke">
              <line x1={n} y1="0" x2={n} y2="3" vectorEffect="non-scaling-stroke" />
              <line x1="0" y1={n} x2="3" y2={n} vectorEffect="non-scaling-stroke" />
            </g>
          ))}
          <g stroke="#fff" strokeOpacity="0.45" strokeWidth="1">
            <line x1="1.44" y1="1.5" x2="1.56" y2="1.5" vectorEffect="non-scaling-stroke" />
            <line x1="1.5" y1="1.44" x2="1.5" y2="1.56" vectorEffect="non-scaling-stroke" />
          </g>
        </svg>
      )}
      {/* 出图画幅框（选了非「视口」画幅时）：琥珀框内=模型实际看到的构图范围，框外压暗；同样沉在面板之下 */}
      {frameRect && (
        <div className="absolute top-16 pointer-events-none grid place-items-center" style={{ ...viewportStyle, bottom: bottomUiInset }}>
          <div style={{ width: frameRect.w, height: frameRect.h }} className="border border-amber-200/70 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]" />
        </div>
      )}
      {!ready && (
        <div className="absolute inset-0 grid place-items-center pointer-events-none">
          <span className={`${panelCls} px-4 py-2 text-sm text-white/70 flex items-center gap-2`}><Loader2 size={15} className="animate-spin text-amber-300" /> 正在加载 3D 导演台…</span>
        </div>
      )}
      <input ref={fileRef} type="file" accept=".glb,.gltf" className="hidden" onChange={onFile} />

      {/* 顶栏：一体化玻璃工具条（品牌 / 变换模式 / 视图 / 取景 / 撤销重做 / 关闭） */}
      <div className="absolute top-3 left-3 right-3 flex justify-center pointer-events-none z-[3]">
        <div className={`pointer-events-auto flex items-center gap-1.5 px-2 py-1.5 max-w-full flex-wrap ${panelCls}`}>
          <div className="flex items-center gap-1.5 pl-1.5 pr-2">
            <Film size={14} className="text-amber-300" />
            <span className="text-xs font-medium">3D 导演台</span>
          </div>
          <div className="w-px h-5 bg-white/10" />
          <Btn on={mode === 'translate'} onClick={() => onMode('translate')} title="移动整体 (Q)"><Move size={13} /> 移动</Btn>
          <Btn on={mode === 'rotate'} onClick={() => onMode('rotate')} title="旋转整体 (W)"><Rotate3d size={13} /> 旋转</Btn>
          <Btn on={mode === 'scale'} onClick={() => onMode('scale')} title="缩放整体 (E)"><Maximize size={13} /> 缩放</Btn>
          <Btn on={mode === 'pose'} onClick={() => onMode('pose')} title="摆姿 (R)"><Hand size={13} /> 摆姿</Btn>
          <div className="w-px h-5 bg-white/10" />
          <Btn on={!locked} onClick={() => onViewMode('camera')} title="机位视角：直接调整最终出图相机"><Camera size={13} /> 机位视角</Btn>
          <Btn on={locked} onClick={() => onViewMode('director')} title="导演视角：冻结出图机位，自由绕场查看"><Clapperboard size={13} /> 导演视角</Btn>
          {locked && <Btn onClick={() => api.current.setShotFromView?.()} title="把当前导演观察角度更新为出图机位"><Crosshair size={13} /> 更新机位</Btn>}
          <div className="w-px h-5 bg-white/10" />
          <Btn on={showGuides} onClick={() => setShowGuides((v) => !v)} title="三分构图线开关"><Grid3x3 size={13} /></Btn>
          <Btn on={panelsCollapsed} onClick={() => setPanelsCollapsed((v) => !v)} title={panelsCollapsed ? '展开对象树与检查器' : '收起侧栏，专注取景'}>
            {panelsCollapsed ? <PanelLeftOpen size={13} /> : <PanelLeftClose size={13} />}
            <span className="sr-only">{panelsCollapsed ? '展开对象树与检查器' : '收起侧栏，专注取景'}</span>
          </Btn>
          <div className="w-px h-5 bg-white/10" />
          <button onClick={() => api.current.undo?.()} disabled={!canUndo} title="撤销 (Ctrl+Z)" className="p-1.5 rounded-lg border border-white/10 bg-white/[0.04] text-white/70 hover:bg-white/10 hover:text-white disabled:opacity-30 transition-colors"><Undo2 size={13} /></button>
          <button onClick={() => api.current.redo?.()} disabled={!canRedo} title="重做 (Ctrl+Shift+Z)" className="p-1.5 rounded-lg border border-white/10 bg-white/[0.04] text-white/70 hover:bg-white/10 hover:text-white disabled:opacity-30 transition-colors"><Redo2 size={13} /></button>
          <div className="w-px h-5 bg-white/10" />
          <button onClick={close} title="关闭 (Esc)" className="p-1.5 rounded-lg text-white/60 hover:text-white hover:bg-white/10 transition-colors"><X size={15} /></button>
        </div>
      </div>

      {/* PiP：出图取景预览（仅锁定取景时显示） */}
      <div style={{ right: viewportRight }} className={`absolute top-16 z-[2] rounded-xl overflow-hidden ring-1 ring-amber-300/50 shadow-[0_8px_30px_rgba(0,0,0,0.5)] ${locked ? '' : 'hidden'}`}>
        <div ref={pipRef} />
        <div className="absolute top-0 left-0 px-1.5 py-0.5 text-[10px] bg-zinc-950/70 text-amber-200/90 rounded-br-lg">出图取景</div>
      </div>

      {/* 左：Outliner */}
      {!panelsCollapsed && (
        <div style={{ width: leftPanelWidth, bottom: bottomUiInset }} className={`absolute top-16 left-3 flex flex-col gap-2 p-3 ${panelCls} text-xs`}>
          <div onPointerDown={(event) => beginPanelResize('left', event)} className="absolute -right-1 top-4 bottom-4 z-10 w-2 cursor-col-resize" title="拖动调整对象树宽度" />
          <div className="flex items-center justify-between">
            <span className={secCls}>场景对象</span>
            <span className="text-[10px] tabular-nums text-white/30">{filteredObjs.length}/{objs.length}</span>
          </div>
          <div className="relative">
            <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-white/30" />
            <input
              value={objectQuery}
              onChange={(e) => setObjectQuery(e.target.value)}
              placeholder="搜索对象"
              aria-label="搜索场景对象"
              className="w-full rounded-lg border border-white/10 bg-black/20 py-1.5 pl-7 pr-2 text-[11px] outline-none placeholder:text-white/25 focus:border-amber-300/45 transition-colors"
            />
          </div>
          <div className="flex items-center gap-1">
            <Btn onClick={() => api.current.addMannequin?.()} title="添加人台"><User size={12} /> 人台</Btn>
            <Btn onClick={() => api.current.addProp?.()} title="添加道具"><BoxIcon size={12} /> 道具</Btn>
            <Btn onClick={onImportClick} title="导入 GLB/GLTF"><Upload size={12} /> 导入</Btn>
          </div>
          <div className="flex items-center gap-1">
            <Btn onClick={() => { void api.current.stagePreset?.('双人对话'); setFocal(35) }} title="布景预设：双人对话"><Users size={12} /> 双人</Btn>
            <Btn onClick={() => { void api.current.stagePreset?.('产品展示'); setFocal(35) }} title="布景预设：产品展示"><Package size={12} /> 产品</Btn>
          </div>
          <div className="h-px bg-white/[0.07]" />
          <div className="flex flex-col gap-2 overflow-auto ace-scroll flex-1">
            {objectGroups.map((group) => (
              <section key={group.kind} className="flex flex-col gap-1">
                <div className="flex items-center gap-2 px-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-white/25">
                  <span>{group.kind}</span><span className="h-px flex-1 bg-white/[0.06]" /><span>{group.items.length}</span>
                </div>
                {group.items.map((o) => (
                  <div key={o.id} className={`flex items-center gap-1 px-1.5 py-1 rounded-lg transition-colors ${selId === o.id ? 'bg-amber-300/15 text-amber-100' : 'bg-white/[0.03] hover:bg-white/[0.08] text-white/75'}`}>
                    {editId === o.id ? (
                      <input
                        autoFocus
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onBlur={() => { api.current.renameById?.(o.id, editName.trim() || o.name); setEditId(null) }}
                        onKeyDown={(e) => {
                          if (isImeComposing(e)) return // 组合期回车=确认候选，别当重命名提交
                          if (e.key === 'Enter') { api.current.renameById?.(o.id, editName.trim() || o.name); setEditId(null) }
                          else if (e.key === 'Escape') setEditId(null)
                        }}
                        className="flex-1 min-w-0 bg-zinc-900/80 rounded-md px-1 outline-none ring-1 ring-amber-300/60"
                      />
                    ) : (
                      <button
                        onClick={() => api.current.selectById?.(o.id)}
                        onDoubleClick={() => { setEditId(o.id); setEditName(o.name) }}
                        title={`${o.kind} · 双击改名`}
                        className="flex-1 min-w-0 flex items-center gap-1.5 rounded text-left outline-none focus-visible:ring-1 focus-visible:ring-amber-300/50"
                      >
                        {kindIcon(o.kind)} <span className="truncate">{o.name}</span>
                      </button>
                    )}
                    <button onClick={() => api.current.toggleVisById?.(o.id)} className="shrink-0 text-white/35 hover:text-white transition-colors" title={o.visible ? '隐藏' : '显示'}>{o.visible ? <Eye size={11} /> : <EyeOff size={11} />}</button>
                    <button onClick={() => api.current.toggleLockById?.(o.id)} className={`shrink-0 transition-colors ${o.locked ? 'text-amber-200' : 'text-white/35 hover:text-white'}`} title={o.locked ? '解锁变换' : '锁定变换'}>{o.locked ? <Lock size={11} /> : <Unlock size={11} />}</button>
                    <button onClick={() => api.current.duplicateById?.(o.id)} className="shrink-0 text-white/35 hover:text-white transition-colors" title="复制"><Copy size={11} /></button>
                    <button onClick={() => api.current.removeById?.(o.id)} className="shrink-0 text-white/35 hover:text-white transition-colors" title="删除"><Trash2 size={11} /></button>
                  </div>
                ))}
              </section>
            ))}
            {!objs.length && <span className="text-white/35">用上面按钮添加/导入对象</span>}
            {!!objs.length && !filteredObjs.length && <span className="text-white/35">没有匹配“{objectQuery.trim()}”的对象</span>}
          </div>
          <div className={hintCls}>拖 .glb/.gltf 到画面也可导入</div>
        </div>
      )}

      {/* 右：按上下文分离对象、角色与镜头，避免所有控制堆在一条长滚动区。 */}
      {!panelsCollapsed && (
        <div style={{ width: rightPanelWidth, bottom: bottomUiInset }} className={`absolute top-16 right-3 flex flex-col overflow-hidden ${panelCls} text-xs`}>
          <div onPointerDown={(event) => beginPanelResize('right', event)} className="absolute -left-1 top-4 bottom-4 z-10 w-2 cursor-col-resize" title="拖动调整检查器宽度" />
          <div className="grid shrink-0 grid-cols-3 gap-1 border-b border-white/[0.07] p-2">
            {([
              { id: 'object' as const, label: '对象', icon: <BoxIcon size={12} /> },
              { id: 'character' as const, label: '角色', icon: <User size={12} /> },
              { id: 'camera' as const, label: '镜头', icon: <Camera size={12} /> }
            ]).map((tab) => {
              const disabled = tab.id === 'character' && selKind !== '人台'
              return (
                <button
                  key={tab.id}
                  disabled={disabled}
                  aria-selected={inspectorTab === tab.id}
                  onClick={() => setInspectorTab(tab.id)}
                  className={`flex h-8 items-center justify-center gap-1.5 rounded-lg border text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-30 ${
                    inspectorTab === tab.id
                      ? 'border-amber-300/45 bg-amber-300/15 text-amber-100'
                      : 'border-transparent text-white/45 hover:border-white/10 hover:bg-white/[0.06] hover:text-white/80'
                  }`}
                >
                  {tab.icon}{tab.label}
                </button>
              )
            })}
          </div>

          <div className="min-h-0 flex-1 overflow-auto p-3 ace-scroll">
            {inspectorTab === 'object' && (
              selId ? (
                <div className="flex flex-col gap-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs font-medium text-white/80">{selectedObj?.name}</span>
                    {selectedObj?.locked && <span className="rounded-md bg-amber-300/10 px-1.5 py-0.5 text-[9px] text-amber-200">已锁定</span>}
                  </div>
                  <div className="flex flex-wrap items-center gap-1">
                    <Btn onClick={() => selId && api.current.duplicateById?.(selId)} title="复制"><Copy size={12} /> 复制</Btn>
                    <Btn onClick={() => api.current.lookAtSelected?.()} title="相机看向 (F)"><Crosshair size={12} /> 看向</Btn>
                    <Btn onClick={() => api.current.dropToGround?.()} title="物体底部贴合地面"><ArrowDownToLine size={12} /> 落地</Btn>
                    <Btn on={selectedObj?.locked} onClick={() => selId && api.current.toggleLockById?.(selId)} title={selectedObj?.locked ? '解锁变换' : '锁定变换'}>{selectedObj?.locked ? <Unlock size={12} /> : <Lock size={12} />} {selectedObj?.locked ? '解锁' : '锁定'}</Btn>
                    <Btn onClick={() => selId && api.current.removeById?.(selId)} title="删除 (Delete)"><Trash2 size={12} /> 删除</Btn>
                  </div>
                  {transformDraft && (
                    <div className="flex flex-col gap-1.5 rounded-xl border border-white/[0.07] bg-black/15 p-2">
                      <div className="mb-0.5 flex items-center justify-between">
                        <span className={secCls}>精确变换</span>
                        <span className="text-[9px] text-white/30">旋转单位 °</span>
                      </div>
                      {renderAxisEditor('位置', 'position', 0.1)}
                      {renderAxisEditor('旋转', 'rotation', 1)}
                      {renderAxisEditor('缩放', 'scale', 0.1)}
                    </div>
                  )}
                  <label className="flex flex-col gap-1.5 text-[11px] text-white/50">
                    对象描述
                    <textarea
                      value={descDraft}
                      onChange={(event) => setDescDraft(event.target.value)}
                      onBlur={() => selId && api.current.setDescById?.(selId, descDraft.trim())}
                      placeholder={selKind === '人台' ? '如：穿长衫的老者，白发拄拐' : selKind === '模型' ? '如：红色跑车' : '如：红木书桌，上有一盏台灯'}
                      className="h-16 resize-none rounded-lg border border-white/10 bg-white/[0.04] p-2 text-xs text-white/80 outline-none placeholder:text-white/30 focus:border-amber-300/50"
                    />
                  </label>
                  <div className={hintCls}>描述会按画面方位自动装配进提示词。</div>
                </div>
              ) : (
                <div className="grid min-h-32 place-items-center rounded-xl border border-dashed border-white/10 px-4 text-center text-[11px] leading-relaxed text-white/35">在场景中选择人物、道具或导入模型，编辑其位置与描述。</div>
              )
            )}

            {inspectorTab === 'character' && selKind === '人台' && (
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-xs font-medium text-white/80">{selectedObj?.name}</span>
                  <Btn onClick={() => setInspectorTab('object')} title="打开对象变换">变换</Btn>
                </div>
                <label className="flex flex-col gap-1.5 text-[11px] text-white/50">
                  角色描述
                  <textarea
                    value={descDraft}
                    onChange={(event) => setDescDraft(event.target.value)}
                    onBlur={() => selId && api.current.setDescById?.(selId, descDraft.trim())}
                    placeholder="如：穿长衫的老者，白发拄拐"
                    className="h-14 resize-none rounded-lg border border-white/10 bg-white/[0.04] p-2 text-xs text-white/80 outline-none placeholder:text-white/30 focus:border-amber-300/50"
                  />
                </label>
                <div className="flex flex-col gap-2">
                  <span className={secCls}>人物类型</span>
                  {DIRECTOR_BODY_GROUPS.map((group) => (
                    <div key={group.key} className="flex items-start gap-2">
                      <span className="w-7 shrink-0 pt-1.5 text-[10px] text-white/35">{group.label}</span>
                      <div className="grid min-w-0 flex-1 grid-cols-4 gap-1">
                        {DIRECTOR_BODY_PRESETS.filter((body) => body.group === group.key).map((body) => (
                          <Btn
                            key={body.bodyType}
                            on={selectedObj?.bodyType === body.bodyType}
                            disabled={bodyLoading !== null || selectedObj?.locked}
                            onClick={() => { void api.current.setBodyType?.(body.bodyType) }}
                            title={`独立 CC0 素体：${body.label}`}
                          >
                            {bodyLoading === body.bodyType && <Loader2 size={10} className="animate-spin" />}{body.label}
                          </Btn>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex flex-col gap-2">
                  <span className={secCls}>朝向</span>
                  <div className="flex flex-wrap gap-1">
                    {FACINGS.map((facing) => <Btn key={facing.k} disabled={selectedObj?.locked} onClick={() => api.current.setFacing?.(facing.r)} title={`朝向：${facing.k}`}>{facing.k}</Btn>)}
                  </div>
                </div>
                <DirectorPosePanel
                  activePose={selectedObj?.poseName || '站立'}
                  locked={selectedObj?.locked}
                  previews={posePreviews}
                  previewStatus={posePreviewStatus}
                  joint={jointEditor}
                  safety={poseSafety}
                  onApplyPose={(pose) => {
                    onMode('pose')
                    api.current.applyPose?.(pose.k, pose.m, pose.offsetY || 0, pose.controls)
                  }}
                  onRetryPreviews={() => setPosePreviewNonce((value) => value + 1)}
                  onSelectJoint={(name) => {
                    onMode('pose')
                    api.current.selectJointByName?.(name)
                  }}
                  onSetJointAxis={(axis, value) => api.current.setSelectedJointAxis?.(axis, value)}
                  onCommitJoint={() => api.current.commitJointEdit?.()}
                  onResetJoint={() => api.current.resetSelectedJoint?.()}
                />
                <div className={hintCls}>每种体态使用独立中性网格。首次选择时按需加载，之后在当前会话复用。</div>
              </div>
            )}

            {inspectorTab === 'camera' && (
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-white/80">出图镜头</span>
                  <span className="text-[10px] tabular-nums text-amber-200">{focal}mm</span>
                </div>
                <div className="flex flex-col gap-2">
                  <span className={secCls}>语义机位</span>
                  <DirectorCameraPresetGrid onApply={(presetId) => api.current.applyCameraPreset?.(presetId)} />
                  <div className={hintCls}>人物类机位跟随所选角色朝向；场景类机位覆盖当前可见对象。</div>
                </div>
                <div className="flex flex-col gap-2 rounded-xl border border-white/[0.07] bg-black/15 p-2.5">
                  <label className="flex items-center gap-2 text-[11px] text-white/50">
                    焦段
                    <input aria-label="镜头焦段" type="range" min={18} max={135} value={focal} onChange={(event) => onFocal(Number(event.target.value))} className="min-w-0 flex-1 accent-amber-300" />
                  </label>
                  <div className="flex flex-wrap gap-1">
                    {[24, 35, 50, 85].map((mm) => <Btn key={mm} on={focal === mm} onClick={() => onFocal(mm)} title={`${mm}mm`}>{mm}mm</Btn>)}
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  <span className={secCls}>画幅</span>
                  <div className="flex flex-wrap gap-1">
                    {ASPECTS.map((item) => <Btn key={item.k} on={aspect === item.k} onClick={() => onAspect(item.k)} title={item.ar ? `出图画幅 ${item.k}` : '跟随视口'}>{item.k}</Btn>)}
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  <span className={secCls}>镜别</span>
                  <div className="flex flex-wrap gap-1">
                    <Btn onClick={() => api.current.shotSize?.('cu')} title="特写">特写</Btn>
                    <Btn onClick={() => api.current.shotSize?.('ms')} title="中景">中景</Btn>
                    <Btn onClick={() => api.current.shotSize?.('fs')} title="全景">全景</Btn>
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  <span className={secCls}>机位高度</span>
                  <div className="flex flex-wrap gap-1">
                    <Btn onClick={() => api.current.angle?.('low')} title="仰拍">仰拍</Btn>
                    <Btn onClick={() => api.current.angle?.('eye')} title="平视">平视</Btn>
                    <Btn onClick={() => api.current.angle?.('high')} title="俯拍">俯拍</Btn>
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  <span className={secCls}>灯光</span>
                  <div className="flex flex-wrap gap-1">
                    {LIGHTINGS.map((item) => <Btn key={item.k} on={lighting === item.k} onClick={() => { setLighting(item.k); api.current.setLighting?.(item.k) }} title={`灯光预设：${item.k}`}>{item.k}</Btn>)}
                  </div>
                </div>
                {hasControlModel && (
                  <div className="flex flex-col gap-2">
                    <span className={secCls}>控制图</span>
                    <div className="flex gap-1">
                      <Btn on={ctrlType === 'depth'} onClick={() => setCtrlType('depth')} title="深度控制图">深度</Btn>
                      <Btn on={ctrlType === 'pose'} onClick={() => setCtrlType('pose')} title="OpenPose 骨架控制图">骨架</Btn>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="absolute z-[3]" style={{ ...viewportStyle, bottom: 84, height: shotStripHeight }}>
        <DirectorShotStrip
          shots={shots}
          activeShotId={activeShotId}
          expanded={shotStripExpanded}
          busy={busy}
          onToggle={() => setShotStripExpanded((value) => !value)}
          onAdd={addShot}
          onApply={applyShot}
          onGenerate={(index) => { void genShot(index) }}
          onDuplicate={duplicateShot}
          onDelete={delShot}
          onRename={renameShot}
          onCycleTake={cycleTake}
          onReorder={reorderShots}
          onBatchGenerate={() => { void batchGenerate() }}
          onExport={exportStoryboard}
        />
      </div>

      {/* 底：场景描述 + 生成 */}
      <div className="absolute bottom-3 flex items-end gap-2" style={viewportStyle}>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="场景/角色描述（如：中式书房，一位穿长衫的老者站在书桌前…）"
          className={`flex-1 h-16 resize-none ${panelCls} text-sm px-3 py-2 outline-none placeholder:text-white/30 focus:border-amber-300/40 transition-colors`}
        />
        <button
          onClick={() => {
            const { full } = buildFullPrompt()
            // 宿主剪贴板优先（Electron 里 navigator.clipboard 常因权限静默失败，见 mulby docs/super-panel）；失败打日志便于诊断
            const write = window.mulby?.clipboard?.writeText
              ? (window.mulby.clipboard.writeText(full) as Promise<void>)
              : navigator.clipboard.writeText(full)
            void write
              .then(() => toast('已复制完整提示词（即模型实际收到的文本）', 'success'))
              .catch((e: any) => {
                console.error('[DirectorStage] 复制提示词失败', e)
                console.info('[DirectorStage] 完整提示词如下，可手动复制：\n' + full)
                toast('复制失败：完整提示词已打印到控制台 (DevTools)', 'error')
              })
          }}
          className="h-16 px-3 rounded-2xl border border-white/10 bg-white/[0.04] text-white/70 hover:bg-white/10 hover:text-white text-xs flex items-center gap-1 whitespace-nowrap transition-colors"
          title="复制完整提示词"
        >
          <Copy size={14} /> 提示词
        </button>
        <button onClick={() => void run()} disabled={busy} title="抓当前取景创建参考图节点 + 生图节点" className="h-16 px-6 rounded-2xl bg-amber-300 text-zinc-950 hover:bg-amber-200 text-sm font-semibold flex items-center gap-2 disabled:opacity-50 whitespace-nowrap transition-colors active:scale-[0.98]">
          {busy ? <><Loader2 size={16} className="animate-spin" /> 创建中…</> : <><Film size={16} /> 创建节点</>}
        </button>
      </div>

      {/* 生成中：遮罩拦截一切交互，避免改动场景/相机影响抓帧（尤其批量逐机位） */}
      {busy && (
        <div className="absolute inset-0 z-[95] grid place-items-center bg-zinc-950/60 cursor-wait">
          <span className={`${panelCls} px-4 py-2 text-sm text-white/80 flex items-center gap-2`}><Loader2 size={16} className="animate-spin text-amber-300" /> 生成中…请稍候</span>
        </div>
      )}
    </div>
  )
}

import { useGraph } from '../store/graphStore'
import { useTask } from '../store/taskStore'
import { saveBase64, loadImageInput } from './media'
import { toast } from '../store/toastStore'
import { aiLimiter } from './limiter'

// ─────────── equirect(2048×1024)↔透视投影 WebGL 工具，服务于全景卡「天/地极点修复」 ───────────
// 唯一对外导出 = repairEquirectPoles（被 MediaToolbox 调用）；eqToPersp/perspToEqPaste/planPanoViews
// 均为其内部步骤、无外部消费者（早期「渐进式 outpaint」全景生成范式已弃用，仅极点修复沿用这套投影核心）。
// 约定(与查看器一致，用户未抱怨朝向)：world +X=front(lon0)、+Z=right(lon+90)、+Y=up(lat+90)。
// equirect 画布顶行 = lat+90(天)。统一规则：贴图上传 UNPACK_FLIP_Y=true；渲染后 readPixels 翻行使
// 输出画布顶行=GL 顶；采样一律用"v 向上"的自然坐标。2048×1024 是 2 的幂 → 经度可 REPEAT 无缝。

const EQ_W = 2048
const EQ_H = 1024
const PI = Math.PI

const VERT = `attribute vec2 p; varying vec2 vUv; void main(){ vUv=p*0.5+0.5; gl_Position=vec4(p,0.0,1.0); }`

// equirect → 透视：每个透视像素发射相机射线 → 在 equirect 上采样（保留 alpha=未填充透明）
const EQ_SAMPLE = `
precision highp float; varying vec2 vUv;
uniform sampler2D eqTex; uniform float t; uniform vec3 F,R,U;
const float PI=3.14159265359;
void main(){
  vec2 s=(vUv-0.5)*2.0;
  vec3 d=normalize(F + s.x*t*R + s.y*t*U);
  float lon=atan(d.z,d.x);
  float lat=asin(clamp(d.y,-1.0,1.0));
  gl_FragColor=texture2D(eqTex, vec2(lon/(2.0*PI)+0.5, lat/PI+0.5));
}`

// 透视 → equirect 回贴：每个 equirect 像素方向投影到相机平面，落在视锥内且该处透视不透明则取透视，否则保留旧 equirect
const EQ_PASTE = `
precision highp float; varying vec2 vUv;
uniform sampler2D eqOld, persp; uniform float t; uniform vec3 F,R,U;
const float PI=3.14159265359;
void main(){
  float lon=(vUv.x-0.5)*2.0*PI;
  float lat=(vUv.y-0.5)*PI;
  float cl=cos(lat);
  vec3 d=vec3(cl*cos(lon), sin(lat), cl*sin(lon));
  float cz=dot(d,F);
  vec4 oldc=texture2D(eqOld, vUv);
  if(cz>0.0001){
    float px=0.5+0.5*dot(d,R)/(cz*t);
    float py=0.5+0.5*dot(d,U)/(cz*t);
    if(px>=0.0&&px<=1.0&&py>=0.0&&py<=1.0){
      vec4 pc=texture2D(persp, vec2(px,py));
      if(pc.a>0.01){ gl_FragColor=pc; return; }
    }
  }
  gl_FragColor=oldc;
}`

function cross(a: number[], b: number[]) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}
function norm(a: number[]) {
  const l = Math.hypot(a[0], a[1], a[2]) || 1
  return [a[0] / l, a[1] / l, a[2] / l]
}
// 相机基：F=前(由 lon/lat)，R=cross(F,up)=右，U=cross(R,F)=上；近极点换备用 up 防退化
function basis(lonDeg: number, latDeg: number) {
  const lon = (lonDeg * PI) / 180
  const lat = (latDeg * PI) / 180
  const cl = Math.cos(lat)
  const F = [cl * Math.cos(lon), Math.sin(lat), cl * Math.sin(lon)]
  let up = [0, 1, 0]
  if (Math.abs(F[1]) > 0.999) up = [0, 0, 1]
  const R = norm(cross(F, up))
  const U = norm(cross(R, F))
  return { F, R, U }
}

function sh(gl: WebGLRenderingContext, type: number, src: string) {
  const s = gl.createShader(type)!
  gl.shaderSource(s, src)
  gl.compileShader(s)
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader 编译失败')
  return s
}
function uploadTex(gl: WebGLRenderingContext, unit: number, src: TexImageSource, name: string, prog: WebGLProgram, repeat: boolean) {
  gl.activeTexture(gl.TEXTURE0 + unit)
  const t = gl.createTexture()
  gl.bindTexture(gl.TEXTURE_2D, t)
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.uniform1i(gl.getUniformLocation(prog, name), unit)
}
function pass(w: number, h: number, frag: string, setup: (gl: WebGLRenderingContext, prog: WebGLProgram) => void): HTMLCanvasElement {
  const cv = document.createElement('canvas')
  cv.width = w
  cv.height = h
  const gl = cv.getContext('webgl', { preserveDrawingBuffer: true, premultipliedAlpha: false })
  if (!gl) throw new Error('WebGL 不可用')
  const prog = gl.createProgram()!
  gl.attachShader(prog, sh(gl, gl.VERTEX_SHADER, VERT))
  gl.attachShader(prog, sh(gl, gl.FRAGMENT_SHADER, frag))
  gl.linkProgram(prog)
  gl.useProgram(prog)
  const b = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, b)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
  const loc = gl.getAttribLocation(prog, 'p')
  gl.enableVertexAttribArray(loc)
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)
  setup(gl, prog)
  gl.viewport(0, 0, w, h)
  gl.clearColor(0, 0, 0, 0)
  gl.clear(gl.COLOR_BUFFER_BIT)
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  const px = new Uint8Array(w * h * 4)
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px)
  const out = document.createElement('canvas')
  out.width = w
  out.height = h
  const ctx = out.getContext('2d')!
  const id = ctx.createImageData(w, h)
  const row = w * 4
  for (let y = 0; y < h; y++) id.data.set(px.subarray((h - 1 - y) * row, (h - y) * row), y * row)
  ctx.putImageData(id, 0, 0)
  return out
}

// equirect → 正交透视面（size×size，fov 度）——内部步骤，供 repairEquirectPoles 复用
function eqToPersp(eq: TexImageSource, lonDeg: number, latDeg: number, fovDeg: number, size: number): HTMLCanvasElement {
  const t = Math.tan((fovDeg * PI) / 360)
  const { F, R, U } = basis(lonDeg, latDeg)
  return pass(size, size, EQ_SAMPLE, (gl, prog) => {
    uploadTex(gl, 0, eq, 'eqTex', prog, true)
    gl.uniform1f(gl.getUniformLocation(prog, 't'), t)
    gl.uniform3f(gl.getUniformLocation(prog, 'F'), F[0], F[1], F[2])
    gl.uniform3f(gl.getUniformLocation(prog, 'R'), R[0], R[1], R[2])
    gl.uniform3f(gl.getUniformLocation(prog, 'U'), U[0], U[1], U[2])
  })
}

// 透视面回贴到（旧）equirect → 新 equirect——内部步骤，供 repairEquirectPoles 复用
function perspToEqPaste(eqOld: TexImageSource, persp: TexImageSource, lonDeg: number, latDeg: number, fovDeg: number): HTMLCanvasElement {
  const t = Math.tan((fovDeg * PI) / 360)
  const { F, R, U } = basis(lonDeg, latDeg)
  return pass(EQ_W, EQ_H, EQ_PASTE, (gl, prog) => {
    uploadTex(gl, 0, eqOld, 'eqOld', prog, true)
    uploadTex(gl, 1, persp, 'persp', prog, false)
    gl.uniform1f(gl.getUniformLocation(prog, 't'), t)
    gl.uniform3f(gl.getUniformLocation(prog, 'F'), F[0], F[1], F[2])
    gl.uniform3f(gl.getUniformLocation(prog, 'R'), R[0], R[1], R[2])
    gl.uniform3f(gl.getUniformLocation(prog, 'U'), U[0], U[1], U[2])
  })
}

function b64(cv: HTMLCanvasElement): string {
  return cv.toDataURL('image/png').split(',')[1]
}

function ai() {
  return window.mulby.ai
}

function dataUrlToBuffer(d: string): ArrayBuffer {
  const s = d.split(',')[1] || ''
  const bin = atob(s)
  const a = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i)
  return a.buffer
}
async function bmpFromB64(s: string): Promise<ImageBitmap> {
  return createImageBitmap(await (await fetch(`data:image/png;base64,${s}`)).blob())
}
async function toSquare(s: string, size: number): Promise<HTMLCanvasElement> {
  const bmp = await bmpFromB64(s)
  const c = document.createElement('canvas')
  c.width = size
  c.height = size
  c.getContext('2d')!.drawImage(bmp, 0, 0, size, size)
  return c
}

// 图生图 outpaint：透视图带透明洞 → 模型按周边补全（仅填透明、其余保持）。供天/地修复复用。
async function outpaintFace(model: string, persp: HTMLCanvasElement, prompt: string, size: number): Promise<HTMLCanvasElement> {
  const res = await aiLimiter(async () => {
    const att = await ai().attachments.upload({ buffer: dataUrlToBuffer(persp.toDataURL('image/png')), mimeType: 'image/png', purpose: 'image' })
    return ai().images.edit({ model, imageAttachmentId: att.attachmentId, prompt })
  })
  const out = res?.images?.[0]
  if (!out) throw new Error('outpaint 失败')
  return toSquare(out, size)
}

// ── LLM 全局规划（PanoDreamer 思路）：先把场景拆成前后左右上下都连贯一致的方向描述 ──
interface PanoPlan {
  global: string
  front: string
  right: string
  back: string
  left: string
  up: string
  down: string
}
async function chat(messages: any[], model?: string): Promise<string> {
  let acc = ''
  const req = ai().call({ messages, ...(model ? { model } : {}) }, (c: any) => {
    const p = typeof c.content === 'string' ? c.content : ''
    if (p && (c.chunkType === 'text' || c.chunkType === undefined)) acc += p
  })
  const final = await req
  if (!acc && final && typeof final.content === 'string') acc = final.content
  return acc
}
async function planPanoViews(scene: string): Promise<PanoPlan> {
  const fb: PanoPlan = { global: scene, front: scene, right: scene, back: scene, left: scene, up: '天花板或天空', down: '地面或地板' }
  if (!scene.trim()) return fb
  try {
    const model = useGraph.getState().project.defaultTextModel || undefined
    const sys = '你是 360° 全景场景规划助手。给定场景，规划一个前后左右上下都连贯一致、彼此自然衔接、风格与光照统一的 360 环境。只输出 JSON，不要解释。'
    const user =
      `场景：${scene}\n\n请输出 JSON（中文，各 1-2 句、具体可画，相邻方向要能接上）：\n` +
      `{"global":"整体风格/光照/氛围","front":"正前方所见","right":"向右转90°所见","back":"正后方所见","left":"向左转90°所见",` +
      `"up":"正上方——室内为天花板(如中式吊顶/藻井/横梁/吊灯)，室外为天空","down":"正下方——室内为地板(木地板/地砖/地毯)，室外为地面"}`
    const raw = await chat([{ role: 'system', content: sys }, { role: 'user', content: user }], model)
    const m = raw.match(/\{[\s\S]*\}/)
    if (!m) return fb
    const p = JSON.parse(m[0])
    return {
      global: p.global || scene,
      front: p.front || scene,
      right: p.right || scene,
      back: p.back || scene,
      left: p.left || scene,
      up: p.up || fb.up,
      down: p.down || fb.down
    }
  } catch {
    return fb
  }
}
// 天/地方向专属强约束提示：desc=LLM 规划出的天花板/地板具体描述
function polePromptFor(global: string, desc: string, up: boolean): string {
  const s = global ? global + '\n\n' : ''
  return up
    ? `${s}镜头正抬头垂直看向【正上方】。请只在中心透明圆区绘制：${desc}。要与四周已有的墙体/景物【顶沿】自然衔接成俯视圆顶。【不要画沙发、桌椅、家具立面或墙面正立面】；非透明区域保持不变。Fill only the transparent center with the overhead (ceiling/sky); no furniture, no wall fronts.`
    : `${s}镜头正低头垂直看向【正下方】。请只在中心透明圆区绘制：${desc}。要与四周已有的墙体/景物【底沿】自然衔接成仰视圆地。【不要画沙发、桌椅、家具立面或天花板】；非透明区域保持不变。Fill only the transparent center with the floor/ground; no furniture fronts, no ceiling.`
}

// 中心挖透明圆（destination-out）：只把畸变最重的极点中心交给模型重绘
function punchCircleCenter(cv: HTMLCanvasElement, radius: number) {
  const ctx = cv.getContext('2d')!
  ctx.save()
  ctx.globalCompositeOperation = 'destination-out'
  ctx.beginPath()
  ctx.arc(cv.width / 2, cv.height / 2, radius, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

// 锚定式天/地修复（推荐）：在【已全局连贯的底图】上，把天顶/地心投影成透视(大 FOV 带一大圈真实周边)，
// 只挖中心圆重绘 → 四周真实环带锁住语义，模型不会瞎画家具；贴回原底图（同约定读写，列对齐，不需 rollHalf）。
export async function repairEquirectPoles(cardId: string): Promise<void> {
  const g = useGraph.getState()
  const src = g.getCard(cardId)
  if (!src?.assetUrl) {
    toast('该卡片没有图片', 'error')
    return
  }
  if (!src.modelId) {
    toast('请先选择图像模型（需支持图生图）', 'error')
    return
  }
  const model = src.modelId
  const scene = (src.prompt || '').trim()
  const boardId = g.boardIdOfCard(cardId)
  const S = 1024
  const FOV = 120 // 带一大圈真实周边当锚
  useTask.getState().inc()
  try {
    const buf = await loadImageInput({ url: src.assetUrl, localPath: src.assetLocalPath || undefined })
    if (!buf) throw new Error('读取图片失败')
    const bmp = await createImageBitmap(new Blob([buf], { type: src.mime || 'image/png' }))
    let eq = document.createElement('canvas')
    eq.width = EQ_W
    eq.height = EQ_H
    eq.getContext('2d')!.drawImage(bmp, 0, 0, EQ_W, EQ_H)
    const plan = await planPanoViews(scene) // LLM 规划出具体的天花板/地板描述
    for (let j = 0; j < 2; j++) {
      const up = j === 0
      const lat = up ? 90 : -90
      const view = eqToPersp(eq, 0, lat, FOV, S)
      punchCircleCenter(view, Math.round(S * 0.42)) // 只重绘中心畸变区，外圈真实周边当锚
      const filled = await outpaintFace(model, view, polePromptFor(plan.global, up ? plan.up : plan.down, up), S)
      eq = perspToEqPaste(eq, filled, 0, lat, FOV)
    }
    const saved = await saveBase64(useGraph.getState().project.id, `${cardId}_poles`, b64(eq), 'png')
    const id = useGraph.getState().addCard(
      'image',
      { x: src.x + src.w + 220, y: src.y + src.h / 2 },
      { title: (src.title || '全景') + ' · 天地修复', status: 'done', modelId: model, refIds: [src.id], assetUrl: saved.url, assetLocalPath: saved.path, mime: 'image/png', meta: { pano: true } },
      boardId
    )
    if (g.boardIdOfCard(cardId) === useGraph.getState().project.activeBoardId) useGraph.getState().setSelection([id])
    toast('天/地已修复', 'success')
  } catch (e: any) {
    toast('天/地修复失败：' + (e?.message || String(e)), 'error')
  } finally {
    useTask.getState().dec()
  }
}

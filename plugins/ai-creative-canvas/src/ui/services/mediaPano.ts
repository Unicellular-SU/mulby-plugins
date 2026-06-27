import { useGraph } from '../store/graphStore'
import { useTask } from '../store/taskStore'
import { saveBase64, loadImageInput } from './media'
import { toast } from '../store/toastStore'

function ai(): any {
  return (window as any).mulby.ai
}

// ───────────────────────── C：立方体贴图(6 面) → 等距柱状 ─────────────────────────
// 思路(CubeDiff)：6 个 90° 普通透视面（模型最擅长透视，避免"假等距柱状"几何错）→ 数学精确转 equirect。
// 世界系与查看器一致：+X=front(lon0)、+Z=right(lon+90)、+Y=up(lat+90)。每面用显式 R/U 向量控制朝向。
const CUBE_VERT = `attribute vec2 p; varying vec2 vUv; void main(){ vUv=p*0.5+0.5; gl_Position=vec4(p,0.0,1.0); }`
const CUBE_FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D fFront,fBack,fLeft,fRight,fUp,fDown;
const float PI=3.14159265359;
vec4 face(sampler2D t, vec3 d, vec3 F, vec3 R, vec3 U){
  float den=dot(d,F);
  vec2 uv=vec2(0.5+0.5*dot(d,R)/den, 0.5-0.5*dot(d,U)/den);
  return texture2D(t, uv);
}
void main(){
  float lon=(vUv.x-0.5)*2.0*PI;
  float lat=(vUv.y-0.5)*PI;          // vUv.y=1 → +90(天顶)；读回时整体翻行使输出上=天
  float cl=cos(lat);
  vec3 d=vec3(cl*cos(lon), sin(lat), cl*sin(lon));
  vec3 a=abs(d);
  if(a.x>=a.y && a.x>=a.z){
    if(d.x>0.0) gl_FragColor=face(fFront,d,vec3(1,0,0),vec3(0,0,1),vec3(0,1,0));
    else        gl_FragColor=face(fBack ,d,vec3(-1,0,0),vec3(0,0,-1),vec3(0,1,0));
  } else if(a.z>=a.x && a.z>=a.y){
    if(d.z>0.0) gl_FragColor=face(fRight,d,vec3(0,0,1),vec3(-1,0,0),vec3(0,1,0));
    else        gl_FragColor=face(fLeft ,d,vec3(0,0,-1),vec3(1,0,0),vec3(0,1,0));
  } else {
    if(d.y>0.0) gl_FragColor=face(fUp  ,d,vec3(0,1,0),vec3(0,0,1),vec3(-1,0,0));
    else        gl_FragColor=face(fDown,d,vec3(0,-1,0),vec3(0,0,1),vec3(1,0,0));
  }
}`

const FACE_KEYS = ['front', 'right', 'back', 'left', 'up', 'down'] as const
type FaceKey = (typeof FACE_KEYS)[number]
const FACE_PROMPT: Record<FaceKey, string> = {
  front: 'facing straight forward (the front view).',
  right: 'turned exactly 90 degrees to the right of the front view.',
  back: 'facing directly backward, 180 degrees from the front view.',
  left: 'turned exactly 90 degrees to the left of the front view.',
  up: 'looking straight up at the sky or ceiling (the zenith, directly overhead).',
  down: 'looking straight down at the ground or floor (the nadir, directly below).'
}

function compileCube(gl: WebGLRenderingContext, type: number, src: string) {
  const s = gl.createShader(type)!
  gl.shaderSource(s, src)
  gl.compileShader(s)
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader 编译失败')
  return s
}

function mkTex(gl: WebGLRenderingContext, img: TexImageSource) {
  const t = gl.createTexture()
  gl.bindTexture(gl.TEXTURE_2D, t)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  return t
}

// 6 面 → 等距柱状 base64（WebGL 渲染 + readPixels 翻行）。outW:outH=2:1。
function cubemapToEquirect(faces: Record<FaceKey, ImageBitmap>, outW: number, outH: number): string {
  const cv = document.createElement('canvas')
  cv.width = outW
  cv.height = outH
  const gl = cv.getContext('webgl', { preserveDrawingBuffer: true })
  if (!gl) throw new Error('WebGL 不可用')
  const prog = gl.createProgram()!
  gl.attachShader(prog, compileCube(gl, gl.VERTEX_SHADER, CUBE_VERT))
  gl.attachShader(prog, compileCube(gl, gl.FRAGMENT_SHADER, CUBE_FRAG))
  gl.linkProgram(prog)
  gl.useProgram(prog)
  const buf = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, buf)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
  const loc = gl.getAttribLocation(prog, 'p')
  gl.enableVertexAttribArray(loc)
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)
  const units: Record<FaceKey, number> = { front: 0, right: 1, back: 2, left: 3, up: 4, down: 5 }
  const uname: Record<FaceKey, string> = { front: 'fFront', right: 'fRight', back: 'fBack', left: 'fLeft', up: 'fUp', down: 'fDown' }
  for (const k of FACE_KEYS) {
    gl.activeTexture(gl.TEXTURE0 + units[k])
    mkTex(gl, faces[k])
    gl.uniform1i(gl.getUniformLocation(prog, uname[k]), units[k])
  }
  gl.viewport(0, 0, outW, outH)
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  // readPixels 自下而上 → 翻行写入 2D 画布
  const px = new Uint8Array(outW * outH * 4)
  gl.readPixels(0, 0, outW, outH, gl.RGBA, gl.UNSIGNED_BYTE, px)
  const c2 = document.createElement('canvas')
  c2.width = outW
  c2.height = outH
  const ctx = c2.getContext('2d')!
  const id = ctx.createImageData(outW, outH)
  const row = outW * 4
  for (let y = 0; y < outH; y++) id.data.set(px.subarray((outH - 1 - y) * row, (outH - y) * row), y * row)
  ctx.putImageData(id, 0, 0)
  return c2.toDataURL('image/png').split(',')[1]
}

// 水平环绕平移 dx：内容右移 dx（mod w）。对 w/2 连用两次 = 平移 w = 恒等（可逆）。
function offsetWrapX(src: CanvasImageSource, w: number, h: number, dx: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')!
  ctx.drawImage(src, dx, 0, w, h)
  ctx.drawImage(src, dx - w, 0, w, h)
  return c
}

function dataUrlToBuffer(d: string): ArrayBuffer {
  const b64 = d.split(',')[1] || ''
  const bin = atob(b64)
  const arr = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
  return arr.buffer
}

async function bitmapFromDataUrl(d: string): Promise<ImageBitmap> {
  const blob = await (await fetch(d)).blob()
  return createImageBitmap(blob)
}

async function genFace(model: string, prompt: string, size: string, seed?: number): Promise<string> {
  const req = ai().images.generateStream({ model, prompt, size, count: 1, ...(seed ? { seed } : {}) }, () => {})
  const res = await req
  const img = res?.images?.[0]
  if (!img) throw new Error('某个面生成失败')
  return img
}

// C：6 面立方体合成 360。用源卡的提示词+模型生成 6 个透视面 → 数学转等距柱状 → 落全景卡。
// 实验性：面间一致性靠"同风格+同 seed"尽力，可能仍有接面差异；天/地朝向若不对可调 CUBE_FRAG 向量。
export async function generateCubemapPano(cardId: string): Promise<void> {
  const g = useGraph.getState()
  const src = g.getCard(cardId)
  if (!src) return
  const scene = (src.prompt || '').trim()
  if (!scene) {
    toast('请先在该卡片写场景提示词（6 面将据此生成）', 'error')
    return
  }
  if (!src.modelId) {
    toast('请先选择图像模型', 'error')
    return
  }
  const model = src.modelId
  const boardId = g.boardIdOfCard(cardId)
  const seed = Number(src.params?.seed) || 12345 // 同 seed 利于六面风格一致
  const shared =
    scene +
    '\n\nOne face of a seamless 360° cubemap panorama. 90 degree field of view, rectilinear perspective (NOT equirectangular, no fisheye, no distortion), square 1:1 framing, consistent art style / lighting / weather across all six faces, continuous scene that tiles seamlessly with adjacent faces.\nThis face is '
  const id = useGraph.getState().addCard(
    'image',
    { x: src.x + src.w + 240, y: src.y + src.h / 2 },
    { title: (src.title || '场景') + ' · 6面全景', status: 'running', progress: 0.02, modelId: model, refIds: [src.id], meta: { pano: true } },
    boardId
  )
  useTask.getState().inc()
  try {
    const faces = {} as Record<FaceKey, ImageBitmap>
    for (let i = 0; i < FACE_KEYS.length; i++) {
      const k = FACE_KEYS[i]
      const b64 = await genFace(model, shared + FACE_PROMPT[k], '1024x1024', seed)
      faces[k] = await bitmapFromDataUrl(`data:image/png;base64,${b64}`)
      useGraph.getState().updateCard(id, { progress: ((i + 1) / FACE_KEYS.length) * 0.85 })
    }
    const equirect = cubemapToEquirect(faces, 2048, 1024)
    const saved = await saveBase64(useGraph.getState().project.id, `${id}_cube`, equirect, 'png')
    useGraph.getState().updateCard(id, { status: 'done', progress: 1, assetUrl: saved.url, assetLocalPath: saved.path, mime: 'image/png' })
    toast('6 面合成全景完成', 'success')
  } catch (e: any) {
    useGraph.getState().updateCard(id, { status: 'error', progress: 0, error: e?.message || String(e) })
    toast('6 面合成失败：' + (e?.message || String(e)), 'error')
  } finally {
    useTask.getState().dec()
  }
}

// 360 接缝修复（替代羽化）：把图水平平移半幅 → 接缝移到画面正中 → 在中缝挖透明带 →
// 图生图(ai.images.edit)按周边重绘接好 → 再平移半幅复位 → 落新全景卡。比羽化好得多。
export async function repairEquirectSeam(cardId: string): Promise<void> {
  const g = useGraph.getState()
  const src = g.getCard(cardId)
  if (!src || !src.assetUrl) {
    toast('该卡片没有图片', 'error')
    return
  }
  if (!src.modelId) {
    toast('请先在节点里选择图像模型（需支持图生图）', 'error')
    return
  }
  const boardId = g.boardIdOfCard(cardId)
  useTask.getState().inc()
  try {
    const buf = await loadImageInput({ url: src.assetUrl, localPath: src.assetLocalPath || undefined })
    if (!buf) throw new Error('读取图片失败')
    const bmp = await createImageBitmap(new Blob([buf], { type: src.mime || 'image/png' }))
    const w = bmp.width
    const h = bmp.height
    if (!w || !h) throw new Error('图片尺寸无效')

    // 1) 平移半幅 → 接缝到中央；2) 中缝挖透明带
    const shifted = offsetWrapX(bmp, w, h, Math.round(w / 2))
    const sctx = shifted.getContext('2d')!
    const band = Math.max(8, Math.round(w * 0.14))
    sctx.clearRect(Math.round(w / 2 - band / 2), 0, band, h) // 透明洞 = 待重绘区

    // 3) 上传 + 图生图重绘中缝
    const att = await ai().attachments.upload({
      buffer: dataUrlToBuffer(shifted.toDataURL('image/png')),
      mimeType: 'image/png',
      purpose: 'image'
    })
    const prompt =
      '这是一张等距柱状 360 全景图，中央有一条透明竖带。请只在透明带内无缝补全画面，' +
      '严格延续两侧的纹理、结构、光照与地平线，使中缝完全连续、不留痕迹；其余区域保持不变。' +
      'Seamlessly inpaint only the transparent vertical strip to continue the equirectangular panorama; no visible seam.'
    const res = await ai().images.edit({ model: src.modelId, imageAttachmentId: att.attachmentId, prompt })
    const out = res?.images?.[0]
    if (!out) throw new Error('模型未返回结果')

    // 4) 结果平移半幅复位（接缝回到左右边、已接好）
    const healed = await bitmapFromDataUrl(`data:image/png;base64,${out}`)
    const restored = offsetWrapX(healed, w, h, Math.round(w / 2))
    const base64 = restored.toDataURL('image/png').split(',')[1]

    const projectId = useGraph.getState().project.id
    const saved = await saveBase64(projectId, `${cardId}_seam`, base64, 'png')
    const id = useGraph.getState().addCard(
      'image',
      { x: src.x + src.w + 220, y: src.y + src.h / 2 },
      { title: (src.title || '全景') + ' · 接缝修复', status: 'done', modelId: src.modelId, refIds: [src.id], assetUrl: saved.url, assetLocalPath: saved.path, mime: 'image/png', meta: { pano: true } },
      boardId
    )
    if (g.boardIdOfCard(cardId) === useGraph.getState().project.activeBoardId) useGraph.getState().setSelection([id])
    toast('接缝已修复', 'success')
  } catch (e: any) {
    toast('接缝修复失败：' + (e?.message || String(e)), 'error')
  } finally {
    useTask.getState().dec()
  }
}

import { useGraph } from '../store/graphStore'
import { useTask } from '../store/taskStore'
import { saveBase64, loadImageInput } from './media'
import { toast } from '../store/toastStore'

// ─────────── ③ equirect 渐进式 outpaint —— 第 1 步：投影核心(eq↔persp) + 自检 ───────────
// 约定(与 cube/查看器一致，用户未抱怨朝向)：world +X=front(lon0)、+Z=right(lon+90)、+Y=up(lat+90)。
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

// equirect → 正交透视面（size×size，fov 度）
export function eqToPersp(eq: TexImageSource, lonDeg: number, latDeg: number, fovDeg: number, size: number): HTMLCanvasElement {
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

// 透视面回贴到（旧）equirect → 新 equirect
export function perspToEqPaste(eqOld: TexImageSource, persp: TexImageSource, lonDeg: number, latDeg: number, fovDeg: number): HTMLCanvasElement {
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

// 自检：取现有全景 → eq→persp 正前 → persp→eq 贴回空画布 → 落两张卡（透视图 + 回贴全景）。
// 360 里看回贴全景：正前 90° 应与原图正前一致、不畸变/不翻转，其余透明 → 证明两个投影方向都对。
export async function selfCheckProjection(cardId: string): Promise<void> {
  const g = useGraph.getState()
  const src = g.getCard(cardId)
  if (!src?.assetUrl) {
    toast('该卡片没有图片', 'error')
    return
  }
  const boardId = g.boardIdOfCard(cardId)
  useTask.getState().inc()
  try {
    const buf = await loadImageInput({ url: src.assetUrl, localPath: src.assetLocalPath || undefined })
    if (!buf) throw new Error('读取图片失败')
    const bmp = await createImageBitmap(new Blob([buf], { type: src.mime || 'image/png' }))
    // 归一到 2048×1024 equirect
    const eq = document.createElement('canvas')
    eq.width = EQ_W
    eq.height = EQ_H
    eq.getContext('2d')!.drawImage(bmp, 0, 0, EQ_W, EQ_H)

    const persp = eqToPersp(eq, 0, 0, 90, 1024) // 正前 90°
    const empty = document.createElement('canvas')
    empty.width = EQ_W
    empty.height = EQ_H // 透明
    const pasted = perspToEqPaste(empty, persp, 0, 0, 90)

    const pid = useGraph.getState().project.id
    const sp = await saveBase64(pid, `${cardId}_persp`, b64(persp), 'png')
    const se = await saveBase64(pid, `${cardId}_rt`, b64(pasted), 'png')
    useGraph.getState().addCard('image', { x: src.x + src.w + 240, y: src.y - src.h * 0.6 }, { title: (src.title || '') + ' · 正前透视(自检)', status: 'done', refIds: [src.id], assetUrl: sp.url, assetLocalPath: sp.path, mime: 'image/png' }, boardId)
    useGraph.getState().addCard('image', { x: src.x + src.w + 240, y: src.y + src.h * 0.6 }, { title: (src.title || '') + ' · 投影回贴(自检)', status: 'done', refIds: [src.id], assetUrl: se.url, assetLocalPath: se.path, mime: 'image/png', meta: { pano: true } }, boardId)
    toast('已生成自检：正前透视 + 投影回贴全景', 'success')
  } catch (e: any) {
    toast('投影自检失败：' + (e?.message || String(e)), 'error')
  } finally {
    useTask.getState().dec()
  }
}

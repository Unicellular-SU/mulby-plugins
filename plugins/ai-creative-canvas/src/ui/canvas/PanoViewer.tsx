import { useEffect, useRef, type PointerEvent as RPointerEvent } from 'react'
import { X, Compass, Maximize2 } from 'lucide-react'
import { useGraph } from '../store/graphStore'
import { useUi } from '../store/uiStore'

// 零依赖 360 全景查看器：等距柱状(equirectangular)→透视，按 yaw/pitch/fov 在 fragment shader 里采样。
// 仅显示不回读像素，file:// 贴图 taint 不影响渲染。POT(2048×1024)贴图 → 经度方向 REPEAT 无缝环绕。

const VERT = `
attribute vec2 pos;
varying vec2 vUv;
void main(){ vUv = pos * 0.5 + 0.5; gl_Position = vec4(pos, 0.0, 1.0); }
`

const FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D tex;
uniform vec2 res;
uniform float yaw;
uniform float pitch;
uniform float fov;
const float PI = 3.14159265359;
void main(){
  vec2 ndc = vUv * 2.0 - 1.0;
  float aspect = res.x / res.y;
  float t = tan(fov * 0.5);
  vec3 dir = normalize(vec3(ndc.x * t * aspect, ndc.y * t, -1.0));
  // pitch（绕 X）
  float cp = cos(pitch), sp = sin(pitch);
  dir = vec3(dir.x, dir.y * cp - dir.z * sp, dir.y * sp + dir.z * cp);
  // yaw（绕 Y）
  float cy = cos(yaw), sy = sin(yaw);
  dir = vec3(dir.x * cy + dir.z * sy, dir.y, -dir.x * sy + dir.z * cy);
  float lon = atan(dir.x, -dir.z);
  float lat = asin(clamp(dir.y, -1.0, 1.0));
  vec2 uv = vec2(lon / (2.0 * PI) + 0.5, 0.5 + lat / PI); // 配合 UNPACK_FLIP_Y：抬头(lat+)→v=1=图顶=天空
  gl_FragColor = texture2D(tex, uv);
}
`

function compile(gl: WebGLRenderingContext, type: number, src: string) {
  const sh = gl.createShader(type)!
  gl.shaderSource(sh, src)
  gl.compileShader(sh)
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) || 'shader 编译失败')
  return sh
}

export function PanoViewer() {
  const id = useUi((s) => s.panoCardId)
  const url = useGraph((s) => (id ? s.getActiveBoard().cards[id]?.assetUrl : null))
  if (!id || !url) return null
  return <Inner url={url} />
}

function Inner({ url }: { url: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const view = useRef({ yaw: 0, pitch: 0, fov: Math.PI / 2.2 })
  const drag = useRef<{ on: boolean; x: number; y: number }>({ on: false, x: 0, y: 0 })
  const draw = useRef<() => void>(() => {})
  const close = () => useUi.getState().setPanoCardId(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const gl = canvas.getContext('webgl', { antialias: true, preserveDrawingBuffer: false })
    if (!gl) return
    let raf = 0
    let disposed = false

    const prog = gl.createProgram()!
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT))
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG))
    gl.linkProgram(prog)
    gl.useProgram(prog)

    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    const posLoc = gl.getAttribLocation(prog, 'pos')
    gl.enableVertexAttribArray(posLoc)
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0)

    const uRes = gl.getUniformLocation(prog, 'res')
    const uYaw = gl.getUniformLocation(prog, 'yaw')
    const uPitch = gl.getUniformLocation(prog, 'pitch')
    const uFov = gl.getUniformLocation(prog, 'fov')
    const uTex = gl.getUniformLocation(prog, 'tex')

    const tex = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
    // 1×1 占位，贴图加载后替换
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([20, 20, 28, 255]))
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)

    const render = () => {
      raf = 0
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const w = Math.max(1, Math.round(canvas.clientWidth * dpr))
      const h = Math.max(1, Math.round(canvas.clientHeight * dpr))
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w
        canvas.height = h
      }
      gl.viewport(0, 0, canvas.width, canvas.height)
      gl.useProgram(prog)
      gl.uniform2f(uRes, canvas.width, canvas.height)
      gl.uniform1f(uYaw, view.current.yaw)
      gl.uniform1f(uPitch, view.current.pitch)
      gl.uniform1f(uFov, view.current.fov)
      gl.uniform1i(uTex, 0)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, tex)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    }
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(render)
    }
    draw.current = schedule

    // 加载贴图：缩放到 2048×1024（POT）→ 经度方向可 REPEAT 无缝
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      if (disposed) return
      const c = document.createElement('canvas')
      c.width = 2048
      c.height = 1024
      const cx = c.getContext('2d')!
      cx.drawImage(img, 0, 0, 2048, 1024)
      gl.bindTexture(gl.TEXTURE_2D, tex)
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT) // 经度无缝
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      schedule()
    }
    img.src = url

    const ro = new ResizeObserver(() => schedule())
    ro.observe(canvas)
    schedule()

    return () => {
      disposed = true
      if (raf) cancelAnimationFrame(raf)
      ro.disconnect()
      gl.deleteTexture(tex)
      gl.deleteBuffer(buf)
      gl.deleteProgram(prog)
    }
  }, [url])

  const onDown = (e: RPointerEvent<HTMLCanvasElement>) => {
    drag.current = { on: true, x: e.clientX, y: e.clientY }
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* ignore */ }
  }
  const onMove = (e: RPointerEvent<HTMLCanvasElement>) => {
    if (!drag.current.on) return
    const dx = e.clientX - drag.current.x
    const dy = e.clientY - drag.current.y
    drag.current.x = e.clientX
    drag.current.y = e.clientY
    const k = view.current.fov / canvasRef.current!.clientHeight // 拖动灵敏度随 fov
    // 抓取式(grab)导航：拖动等于"抓住画面拖走"，左右与上下一致（与 Street View/手机全景同款）
    view.current.yaw += dx * k
    view.current.pitch = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, view.current.pitch + dy * k))
    draw.current()
  }
  const onUp = (e: RPointerEvent<HTMLCanvasElement>) => {
    drag.current.on = false
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* ignore */ }
  }
  const onWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    view.current.fov = Math.max(0.5, Math.min(2.4, view.current.fov * Math.exp(e.deltaY * 0.001)))
    draw.current()
  }
  const reset = () => {
    view.current = { yaw: 0, pitch: 0, fov: Math.PI / 2.2 }
    draw.current()
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') useUi.getState().setPanoCardId(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="fixed inset-0 z-[90] bg-black flex flex-col" data-interactive>
      <canvas
        ref={canvasRef}
        className="flex-1 w-full h-full block cursor-grab active:cursor-grabbing"
        style={{ touchAction: 'none' }}
        onWheel={onWheel}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      />
      <div className="absolute top-3 left-3 flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-black/55 text-white text-xs">
        <Compass size={14} className="text-emerald-400" /> 360 全景 · 拖动环视 · 滚轮缩放
      </div>
      <div className="absolute top-3 right-3 flex items-center gap-1.5">
        <button onClick={reset} title="复位视角" className="w-8 h-8 grid place-items-center rounded-lg bg-black/55 hover:bg-black/70 text-white">
          <Maximize2 size={15} />
        </button>
        <button onClick={close} title="关闭（Esc）" className="w-8 h-8 grid place-items-center rounded-lg bg-black/55 hover:bg-black/70 text-white">
          <X size={16} />
        </button>
      </div>
    </div>
  )
}

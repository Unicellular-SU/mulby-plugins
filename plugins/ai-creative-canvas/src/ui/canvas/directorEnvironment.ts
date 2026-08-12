import type { DirectorCam, DirectorEnvironment } from '../types'

export const DIRECTOR_ENVIRONMENT_DEFAULTS = {
  mode: 'grounded' as const,
  compositionMode: 'physical' as const,
  backgroundScale: 1,
  cameraHeight: 1.6,
  horizon: 0,
  exposure: 1,
  environmentIntensity: 0.9,
  backgroundBlur: 0,
  shadowOpacity: 0.32
}

const finite = (value: unknown, fallback: number) => Number.isFinite(Number(value)) ? Number(value) : fallback
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

export type DirectorEnvironmentControls = Pick<
  Required<DirectorEnvironment>,
  'mode' | 'compositionMode' | 'backgroundScale' | 'cameraHeight' | 'horizon' | 'exposure' | 'environmentIntensity' | 'backgroundBlur' | 'shadowOpacity'
>

export function normalizeDirectorEnvironmentControls(raw: Partial<DirectorEnvironment> | null | undefined): DirectorEnvironmentControls {
  return {
    mode: raw?.mode === 'infinite' ? 'infinite' : 'grounded',
    compositionMode: raw?.compositionMode === 'adapted' ? 'adapted' : 'physical',
    backgroundScale: clamp(finite(raw?.backgroundScale, DIRECTOR_ENVIRONMENT_DEFAULTS.backgroundScale), 0.5, 2),
    cameraHeight: clamp(finite(raw?.cameraHeight, DIRECTOR_ENVIRONMENT_DEFAULTS.cameraHeight), 0.3, 5),
    horizon: clamp(finite(raw?.horizon, DIRECTOR_ENVIRONMENT_DEFAULTS.horizon), -20, 20),
    exposure: clamp(finite(raw?.exposure, DIRECTOR_ENVIRONMENT_DEFAULTS.exposure), 0.25, 3),
    environmentIntensity: clamp(finite(raw?.environmentIntensity, DIRECTOR_ENVIRONMENT_DEFAULTS.environmentIntensity), 0, 3),
    backgroundBlur: clamp(finite(raw?.backgroundBlur, DIRECTOR_ENVIRONMENT_DEFAULTS.backgroundBlur), 0, 1),
    shadowOpacity: clamp(finite(raw?.shadowOpacity, DIRECTOR_ENVIRONMENT_DEFAULTS.shadowOpacity), 0, 1)
  }
}

export function withDirectorEnvironmentDefaults<T extends DirectorEnvironment>(environment: T): T & DirectorEnvironmentControls {
  return { ...environment, ...normalizeDirectorEnvironmentControls(environment) }
}

/**
 * 将背景视觉尺寸换算成独立环境相机的垂直视角。
 * physical 模式始终返回主体相机视角，确保全景地面与接影透视一致。
 */
export function getDirectorBackgroundFov(
  foregroundFov: number,
  compositionMode: DirectorEnvironmentControls['compositionMode'],
  backgroundScale: number
): number {
  const safeFov = clamp(finite(foregroundFov, 50), 1, 140)
  if (compositionMode === 'physical') return safeFov
  const scale = clamp(finite(backgroundScale, 1), 0.5, 2)
  const halfFov = Math.tan((safeFov * Math.PI) / 360) / scale
  return clamp((Math.atan(halfFov) * 360) / Math.PI, 1, 140)
}

export interface DirectorSubjectCoverageOptions {
  center: [number, number, number]
  size: [number, number, number]
  verticalFov: number
  aspect: number
  coverage: number
}

/** 沿当前视线推拉相机，让对象包围盒约占输出画幅指定比例，不改变对象缩放和镜头焦段。 */
export function fitDirectorCameraToCoverage(cam: DirectorCam, options: DirectorSubjectCoverageOptions): DirectorCam {
  const verticalFov = clamp(finite(options.verticalFov, 50), 1, 140)
  const aspect = clamp(finite(options.aspect, 1), 0.1, 10)
  const coverage = clamp(finite(options.coverage, 0.5), 0.1, 0.95)
  const width = Math.max(0.01, finite(options.size[0], 1))
  const height = Math.max(0.01, finite(options.size[1], 1))
  const depth = Math.max(0, finite(options.size[2], 0))
  const tanHalfVertical = Math.tan((verticalFov * Math.PI) / 360)
  const fitDistance = Math.max(
    (height * 0.5) / (coverage * tanHalfVertical),
    (width * 0.5) / (coverage * tanHalfVertical * aspect)
  ) + depth * 0.5
  let dx = finite(cam.pos[0], 0) - finite(cam.target[0], 0)
  let dy = finite(cam.pos[1], 0) - finite(cam.target[1], 0)
  let dz = finite(cam.pos[2], 1) - finite(cam.target[2], 0)
  const directionLength = Math.hypot(dx, dy, dz)
  if (directionLength < 1e-6) {
    dx = 0
    dy = 0
    dz = 1
  } else {
    dx /= directionLength
    dy /= directionLength
    dz /= directionLength
  }
  const center: [number, number, number] = [
    finite(options.center[0], 0),
    finite(options.center[1], 0),
    finite(options.center[2], 0)
  ]
  return {
    pos: [center[0] + dx * fitDistance, center[1] + dy * fitDistance, center[2] + dz * fitDistance],
    target: center,
    focal: clamp(finite(cam.focal, 35), 1, 300)
  }
}

export type DirectorPanoramaQualityLevel = 'invalid' | 'preview' | 'standard' | 'high'

export interface DirectorPanoramaQuality {
  level: DirectorPanoramaQualityLevel
  label: string
  detail: string
  aspectValid: boolean
}

export function assessDirectorPanoramaQuality(width: unknown, height: unknown): DirectorPanoramaQuality | null {
  const w = Math.max(0, Math.round(finite(width, 0)))
  const h = Math.max(0, Math.round(finite(height, 0)))
  if (!w || !h) return null
  const aspectValid = Math.abs(w / h - 2) <= 0.15
  if (!aspectValid) {
    return { level: 'invalid', label: '画幅异常', detail: '不是标准 2:1 等距柱状全景，可能出现拉伸', aspectValid }
  }
  if (w < 4096) {
    return { level: 'preview', label: '预览质量', detail: '低于 4096×2048，广角或高清输出可能偏糊', aspectValid }
  }
  if (w < 8192) {
    return { level: 'standard', label: '可用质量', detail: '适合常规镜头，高清特写建议使用 8192×4096', aspectValid }
  }
  return { level: 'high', label: '高清质量', detail: '适合高清镜头与较窄视角', aspectValid }
}

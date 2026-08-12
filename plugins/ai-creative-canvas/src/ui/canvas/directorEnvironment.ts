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

export function getDirectorPanoramaCaptureOrigin(environment: Partial<DirectorEnvironment> | null | undefined): [number, number, number] {
  const controls = normalizeDirectorEnvironmentControls(environment)
  const raw = environment?.captureOrigin
  if (!Array.isArray(raw) || raw.length < 3) return [0, controls.cameraHeight, 0]
  return [finite(raw[0], 0), controls.cameraHeight, finite(raw[2], 0)]
}

export type DirectorPanoramaCameraRiskLevel = 'safe' | 'caution' | 'high'

export interface DirectorPanoramaCameraStatus {
  origin: [number, number, number]
  distance: number
  horizontalDistance: number
  verticalDistance: number
  level: DirectorPanoramaCameraRiskLevel
  approximate: boolean
  label: string
  detail: string
}

export function assessDirectorPanoramaCamera(
  cam: Pick<DirectorCam, 'pos'>,
  environment: Partial<DirectorEnvironment> | null | undefined
): DirectorPanoramaCameraStatus | null {
  if (!environment?.assetId) return null
  const controls = normalizeDirectorEnvironmentControls(environment)
  const origin = getDirectorPanoramaCaptureOrigin(environment)
  const dx = finite(cam.pos?.[0], origin[0]) - origin[0]
  const dy = finite(cam.pos?.[1], origin[1]) - origin[1]
  const dz = finite(cam.pos?.[2], origin[2]) - origin[2]
  const horizontalDistance = Math.hypot(dx, dz)
  const verticalDistance = Math.abs(dy)
  const distance = Math.hypot(dx, dy, dz)
  const level: DirectorPanoramaCameraRiskLevel = distance > 1.5 ? 'high' : distance > 0.5 ? 'caution' : 'safe'
  const approximate = controls.compositionMode === 'adapted' || controls.mode === 'infinite' || level !== 'safe'
  return {
    origin,
    distance,
    horizontalDistance,
    verticalDistance,
    level,
    approximate,
    label: level === 'high' ? '高视差风险' : level === 'caution' ? '注意视差' : approximate ? '近似透视' : '安全范围',
    detail: level === 'high'
      ? '相机已明显离开全景拍摄点，地面、遮挡和空间尺度可能失真。'
      : level === 'caution'
        ? '单张全景没有真实深度，继续横移或推拉会增加视差误差。'
        : controls.compositionMode === 'adapted'
          ? '相机仍在拍摄点附近，但背景使用独立视野，地面透视为近似。'
          : controls.mode === 'infinite'
            ? '无限背景不产生地面视差，适合作为远景方向参考。'
            : '相机位于全景拍摄点附近，当前地面与接影关系较可靠。'
  }
}

export function returnDirectorCameraToPanoramaOrigin(
  cam: DirectorCam,
  environment: Partial<DirectorEnvironment> | null | undefined
): DirectorCam {
  const origin = getDirectorPanoramaCaptureOrigin(environment)
  let dx = finite(cam.target[0], 0) - finite(cam.pos[0], 0)
  let dy = finite(cam.target[1], 0) - finite(cam.pos[1], 0)
  let dz = finite(cam.target[2], -1) - finite(cam.pos[2], 0)
  const distance = Math.hypot(dx, dy, dz)
  if (distance < 1e-6) {
    dx = 0
    dy = 0
    dz = -1
  } else {
    dx /= distance
    dy /= distance
    dz /= distance
  }
  const targetDistance = Math.max(0.5, distance)
  return {
    pos: origin,
    target: [origin[0] + dx * targetDistance, origin[1] + dy * targetDistance, origin[2] + dz * targetDistance],
    focal: clamp(finite(cam.focal, 35), 1, 300)
  }
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

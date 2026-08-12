import type { DirectorEnvironment } from '../types'

export const DIRECTOR_ENVIRONMENT_DEFAULTS = {
  mode: 'grounded' as const,
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
  'mode' | 'cameraHeight' | 'horizon' | 'exposure' | 'environmentIntensity' | 'backgroundBlur' | 'shadowOpacity'
>

export function normalizeDirectorEnvironmentControls(raw: Partial<DirectorEnvironment> | null | undefined): DirectorEnvironmentControls {
  return {
    mode: raw?.mode === 'infinite' ? 'infinite' : 'grounded',
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

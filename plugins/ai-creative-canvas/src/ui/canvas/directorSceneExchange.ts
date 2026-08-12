import type {
  DirectorCam,
  DirectorEnvironment,
  DirectorScene,
  DirectorShot,
  DirectorSubject
} from '../types'
import { normalizeDirectorShotDuration } from './directorWorkflow'

export const DIRECTOR_SCENE_EXCHANGE_FORMAT = 'mulby-ai-creative-canvas/director-scene'
export const DIRECTOR_SCENE_EXCHANGE_VERSION = 1
export const DIRECTOR_SCENE_ASSET_LIMIT_BYTES = 50 * 1024 * 1024
export const DIRECTOR_SCENE_TOTAL_ASSET_LIMIT_BYTES = 80 * 1024 * 1024

export interface DirectorSceneExchangeAsset {
  id: string
  mimeType: string
  dataBase64: string
}

export interface DirectorSceneExchangeBundle {
  format: typeof DIRECTOR_SCENE_EXCHANGE_FORMAT
  version: typeof DIRECTOR_SCENE_EXCHANGE_VERSION
  exportedAt: number
  scene: DirectorScene
  assets: DirectorSceneExchangeAsset[]
}

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const text = (value: unknown, max = 240) => typeof value === 'string' ? value.trim().slice(0, max) : ''
const finite = (value: unknown, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
const tuple3 = (value: unknown, fallback: [number, number, number]): [number, number, number] => {
  if (!Array.isArray(value) || value.length < 3) return [...fallback]
  return [finite(value[0], fallback[0]), finite(value[1], fallback[1]), finite(value[2], fallback[2])]
}
const uniqueId = (preferred: unknown, prefix: string, index: number, used: Set<string>) => {
  const base = text(preferred, 120) || `${prefix}-${index + 1}`
  let candidate = base
  let suffix = 2
  while (used.has(candidate)) candidate = `${base}-${suffix++}`
  used.add(candidate)
  return candidate
}

export function encodeDirectorSceneBytes(bytes: Uint8Array): string {
  const parts: string[] = []
  const chunkBytes = 3 * 4096
  for (let chunkStart = 0; chunkStart < bytes.length; chunkStart += chunkBytes) {
    const chunkEnd = Math.min(bytes.length, chunkStart + chunkBytes)
    let output = ''
    for (let index = chunkStart; index < chunkEnd; index += 3) {
      const a = bytes[index]
      const b = index + 1 < bytes.length ? bytes[index + 1] : 0
      const c = index + 2 < bytes.length ? bytes[index + 2] : 0
      const block = (a << 16) | (b << 8) | c
      output += BASE64[(block >>> 18) & 63]
      output += BASE64[(block >>> 12) & 63]
      output += index + 1 < bytes.length ? BASE64[(block >>> 6) & 63] : '='
      output += index + 2 < bytes.length ? BASE64[block & 63] : '='
    }
    parts.push(output)
  }
  return parts.join('')
}

export function directorBase64ByteLength(value: string): number {
  const compact = value.replace(/\s+/g, '')
  if (!compact || compact.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(compact)) throw new Error('附件 Base64 格式无效')
  const padding = compact.endsWith('==') ? 2 : compact.endsWith('=') ? 1 : 0
  return compact.length / 4 * 3 - padding
}

export function decodeDirectorSceneBase64(value: string, maxBytes = DIRECTOR_SCENE_ASSET_LIMIT_BYTES): Uint8Array {
  const compact = value.replace(/\s+/g, '')
  const size = directorBase64ByteLength(compact)
  if (size > maxBytes) throw new Error(`单个附件超过 ${Math.round(maxBytes / 1024 / 1024)}MB 上限`)
  const output = new Uint8Array(size)
  let offset = 0
  for (let index = 0; index < compact.length; index += 4) {
    const a = BASE64.indexOf(compact[index])
    const b = BASE64.indexOf(compact[index + 1])
    const c = compact[index + 2] === '=' ? 0 : BASE64.indexOf(compact[index + 2])
    const d = compact[index + 3] === '=' ? 0 : BASE64.indexOf(compact[index + 3])
    const block = (a << 18) | (b << 12) | (c << 6) | d
    if (offset < size) output[offset++] = (block >>> 16) & 255
    if (offset < size) output[offset++] = (block >>> 8) & 255
    if (offset < size) output[offset++] = block & 255
  }
  return output
}

const normalizeCam = (raw: any): DirectorCam => ({
  pos: tuple3(raw?.pos, [0, 1.5, 4]),
  target: tuple3(raw?.target, [0, 1, 0]),
  focal: clamp(finite(raw?.focal, 35), 1, 300)
})

const normalizeEnvironment = (raw: any): DirectorEnvironment | null => {
  const assetId = text(raw?.assetId, 160)
  if (!assetId) return null
  return {
    assetId,
    name: text(raw?.name, 160) || undefined,
    mimeType: text(raw?.mimeType, 120) || undefined,
    description: text(raw?.description, 1000) || undefined,
    rotation: clamp(finite(raw?.rotation, 0), -180, 180),
    source: raw?.source === 'canvas' ? 'canvas' : raw?.source === 'local' ? 'local' : undefined,
    sourceCardId: text(raw?.sourceCardId, 160) || undefined
  }
}

const mediaReference = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length <= 2_000_000 ? value : undefined

export function normalizeDirectorScene(raw: any): DirectorScene {
  if (!raw || typeof raw !== 'object') throw new Error('导演场景必须是 JSON 对象')
  if (!Array.isArray(raw.subjects) || !Array.isArray(raw.shots)) throw new Error('导演场景缺少 subjects 或 shots')
  if (raw.subjects.length > 200) throw new Error('场景对象数量超过 200 个上限')
  if (raw.shots.length > 500) throw new Error('机位数量超过 500 个上限')

  const subjectIds = new Set<string>()
  const subjectAliases = new Map<string, string>()
  const subjects: DirectorSubject[] = raw.subjects.map((subject: any, index: number) => {
    const kind = text(subject?.kind, 20)
    if (!['人台', '道具', '模型'].includes(kind)) throw new Error(`第 ${index + 1} 个对象类型无效`)
    const originalId = text(subject?.id, 120)
    const id = uniqueId(originalId, 'subject', index, subjectIds)
    if (originalId && !subjectAliases.has(originalId)) subjectAliases.set(originalId, id)
    const joints: Record<string, [number, number, number]> = {}
    if (subject?.joints && typeof subject.joints === 'object') {
      for (const [name, rotation] of Object.entries(subject.joints).slice(0, 64)) {
        const jointName = text(name, 80)
        if (jointName) joints[jointName] = tuple3(rotation, [0, 0, 0])
      }
    }
    const scale = Array.isArray(subject?.scale)
      ? tuple3(subject.scale, [1, 1, 1]).map((value) => clamp(value, 0.01, 100)) as [number, number, number]
      : clamp(finite(subject?.scale, 1), 0.01, 100)
    return {
      id,
      kind,
      pos: tuple3(subject?.pos, [0, 0, 0]),
      rot: tuple3(subject?.rot, [0, 0, 0]),
      scale,
      joints: Object.keys(joints).length ? joints : undefined,
      poseName: text(subject?.poseName, 120) || undefined,
      poseSchemaVersion: finite(subject?.poseSchemaVersion, 0) || undefined,
      bodyType: text(subject?.bodyType, 40) as DirectorSubject['bodyType'] || undefined,
      poseOffsetY: finite(subject?.poseOffsetY, 0),
      assetId: text(subject?.assetId, 160) || undefined,
      name: text(subject?.name, 160) || undefined,
      desc: text(subject?.desc, 1000) || undefined,
      colorName: text(subject?.colorName, 80) || undefined,
      visible: subject?.visible !== false,
      locked: !!subject?.locked
    }
  })

  const shotIds = new Set<string>()
  const shots: DirectorShot[] = raw.shots.map((shot: any, index: number) => {
    const id = uniqueId(shot?.id, 'shot', index, shotIds)
    const targetIdRaw = text(shot?.targetSubjectId, 120)
    const targetSubjectId = subjectAliases.get(targetIdRaw) || (subjectIds.has(targetIdRaw) ? targetIdRaw : '')
    const hasBinding = !!targetSubjectId && Array.isArray(shot?.targetOffset) && Array.isArray(shot?.cameraOffset)
    const rawSceneSubjects = Array.isArray(shot?.sceneState?.subjects) ? shot.sceneState.subjects : []
    if (rawSceneSubjects.length > 200) throw new Error(`第 ${index + 1} 个机位的对象调度超过 200 个上限`)
    const sceneStateIds = new Set<string>()
    const sceneSubjects = rawSceneSubjects
      .flatMap((state: any) => {
        const stateIdRaw = text(state?.subjectId, 120)
        const subjectId = subjectAliases.get(stateIdRaw) || (subjectIds.has(stateIdRaw) ? stateIdRaw : '')
        if (!subjectId || sceneStateIds.has(subjectId)) return []
        sceneStateIds.add(subjectId)
        const joints: Record<string, [number, number, number]> = {}
        if (state?.joints && typeof state.joints === 'object') {
          for (const [name, rotation] of Object.entries(state.joints).slice(0, 64)) {
            const jointName = text(name, 80)
            if (jointName) joints[jointName] = tuple3(rotation, [0, 0, 0])
          }
        }
        const scale = Array.isArray(state?.scale)
          ? tuple3(state.scale, [1, 1, 1]).map((value) => clamp(value, 0.01, 100)) as [number, number, number]
          : clamp(finite(state?.scale, 1), 0.01, 100)
        return [{
          subjectId,
          name: text(state?.name, 160) || undefined,
          kind: text(state?.kind, 20) || undefined,
          pos: tuple3(state?.pos, [0, 0, 0]),
          rot: tuple3(state?.rot, [0, 0, 0]),
          scale,
          joints: Object.keys(joints).length ? joints : undefined,
          poseName: text(state?.poseName, 120) || undefined,
          poseSchemaVersion: finite(state?.poseSchemaVersion, 0) || undefined,
          poseOffsetY: finite(state?.poseOffsetY, 0),
          bodyType: text(state?.bodyType, 40) as DirectorSubject['bodyType'] || undefined,
          visible: state?.visible !== false
        }]
      })
    return {
      id,
      name: text(shot?.name, 160) || `机位${index + 1}`,
      cam: normalizeCam(shot?.cam),
      aspect: text(shot?.aspect, 20) || undefined,
      lighting: text(shot?.lighting, 80) || undefined,
      shotType: text(shot?.shotType, 80) || undefined,
      durationMs: normalizeDirectorShotDuration(Number.isFinite(Number(shot?.durationMs)) ? Number(shot.durationMs) : undefined),
      notes: text(shot?.notes, 2000) || undefined,
      targetSubjectId: hasBinding ? targetSubjectId : undefined,
      targetOffset: hasBinding ? tuple3(shot.targetOffset, [0, 0, 0]) : undefined,
      cameraOffset: hasBinding ? tuple3(shot.cameraOffset, [0, 0, 0]) : undefined,
      sceneState: sceneSubjects.length ? { subjects: sceneSubjects } : undefined,
      thumb: mediaReference(shot?.thumb),
      take: mediaReference(shot?.take),
      takes: Array.isArray(shot?.takes)
        ? shot.takes
            .map((item: unknown) => mediaReference(item))
            .filter((item: string | undefined): item is string => !!item)
            .slice(-6)
        : undefined
    }
  })

  return {
    schemaVersion: 2,
    subjects,
    cam: normalizeCam(raw.cam),
    shots,
    prompt: text(raw.prompt, 20_000) || undefined,
    lighting: text(raw.lighting, 80) || undefined,
    aspect: text(raw.aspect, 20) || undefined,
    environment: normalizeEnvironment(raw.environment)
  }
}

export function createDirectorSceneExchangeBundle(
  scene: DirectorScene,
  assets: DirectorSceneExchangeAsset[],
  exportedAt = Date.now()
): DirectorSceneExchangeBundle {
  let totalBytes = 0
  const assetIds = new Set<string>()
  const normalizedAssets = assets.map((asset) => {
    const id = text(asset.id, 160)
    if (!id) throw new Error('附件缺少 id')
    if (assetIds.has(id)) throw new Error(`附件 id 重复：${id}`)
    assetIds.add(id)
    if (typeof asset.dataBase64 !== 'string') throw new Error(`附件 ${id} 缺少 Base64 数据`)
    const bytes = directorBase64ByteLength(asset.dataBase64)
    if (bytes > DIRECTOR_SCENE_ASSET_LIMIT_BYTES) throw new Error(`附件 ${id} 超过 50MB 上限`)
    totalBytes += bytes
    return {
      id,
      mimeType: text(asset.mimeType, 120) || 'application/octet-stream',
      dataBase64: asset.dataBase64.replace(/\s+/g, '')
    }
  })
  if (totalBytes > DIRECTOR_SCENE_TOTAL_ASSET_LIMIT_BYTES) throw new Error('导演工程附件总量超过 80MB 上限')
  return {
    format: DIRECTOR_SCENE_EXCHANGE_FORMAT,
    version: DIRECTOR_SCENE_EXCHANGE_VERSION,
    exportedAt,
    scene: normalizeDirectorScene(scene),
    assets: normalizedAssets
  }
}

export function parseDirectorSceneExchange(raw: unknown): DirectorSceneExchangeBundle {
  const value: any = raw
  if (value?.format === DIRECTOR_SCENE_EXCHANGE_FORMAT) {
    if (value.version !== DIRECTOR_SCENE_EXCHANGE_VERSION) throw new Error(`不支持的导演工程版本：${String(value.version)}`)
    return createDirectorSceneExchangeBundle(normalizeDirectorScene(value.scene), Array.isArray(value.assets) ? value.assets : [], finite(value.exportedAt, 0))
  }
  return createDirectorSceneExchangeBundle(normalizeDirectorScene(value), [], 0)
}

export function collectDirectorSceneAssetIds(scene: DirectorScene): string[] {
  const ids = new Set<string>()
  for (const subject of scene.subjects) if (subject.assetId) ids.add(subject.assetId)
  if (scene.environment?.assetId) ids.add(scene.environment.assetId)
  return [...ids]
}

export function remapDirectorSceneAssetIds(scene: DirectorScene, idMap: ReadonlyMap<string, string>): DirectorScene {
  return {
    ...scene,
    subjects: scene.subjects.map((subject) => ({
      ...subject,
      assetId: subject.assetId ? idMap.get(subject.assetId) || subject.assetId : undefined
    })),
    environment: scene.environment
      ? { ...scene.environment, assetId: idMap.get(scene.environment.assetId) || scene.environment.assetId }
      : null
  }
}

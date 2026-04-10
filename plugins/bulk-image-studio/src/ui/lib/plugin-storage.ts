/** Mulby 插件 storage 读写（兼容同步 / Promise 返回值） */

export const STORAGE_KEYS = {
  lastDirs: 'v1:lastDirs',
  pipelinePresets: 'v1:pipelinePresets',
  pipelinePresetLastId: 'v1:pipelinePresetLastId',
} as const

export type LastDirs = {
  batchOtherDir?: string
  mergeSaveDir?: string
  cropOutDir?: string
}

export type MulbyStorageApi = {
  get: (key: string) => unknown
  set: (key: string, value: unknown) => unknown
}

async function unwrap<T>(v: unknown): Promise<T | undefined> {
  if (v != null && typeof (v as Promise<unknown>).then === 'function') {
    return (await v) as T
  }
  return v as T | undefined
}

export async function readStorageJson<T>(storage: MulbyStorageApi | undefined, key: string): Promise<T | undefined> {
  if (!storage?.get) return undefined
  try {
    const raw = await unwrap<unknown>(storage.get(key))
    if (raw == null) return undefined
    if (typeof raw === 'string') {
      try {
        return JSON.parse(raw) as T
      } catch {
        return undefined
      }
    }
    return raw as T
  } catch {
    return undefined
  }
}

export async function writeStorageJson(
  storage: MulbyStorageApi | undefined,
  key: string,
  value: unknown
): Promise<void> {
  if (!storage?.set) return
  try {
    await unwrap(storage.set(key, value))
  } catch {
    /* 忽略 */
  }
}

export async function loadLastDirs(storage: MulbyStorageApi | undefined): Promise<LastDirs> {
  const v = await readStorageJson<LastDirs>(storage, STORAGE_KEYS.lastDirs)
  return v && typeof v === 'object' ? v : {}
}

export async function saveLastDirs(storage: MulbyStorageApi | undefined, patch: Partial<LastDirs>): Promise<void> {
  const cur = await loadLastDirs(storage)
  await writeStorageJson(storage, STORAGE_KEYS.lastDirs, { ...cur, ...patch })
}

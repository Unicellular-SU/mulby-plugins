import { useCallback, useMemo, useRef, useState } from 'react'
import type {
  IpcResult,
  PluginProjectSource,
  PluginProjectStatus,
  PluginValidationResult
} from '../types'

/**
 * 宿主 developer API 契约以 docs/apis/developer.md + electron.d.ts 为准（Agent-5 维护）。
 * 新方法（addPluginProject/listPluginProjects/validatePlugin/createPlugin/buildPlugin/...）
 * 落地前，本 hook 用 mock 降级，保证 UI 可独立开发与演示；接口就绪后自动切换为真实调用。
 */
interface DeveloperApi {
  // legacy（已存在）
  selectDirectory?: () => Promise<string | null>
  addPluginPath?: (path: string) => Promise<unknown>
  removePluginPath?: (path: string) => Promise<unknown>
  reloadPlugins?: () => Promise<unknown>
  // 阶段 C 新增（契约见设计 §4.4）
  listPluginProjects?: () => Promise<PluginProjectStatus[]>
  addPluginProject?: (args: { path: string; source?: PluginProjectSource }) => Promise<IpcResult>
  removePluginProject?: (args: { id?: string; path?: string }) => Promise<IpcResult>
  reloadPlugin?: (pluginId: string) => Promise<IpcResult>
  reloadPluginByPath?: (path: string) => Promise<IpcResult>
  validatePlugin?: (path: string) => Promise<PluginValidationResult>
  createPlugin?: (args: { targetDir: string; name: string; template?: 'react' | 'basic' }) => Promise<IpcResult>
  buildPlugin?: (path: string) => Promise<IpcResult>
  packPlugin?: (path: string) => Promise<IpcResult>
  openPluginDir?: (path: string) => Promise<IpcResult>
  updateProjectMeta?: (args: { id: string; lastOpenedAt?: number; label?: string }) => Promise<IpcResult>
}

/** 本插件 ID，host.call 路由时需要 */
export const DEVELOPER_PLUGIN_ID = 'mulby-developer-tools'

function getApi(): DeveloperApi | undefined {
  return (window as any)?.mulby?.developer
}

export function isApiReady(): boolean {
  const api = getApi()
  return !!(api && typeof api.listPluginProjects === 'function')
}

export interface EnsureLoadedResult {
  success: boolean
  id?: string
  loaded: boolean
  error?: string
}

// ---- mock 数据（接口未就绪时演示用） ----
let mockProjects: PluginProjectStatus[] = [
  {
    projectId: 'mock-1',
    path: '/Users/dev/plugins/awesome-clipboard',
    type: 'single',
    source: 'created',
    label: '智能剪贴板',
    exists: true,
    plugins: [
      {
        id: 'awesome-clipboard', displayName: '智能剪贴板', path: '/Users/dev/plugins/awesome-clipboard',
        manifestValid: true, manifestErrors: [], mainEntryFound: true, built: true,
        loaded: true, enabled: true, isDev: true
      }
    ]
  },
  {
    projectId: 'mock-2',
    path: '/Users/dev/workspace/my-plugins',
    type: 'collection',
    source: 'added',
    exists: true,
    plugins: [
      {
        id: 'note-quick', displayName: '速记', path: '/Users/dev/workspace/my-plugins/note-quick',
        manifestValid: true, manifestErrors: [], mainEntryFound: true, built: true,
        loaded: true, enabled: true, isDev: true
      },
      {
        id: 'json-fmt', displayName: 'JSON 工具', path: '/Users/dev/workspace/my-plugins/json-fmt',
        manifestValid: false, manifestErrors: ['缺少必填字段：features'], mainEntryFound: false, built: false,
        loaded: false, enabled: false, isDev: true, idConflictWith: undefined
      }
    ]
  },
  {
    projectId: 'mock-3',
    path: '/Users/dev/plugins/legacy-tool',
    type: 'single',
    source: 'imported',
    exists: true,
    plugins: [
      {
        id: 'legacy-tool', displayName: '旧版工具', path: '/Users/dev/plugins/legacy-tool',
        manifestValid: true, manifestErrors: [], mainEntryFound: true, built: false,
        loaded: false, enabled: false, isDev: true, idConflictWith: '/Applications/Mulby/plugins/legacy-tool'
      }
    ]
  }
]

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

export interface UseDeveloperResult {
  apiReady: boolean
  loading: boolean
  error: string | null
  clearError: () => void
  listPluginProjects: () => Promise<PluginProjectStatus[]>
  selectDirectory: () => Promise<string | null>
  addPluginProject: (path: string, source?: PluginProjectSource) => Promise<IpcResult>
  removePluginProject: (idOrPath: { id?: string; path?: string }) => Promise<IpcResult>
  reloadPlugin: (pluginId: string) => Promise<IpcResult>
  reloadPluginByPath: (path: string) => Promise<IpcResult>
  validatePlugin: (path: string) => Promise<PluginValidationResult>
  createPlugin: (targetDir: string, name: string, template: 'react' | 'basic') => Promise<IpcResult>
  buildPlugin: (path: string) => Promise<IpcResult>
  packPlugin: (path: string) => Promise<IpcResult>
  openPluginDir: (path: string) => Promise<IpcResult>
  /** 构建后稳定载入：validate → reloadPlugin(id) → 回退 reloadPluginByPath */
  ensureLoaded: (path: string) => Promise<EnsureLoadedResult>
  /** 调用本插件后端 host 方法（如 vibe_begin），同时预热 host 进程 */
  hostCall: <T = unknown>(method: string, args?: unknown) => Promise<T>
}

export function useDeveloper(): UseDeveloperResult {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pending = useRef(0)

  const wrap = useCallback(async <T>(fn: () => Promise<T>): Promise<T> => {
    pending.current += 1
    setLoading(true)
    setError(null)
    try {
      return await fn()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
      throw e
    } finally {
      pending.current -= 1
      if (pending.current <= 0) {
        pending.current = 0
        setLoading(false)
      }
    }
  }, [])

  const clearError = useCallback(() => setError(null), [])

  const listPluginProjects = useCallback(() => wrap(async () => {
    const api = getApi()
    if (api?.listPluginProjects) return await api.listPluginProjects()
    await delay(420)
    return mockProjects.map((p) => ({ ...p, plugins: [...p.plugins] }))
  }), [wrap])

  const selectDirectory = useCallback(() => wrap(async () => {
    const api = getApi()
    if (api?.selectDirectory) return (await api.selectDirectory()) ?? null
    await delay(200)
    return '/Users/dev/plugins/new-project-' + Math.random().toString(36).slice(2, 6)
  }), [wrap])

  const addPluginProject = useCallback((path: string, source: PluginProjectSource = 'added') => wrap(async () => {
    const api = getApi()
    if (api?.addPluginProject) return await api.addPluginProject({ path, source })
    await delay(360)
    const id = 'mock-' + Date.now()
    mockProjects = [...mockProjects, {
      projectId: id, path, type: 'single', source, exists: true,
      plugins: [{
        id: path.split('/').pop() || 'plugin', displayName: path.split('/').pop() || '插件', path,
        manifestValid: true, manifestErrors: [], mainEntryFound: true, built: false,
        loaded: false, enabled: false, isDev: true
      }]
    }]
    return { success: true, project: { id, path } }
  }), [wrap])

  const removePluginProject = useCallback((idOrPath: { id?: string; path?: string }) => wrap(async () => {
    const api = getApi()
    if (api?.removePluginProject) return await api.removePluginProject(idOrPath)
    await delay(260)
    mockProjects = mockProjects.filter((p) =>
      idOrPath.id ? p.projectId !== idOrPath.id : p.path !== idOrPath.path)
    return { success: true }
  }), [wrap])

  const reloadPlugin = useCallback((pluginId: string) => wrap(async () => {
    const api = getApi()
    if (api?.reloadPlugin) return await api.reloadPlugin(pluginId)
    await delay(420)
    return { success: true }
  }), [wrap])

  const reloadPluginByPath = useCallback((path: string) => wrap(async () => {
    const api = getApi()
    if (api?.reloadPluginByPath) return await api.reloadPluginByPath(path)
    await delay(420)
    return { success: true }
  }), [wrap])

  const validatePlugin = useCallback((path: string) => wrap(async () => {
    const api = getApi()
    if (api?.validatePlugin) return await api.validatePlugin(path)
    await delay(320)
    return {
      valid: true, errors: [], built: true, mainEntryFound: true,
      manifest: { id: path.split('/').pop(), displayName: path.split('/').pop(), version: '1.0.0' }
    } as PluginValidationResult
  }), [wrap])

  const createPlugin = useCallback((targetDir: string, name: string, template: 'react' | 'basic') => wrap(async () => {
    const api = getApi()
    if (api?.createPlugin) return await api.createPlugin({ targetDir, name, template })
    await delay(900)
    const path = `${targetDir}/${name}`
    return { success: true, path, log: `[mock] mulby-cli create ${name} --template ${template}\n✔ 脚手架生成于 ${path}` }
  }), [wrap])

  const buildPlugin = useCallback((path: string) => wrap(async () => {
    const api = getApi()
    if (api?.buildPlugin) return await api.buildPlugin(path)
    await delay(1100)
    return { success: true, log: `[mock] npm run build (cwd=${path})\n> esbuild ...\n> vite build ...\n✔ 构建成功：dist/main.js + ui/index.html` }
  }), [wrap])

  const packPlugin = useCallback((path: string) => wrap(async () => {
    const api = getApi()
    if (api?.packPlugin) return await api.packPlugin(path)
    await delay(900)
    return { success: true, outFile: `${path}.inplugin`, log: `[mock] mulby pack (cwd=${path})\n✔ 已打包：${path.split('/').pop()}.inplugin` }
  }), [wrap])

  const openPluginDir = useCallback((path: string) => wrap(async () => {
    const api = getApi()
    if (api?.openPluginDir) return await api.openPluginDir(path)
    await delay(120)
    return { success: true }
  }), [wrap])

  // 构建后稳定载入：先按 manifest.id 局部重载，失败再按目录路径载入（注册+载入一步到位）。
  // 解决「首次构建时插件尚未注册 → reloadPlugin(id) 失败」导致构建后未自动载入的问题。
  const ensureLoaded = useCallback((path: string) => wrap(async (): Promise<EnsureLoadedResult> => {
    const api = getApi()
    let id: string | undefined
    try {
      const v = api?.validatePlugin ? await api.validatePlugin(path) : undefined
      id = v?.manifest?.id
    } catch {
      // 校验失败不阻断载入尝试
    }
    if (id && api?.reloadPlugin) {
      try {
        const r = await api.reloadPlugin(id)
        if (r?.success) return { success: true, id, loaded: true }
      } catch {
        // 落到按路径载入
      }
    }
    if (api?.reloadPluginByPath) {
      const r = await api.reloadPluginByPath(path)
      return { success: !!r?.success, id, loaded: !!r?.success, error: r?.error }
    }
    await delay(300)
    return { success: true, id, loaded: true }
  }), [wrap])

  const hostCall = useCallback(<T = unknown>(method: string, args?: unknown) => wrap(async () => {
    const host = (window as any)?.mulby?.host
    if (!host?.call) {
      throw new Error('当前环境不支持 host.call（需在 Mulby 中运行）')
    }
    // 宿主 host.call 统一返回 { success, data } 信封（见 host-worker handleCallHostMethod），
    // 这里解包到业务数据，使消费方可直接读取字段（r.ok / r.errors / r.issues / r.changes …）。
    // 与其他插件约定一致（todo-focus 的 unwrapHostResult、video-subtitle-studio 的 unwrapHostData）。
    const res = await host.call(DEVELOPER_PLUGIN_ID, method, args)
    if (res !== null && typeof res === 'object' && 'data' in (res as Record<string, unknown>)) {
      return (res as { data: T }).data
    }
    return res as T
  }), [wrap])

  const apiReady = isApiReady()

  // 关键：返回稳定（memoized）的对象。
  // 所有 action 均为 useCallback（依赖恒定的 wrap），因此对象引用仅在
  // loading/error/apiReady 变化时更新。这避免了"每次渲染都返回新对象"
  // 导致消费组件 useEffect/useCallback 依赖失效、进而无限重渲染与重复拉取的问题。
  return useMemo<UseDeveloperResult>(() => ({
    apiReady,
    loading,
    error,
    clearError,
    listPluginProjects,
    selectDirectory,
    addPluginProject,
    removePluginProject,
    reloadPlugin,
    reloadPluginByPath,
    validatePlugin,
    createPlugin,
    buildPlugin,
    packPlugin,
    openPluginDir,
    ensureLoaded,
    hostCall
  }), [
    apiReady,
    loading,
    error,
    clearError,
    listPluginProjects,
    selectDirectory,
    addPluginProject,
    removePluginProject,
    reloadPlugin,
    reloadPluginByPath,
    validatePlugin,
    createPlugin,
    buildPlugin,
    packPlugin,
    openPluginDir,
    ensureLoaded,
    hostCall
  ])
}

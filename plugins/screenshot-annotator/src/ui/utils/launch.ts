// 启动参数解析：兼容 search / hash / route 三种查询位置（从 App.tsx 搬移，保持原样）。

import type { AppMode, PluginInitData } from '../annotations/types'

function appendSearchParams(params: URLSearchParams, search: string) {
  const query = search.startsWith('?') ? search.slice(1) : search
  if (!query) {
    return
  }

  new URLSearchParams(query).forEach((value, key) => {
    params.set(key, value)
  })
}

function collectLaunchParams(route?: string) {
  const params = new URLSearchParams()
  appendSearchParams(params, window.location.search)

  const hashQueryIndex = window.location.hash.indexOf('?')
  if (hashQueryIndex >= 0) {
    appendSearchParams(params, window.location.hash.slice(hashQueryIndex + 1))
  }

  if (route) {
    const routeQueryIndex = route.indexOf('?')
    if (routeQueryIndex >= 0) {
      appendSearchParams(params, route.slice(routeQueryIndex + 1))
    } else if (route.startsWith('?')) {
      appendSearchParams(params, route.slice(1))
    }
  }

  return params
}

export function parseLaunchMode(data?: Pick<PluginInitData, 'featureCode' | 'route'>): {
  mode: AppMode
  historyItemId?: string
} {
  const params = collectLaunchParams(data?.route)
  const route = data?.route ?? ''
  const modeParam = params.get('mode')
  const historyItemId = params.get('historyItemId') ?? undefined

  if (historyItemId) {
    return { mode: 'annotate', historyItemId }
  }

  if (
    data?.featureCode === 'history' ||
    modeParam === 'history' ||
    route === 'history' ||
    route.endsWith('/history')
  ) {
    return { mode: 'history' }
  }

  return { mode: 'annotate' }
}

export function getInitialMode(): AppMode {
  return parseLaunchMode().mode
}

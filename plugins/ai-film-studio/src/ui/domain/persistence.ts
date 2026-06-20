/**
 * Toonflow 式重构 · 阶段2：项目持久化（host storage KV，命名空间 studio:*）。
 *
 * - studio:index            轻量卡片数组 ProjectCard[]（主页/切换器读它）
 * - studio:project:<id>     完整项目文档 ProjectDoc（懒加载）
 * - studio:current          当前项目 id
 *
 * 不考虑老节点图数据兼容（独立命名空间）。资产二进制仍走现有资产库（assetStore/saveAsset）。
 */
import type { ProjectCard, ProjectDoc, ProjectMeta } from './types'

const PLUGIN_ID = 'ai-film-studio'
const INDEX_KEY = 'studio:index'
const CURRENT_KEY = 'studio:current'
const projectKey = (id: string) => `studio:project:${id}`

async function kvGet<T>(key: string): Promise<T | null> {
  try {
    const v = await window.mulby?.storage?.get(key, PLUGIN_ID)
    return (v as T) ?? null
  } catch {
    return null
  }
}
async function kvSet(key: string, value: unknown): Promise<void> {
  try {
    await window.mulby?.storage?.set(key, value, PLUGIN_ID)
  } catch {
    // 忽略（浏览器调试态无 storage）
  }
}
async function kvRemove(key: string): Promise<void> {
  try {
    await window.mulby?.storage?.remove(key, PLUGIN_ID)
  } catch {
    // 忽略
  }
}

/** 生成短 id（无第三方依赖；时间戳由调用方传入以保证纯函数处可控） */
export function newId(prefix = ''): string {
  const rand = Math.random().toString(36).slice(2, 8)
  return `${prefix}${Date.now().toString(36)}${rand}`
}

export function docToCard(doc: ProjectDoc): ProjectCard {
  return {
    id: doc.meta.id,
    name: doc.meta.name,
    artStyle: doc.meta.artStyle,
    videoRatio: doc.meta.videoRatio,
    updatedAt: doc.meta.updatedAt,
    coverImageId: doc.storyboards.find((s) => s.keyframeImageId)?.keyframeImageId,
    storyboardCount: doc.storyboards.length,
  }
}

/** 空项目文档 */
export function emptyProjectDoc(meta: Pick<ProjectMeta, 'name'> & Partial<ProjectMeta>): ProjectDoc {
  const now = Date.now()
  return {
    meta: {
      id: meta.id ?? newId('p_'),
      name: meta.name,
      intro: meta.intro,
      genre: meta.genre,
      artStyle: meta.artStyle ?? 'cinematic_realistic',
      videoRatio: meta.videoRatio ?? '16:9',
      imageModel: meta.imageModel,
      videoModel: meta.videoModel,
      videoMode: meta.videoMode,
      dialogueLang: meta.dialogueLang ?? '中文',
      directorManual: meta.directorManual,
      createdAt: meta.createdAt ?? now,
      updatedAt: now,
    },
    novel: [],
    events: [],
    scripts: [],
    assets: [],
    storyboards: [],
    clips: [],
    track: [],
    memory: [],
  }
}

export async function loadIndex(): Promise<ProjectCard[]> {
  return (await kvGet<ProjectCard[]>(INDEX_KEY)) ?? []
}

async function saveIndex(cards: ProjectCard[]): Promise<void> {
  await kvSet(INDEX_KEY, cards)
}

export async function loadProject(id: string): Promise<ProjectDoc | null> {
  return kvGet<ProjectDoc>(projectKey(id))
}

/** 保存项目（更新 updatedAt + index 卡片，原子性靠 KV 自身） */
export async function saveProject(doc: ProjectDoc): Promise<void> {
  doc.meta.updatedAt = Date.now()
  await kvSet(projectKey(doc.meta.id), doc)
  const index = await loadIndex()
  const card = docToCard(doc)
  const i = index.findIndex((c) => c.id === doc.meta.id)
  if (i >= 0) index[i] = card
  else index.unshift(card)
  index.sort((a, b) => b.updatedAt - a.updatedAt)
  await saveIndex(index)
}

export async function deleteProject(id: string): Promise<void> {
  await kvRemove(projectKey(id))
  await saveIndex((await loadIndex()).filter((c) => c.id !== id))
  if ((await getCurrentId()) === id) await setCurrentId(null)
}

export async function getCurrentId(): Promise<string | null> {
  return kvGet<string>(CURRENT_KEY)
}
export async function setCurrentId(id: string | null): Promise<void> {
  if (id) await kvSet(CURRENT_KEY, id)
  else await kvRemove(CURRENT_KEY)
}

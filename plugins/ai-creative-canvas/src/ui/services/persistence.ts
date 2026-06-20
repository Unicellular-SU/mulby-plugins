import type { ProjectDoc } from '../types'

export const PLUGIN_ID = 'ai-creative-canvas'
const KEY_CURRENT = 'project:current'

function storage() {
  return (window as any).mulby?.storage
}

export async function loadProject(): Promise<ProjectDoc | null> {
  try {
    const v = await storage()?.get(KEY_CURRENT, PLUGIN_ID)
    if (v && typeof v === 'object' && Array.isArray((v as ProjectDoc).boards)) return v as ProjectDoc
    return null
  } catch {
    return null
  }
}

export async function saveProject(p: ProjectDoc): Promise<boolean> {
  try {
    await storage()?.set(KEY_CURRENT, p, PLUGIN_ID)
    return true
  } catch {
    return false
  }
}

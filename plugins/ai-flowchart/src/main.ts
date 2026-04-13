/// <reference path="./types/mulby.d.ts" />
// 插件后端入口：项目存储与文件导出（AI 调用已移至前端避免 IPC 超时）

declare const mulby: any;

type PluginContext = BackendPluginContext

// ============ 数据类型 ============

interface ProjectData {
  id: string
  name: string
  data: unknown
  updatedAt: number
}

// ============ 生命周期 ============

export function onLoad() {
  console.log('[ai-flowchart] loaded')
}

export function onUnload() {
  console.log('[ai-flowchart] unloaded')
}

export function onEnable() {
  console.log('[ai-flowchart] enabled')
}

export function onDisable() {
  console.log('[ai-flowchart] disabled')
}

export async function run(context: PluginContext) {
  if (context.featureCode === 'open-project') {
    mulby.notification.show('已打开流程图项目')
    return
  }

  if (context.featureCode === 'from-text') {
    mulby.notification.show('正在从选中文字生成流程图...')
    return
  }

  mulby.notification.show('AI 流程图已启动')
}

// ============ Host 方法（仅保留非 AI 的存储/导出操作） ============

export const rpc = {
  // 保存项目
  async saveProject(input: { project: ProjectData }) {
    const { storage } = mulby
    console.log('[ai-flowchart][backend] saveProject called, id:', input.project.id, 'name:', input.project.name)
    const projects = ((await storage.get('projects')) || {}) as Record<string, ProjectData>
    console.log('[ai-flowchart][backend] existing project count:', Object.keys(projects).length)
    projects[input.project.id] = input.project
    await storage.set('projects', projects)
    console.log('[ai-flowchart][backend] saved, new project count:', Object.keys(projects).length)
    return { success: true }
  },

  // 列出所有项目
  async listProjects() {
    const { storage } = mulby
    const projects = (await storage.get('projects')) || {}
    console.log('[ai-flowchart][backend] listProjects, count:', Object.keys(projects as any).length, 'ids:', Object.keys(projects as any))
    return projects
  },

  // 删除项目
  async deleteProject(input: { id: string }) {
    const { storage } = mulby
    console.log('[ai-flowchart][backend] deleteProject called, id:', input.id)
    const projects = ((await storage.get('projects')) || {}) as Record<string, ProjectData>
    console.log('[ai-flowchart][backend] before delete, ids:', Object.keys(projects))
    delete projects[input.id]
    await storage.set('projects', projects)
    console.log('[ai-flowchart][backend] after delete, ids:', Object.keys(projects))
    return { success: true }
  },

  // 导出数据到文件
  async exportToFile(input: { filePath: string; data: string; encoding?: string }) {
    const { filesystem } = mulby
    await filesystem.writeFile(input.filePath, input.data, (input.encoding || 'utf-8') as 'utf-8' | 'base64')
    return { success: true }
  }
}

const plugin = { onLoad, onUnload, onEnable, onDisable, run }
export default plugin

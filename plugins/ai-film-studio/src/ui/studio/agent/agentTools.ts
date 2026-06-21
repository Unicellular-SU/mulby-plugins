/**
 * Toonflow 式重构 · 阶段6（§6.1）：Agent 工具集——把 projectStore 动作暴露为可被工具循环调用的 AgentTool。
 * 同进程直调 store（替代 Toonflow 的 socket.emit）。get 为 projectStore 的 getState（type-only 引入，无运行期循环）。
 */
import type { AgentTool } from './runtime'
import type { ProjectState } from '../../store/projectStore'

export function makeAgentTools(get: () => ProjectState): AgentTool[] {
  const doc = () => get().doc
  return [
    {
      name: 'get_workspace',
      description: '读取当前工作区概览（剧本/资产/分镜）',
      parameters: { type: 'object', properties: {} },
      execute: async () => {
        const d = doc()
        if (!d) return '无打开的项目'
        const assets = d.assets.filter((a) => !a.parentAssetId).map((a) => `${a.name}(${a.type})`).join('、') || '无'
        const sbs = [...d.storyboards].sort((a, b) => a.index - b.index).map((s, i) => `${i + 1}. ${s.videoDesc.slice(0, 50)}`).join('\n') || '无'
        return `剧本：${d.scripts[0]?.content?.slice(0, 500) || '无'}\n资产：${assets}\n分镜：\n${sbs}`
      },
    },
    {
      name: 'upsert_script',
      description: '写入或更新剧本',
      parameters: { type: 'object', properties: { name: { type: 'string' }, content: { type: 'string', description: '剧本正文' } }, required: ['content'] },
      execute: async (a) => {
        get().upsertScript({ name: typeof a.name === 'string' ? a.name : undefined, content: String(a.content ?? '') })
        return '剧本已更新'
      },
    },
    {
      name: 'add_asset',
      description: '新增资产：人物 role / 场景 scene / 物品 prop',
      parameters: {
        type: 'object',
        properties: { type: { type: 'string', enum: ['role', 'scene', 'prop'] }, name: { type: 'string' }, desc: { type: 'string' }, prompt: { type: 'string' } },
        required: ['type', 'name'],
      },
      execute: async (a) => {
        const type = a.type === 'scene' || a.type === 'prop' ? a.type : 'role'
        const id = get().upsertAsset({ type, name: String(a.name ?? '未命名'), desc: a.desc as string | undefined, prompt: a.prompt as string | undefined })
        return `已新增资产 ${a.name}（id ${id}）`
      },
    },
    {
      name: 'add_storyboard',
      description: '新增分镜面板（cast 用资产名，会自动关联 id）',
      parameters: {
        type: 'object',
        properties: {
          videoDesc: { type: 'string' },
          prompt: { type: 'string' },
          duration: { type: 'number' },
          cast: { type: 'array', items: { type: 'string' } },
          chainFromPrev: { type: 'boolean' },
        },
        required: ['videoDesc'],
      },
      execute: async (a) => {
        const d = doc()
        if (!d) return '无项目'
        const names = Array.isArray(a.cast) ? (a.cast as unknown[]).map(String) : []
        const ids = names.map((n) => d.assets.find((x) => x.name === n)?.id).filter((x): x is string => !!x)
        get().upsertStoryboard({
          videoDesc: String(a.videoDesc ?? ''),
          prompt: a.prompt as string | undefined,
          duration: typeof a.duration === 'number' ? a.duration : undefined,
          associateAssetIds: ids,
          chainFromPrev: a.chainFromPrev === true,
        })
        return '已新增分镜'
      },
    },
    {
      name: 'generate_asset',
      description: '按名称生成资产参考图',
      parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
      execute: async (a) => {
        const as = doc()?.assets.find((x) => x.name === a.name)
        if (!as) return `未找到资产 ${a.name}`
        await get().generateAsset(as.id)
        return `已生成资产 ${a.name}`
      },
    },
    {
      name: 'generate_keyframe',
      description: '按分镜序号(1-based)生成关键帧',
      parameters: { type: 'object', properties: { index: { type: 'number' } }, required: ['index'] },
      execute: async (a) => {
        const d = doc()
        if (!d) return '无项目'
        const sb = [...d.storyboards].sort((x, y) => x.index - y.index)[Number(a.index) - 1]
        if (!sb) return '分镜序号越界'
        await get().generateKeyframe(sb.id)
        return `已生成第 ${a.index} 镜关键帧`
      },
    },
    {
      name: 'generate_clip',
      description: '按分镜序号(1-based)生成视频片段',
      parameters: { type: 'object', properties: { index: { type: 'number' } }, required: ['index'] },
      execute: async (a) => {
        const d = doc()
        if (!d) return '无项目'
        const sb = [...d.storyboards].sort((x, y) => x.index - y.index)[Number(a.index) - 1]
        if (!sb) return '分镜序号越界'
        await get().generateClip(sb.id)
        return `已生成第 ${a.index} 镜视频`
      },
    },
  ]
}

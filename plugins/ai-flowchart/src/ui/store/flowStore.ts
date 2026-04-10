import { create } from 'zustand'
import type { Node, Edge, OnNodesChange, OnEdgesChange, OnConnect } from '@xyflow/react'
import { applyNodeChanges, applyEdgeChanges, addEdge } from '@xyflow/react'

// 图表类型
export type DiagramType = 'flowchart' | 'swimlane' | 'er'

// 消息类型
export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  reasoning?: string
  toolCalls?: ToolCallInfo[]
  timestamp: number
}

// 工具调用信息
export interface ToolCallInfo {
  name: string
  args?: string
  result?: string
}

// 流程图元数据
export interface FlowMetadata {
  title: string
  description: string
}

// 项目数据
export interface ProjectData {
  id: string
  name: string
  data: {
    nodes: Node[]
    edges: Edge[]
    metadata: FlowMetadata
  }
  updatedAt: number
}

interface FlowState {
  // 画布数据
  nodes: Node[]
  edges: Edge[]
  metadata: FlowMetadata

  // 图表类型
  diagramType: DiagramType

  // 对话数据
  messages: ChatMessage[]
  sessionId: string

  // UI 状态
  isGenerating: boolean
  isChatCollapsed: boolean
  projectId: string | null
  projectName: string
  selectedModel: string | null
  isDirty: boolean

  // 项目列表触发器
  projectListVersion: number

  // 流式输出状态
  streamingText: string
  streamingReasoning: string
  streamingToolCalls: ToolCallInfo[]

  // 历史（撤销/重做）
  history: { nodes: Node[]; edges: Edge[] }[]
  historyIndex: number

  // 画布操作
  onNodesChange: OnNodesChange
  onEdgesChange: OnEdgesChange
  onConnect: OnConnect
  setNodes: (nodes: Node[]) => void
  setEdges: (edges: Edge[]) => void
  setMetadata: (metadata: FlowMetadata) => void

  // 手动编辑（带历史记录）
  onNodeDragStart: () => void
  deleteSelectedNodes: () => void
  updateNodeLabel: (nodeId: string, label: string) => void

  // 对话操作
  addMessage: (message: ChatMessage) => void
  clearMessages: () => void
  setIsGenerating: (v: boolean) => void

  // UI 操作
  toggleChat: () => void
  setProjectInfo: (id: string | null, name: string) => void
  setSelectedModel: (model: string | null) => void
  setDiagramType: (type: DiagramType) => void
  resetSession: (keepDiagramType?: boolean) => void
  bumpProjectListVersion: () => void
  markDirty: () => void
  markClean: () => void

  // 流式操作
  appendStreamingText: (text: string) => void
  appendStreamingReasoning: (text: string) => void
  addStreamingToolCall: (tc: ToolCallInfo) => void
  updateLastToolCallResult: (result: string) => void
  resetStreaming: () => void

  // 历史操作
  pushHistory: () => void
  undo: () => void
  redo: () => void

  // 导入导出
  importFlowData: (data: { nodes: Node[]; edges: Edge[]; metadata?: FlowMetadata }) => void
  exportFlowData: () => { nodes: Node[]; edges: Edge[]; metadata: FlowMetadata }
}

// 生成唯一 session ID
function generateSessionId() {
  return `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

// 深拷贝快照
function snapshot(nodes: Node[], edges: Edge[]) {
  return {
    nodes: JSON.parse(JSON.stringify(nodes)),
    edges: JSON.parse(JSON.stringify(edges)),
  }
}

export const useFlowStore = create<FlowState>((set, get) => ({
  // 初始状态
  nodes: [],
  edges: [],
  metadata: { title: '', description: '' },
  diagramType: 'flowchart',
  messages: [],
  sessionId: generateSessionId(),
  isGenerating: false,
  isChatCollapsed: false,
  projectId: null,
  projectName: '未命名流程图',
  selectedModel: null,
  isDirty: false,
  projectListVersion: 0,
  streamingText: '',
  streamingReasoning: '',
  streamingToolCalls: [],
  history: [],
  historyIndex: -1,

  // ============ 画布变更（React Flow 回调） ============

  onNodesChange: (changes) => {
    set({ nodes: applyNodeChanges(changes, get().nodes) })
  },

  onEdgesChange: (changes) => {
    // 删除边时记录历史
    const hasRemove = changes.some((c) => c.type === 'remove')
    if (hasRemove) get().pushHistory()
    set({ edges: applyEdgeChanges(changes, get().edges) })
  },

  onConnect: (connection) => {
    get().pushHistory()
    set({ edges: addEdge({ ...connection, type: 'smart' }, get().edges) })
  },

  // 拖拽开始时记录历史快照（保存移动前状态）
  onNodeDragStart: () => {
    get().pushHistory()
  },

  setNodes: (nodes) => set({ nodes, isDirty: true }),
  setEdges: (edges) => set({ edges, isDirty: true }),
  setMetadata: (metadata) => set({ metadata, isDirty: true }),

  // ============ 对话 ============

  addMessage: (message) => set((s) => ({ messages: [...s.messages, message] })),
  clearMessages: () => set({ messages: [] }),
  setIsGenerating: (v) => set({ isGenerating: v }),

  // ============ UI ============

  toggleChat: () => set((s) => ({ isChatCollapsed: !s.isChatCollapsed })),
  setProjectInfo: (id, name) => set({ projectId: id, projectName: name }),
  setSelectedModel: (model) => set({ selectedModel: model }),
  setDiagramType: (type) => set({ diagramType: type }),
  bumpProjectListVersion: () => set((s) => ({ projectListVersion: s.projectListVersion + 1 })),
  markDirty: () => set({ isDirty: true }),
  markClean: () => set({ isDirty: false }),

  // 流式操作
  appendStreamingText: (text) =>
    set((s) => ({ streamingText: s.streamingText + text })),
  appendStreamingReasoning: (text) =>
    set((s) => ({ streamingReasoning: s.streamingReasoning + text })),
  addStreamingToolCall: (tc) =>
    set((s) => ({ streamingToolCalls: [...s.streamingToolCalls, tc] })),
  updateLastToolCallResult: (result) =>
    set((s) => {
      const calls = [...s.streamingToolCalls]
      if (calls.length > 0) calls[calls.length - 1].result = result
      return { streamingToolCalls: calls }
    }),
  resetStreaming: () =>
    set({ streamingText: '', streamingReasoning: '', streamingToolCalls: [] }),

  resetSession: (keepDiagramType?: boolean) =>
    set((s) => ({
      nodes: [],
      edges: [],
      metadata: { title: '', description: '' },
      diagramType: keepDiagramType ? s.diagramType : 'flowchart',
      messages: [],
      sessionId: generateSessionId(),
      isGenerating: false,
      projectId: null,
      projectName: '未命名流程图',
      isDirty: false,
      history: [],
      historyIndex: -1,
    })),

  // ============ 历史管理 ============

  pushHistory: () =>
    set((s) => {
      const newHistory = s.history.slice(0, s.historyIndex + 1)
      newHistory.push(snapshot(s.nodes, s.edges))
      // 最多保留 50 步
      if (newHistory.length > 50) newHistory.shift()
      return { history: newHistory, historyIndex: newHistory.length - 1 }
    }),

  undo: () =>
    set((s) => {
      if (s.historyIndex < 0) return s
      // 如果当前在最新位置，先保存当前状态
      if (s.historyIndex === s.history.length - 1) {
        const newHistory = [...s.history, snapshot(s.nodes, s.edges)]
        const idx = newHistory.length - 2
        const snap = newHistory[idx]
        return { history: newHistory, nodes: snap.nodes, edges: snap.edges, historyIndex: idx }
      }
      if (s.historyIndex <= 0) return s
      const idx = s.historyIndex - 1
      const snap = s.history[idx]
      return { nodes: snap.nodes, edges: snap.edges, historyIndex: idx }
    }),

  redo: () =>
    set((s) => {
      if (s.historyIndex >= s.history.length - 1) return s
      const idx = s.historyIndex + 1
      const snap = s.history[idx]
      return { nodes: snap.nodes, edges: snap.edges, historyIndex: idx }
    }),

  // ============ 编辑操作（带历史） ============

  updateNodeLabel: (nodeId, label) => {
    get().pushHistory()
    set((s) => ({
      nodes: s.nodes.map((n) =>
        n.id === nodeId ? { ...n, data: { ...n.data, label } } : n
      ),
    }))
  },

  deleteSelectedNodes: () => {
    const s = get()
    const selectedIds = new Set(s.nodes.filter((n) => n.selected).map((n) => n.id))
    if (selectedIds.size === 0) return
    get().pushHistory()
    set({
      nodes: s.nodes.filter((n) => !selectedIds.has(n.id)),
      edges: s.edges.filter(
        (e) => !selectedIds.has(e.source) && !selectedIds.has(e.target)
      ),
    })
  },

  // ============ 导入导出 ============

  importFlowData: (data) => {
    get().pushHistory()
    set({
      nodes: data.nodes || [],
      edges: data.edges || [],
      metadata: data.metadata || { title: '导入的图表', description: '' },
      diagramType: (data as any).diagramType || 'flowchart',
      // 重置 session 让 AI 可以接管编辑
      sessionId: generateSessionId(),
      messages: [
        {
          id: `msg_${Date.now()}_sys`,
          role: 'assistant' as const,
          content: '已导入图表，你可以继续用自然语言描述修改需求。',
          timestamp: Date.now(),
        },
      ],
    })
  },

  exportFlowData: () => {
    const { nodes, edges, metadata, diagramType } = get()
    return { nodes, edges, metadata, diagramType }
  },
}))

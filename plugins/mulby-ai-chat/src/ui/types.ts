// ── 类型定义 ──────────────────────────────────────────────

export interface AiAttachmentRef {
  attachmentId: string;
  mimeType: string;
  size: number;
  filename?: string;
}

// 工具/Skill/MCP 调用记录
export interface ToolCallEvent {
  id: string;
  name: string;
  args?: any;
  result?: any;
  status: 'calling' | 'done' | 'error' | 'cancelled';
  /** 工具调用发起时已累积的正文文本（正文阶段，用于交叉渲染） */
  textBefore?: string;
  /** 是否在推理阶段调用 */
  inReasoning?: boolean;
  /** 工具调用发起时已累积的推理文本（推理阶段，用于在推理块内交叉渲染） */
  reasoningBefore?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  reasoning_content?: string;    // 推理模型思考内容
  attachments?: AiAttachmentRef[];
  attachmentPreviews?: string[]; // base64 预览
  isStreaming?: boolean;
  isReasoning?: boolean;         // 正在流式输出推理
  error?: string;
  createdAt: number;
  translation?: string;          // 翻译结果
  translating?: boolean;         // 正在翻译中
  usage?: {                      // Token 用量（对应 Mulby AiTokenBreakdown）
    inputTokens?: number;
    outputTokens?: number;
  };
  toolCalls?: ToolCallEvent[];   // 工具/Skill/MCP 调用列表
}

export interface Session {
  id: string;
  title: string;
  messages: ChatMessage[];
  model: string;
  createdAt: number;
  updatedAt: number;
}

export interface SessionSummary {
  id: string;
  title: string;
  model: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  segmentCount: number;
}

export interface SessionMeta extends SessionSummary {}

export interface SegmentRecord {
  sessionId: string;
  segmentIndex: number;
  messages: ChatMessage[];
}

export interface AiModel {
  id: string;
  label: string;
  providerLabel?: string;
}

export interface AiSkillRecord {
  id: string;
  enabled: boolean;
  descriptor: {
    id: string;
    name: string;
    description?: string;
  };
}

export interface WebSearchProvider {
  id: string;
  name: string;
  type: 'local' | 'api' | 'custom';
}

export type Theme = 'light' | 'dark';

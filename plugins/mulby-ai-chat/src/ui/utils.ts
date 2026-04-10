import { ChatMessage } from './types';

// ── 工具函数 ──────────────────────────────────────────────

export const genId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

export function getDefaultTitle(messages: ChatMessage[]) {
  const first = messages.find(m => m.role === 'user');
  if (!first) return '新对话';
  // P3: 附件展示时可能没有文本，用附件名备项
  if (!first.content && first.attachments?.length) {
    const name = first.attachments[0].filename || first.attachments[0].mimeType || '附件';
    return `[${name.slice(0, 24)}]`;
  }
  if (!first.content) return '新对话';
  return first.content.slice(0, 28) + (first.content.length > 28 ? '…' : '');
}

// mulby API 访问（渲染进程）
export const ai = () => (window as any).mulby?.ai;
export const storage = () => (window as any).mulby?.storage;

export const STORAGE_NS = 'mulby-ai-chat';
export const STORAGE_KEY_SESSIONS = 'sessions';
// 记忆最后一次用的模型，供新建会话默认用
export const STORAGE_KEY_MODEL = 'lastModel';
// 本地开关：是否在 ai.call 中请求联网能力（不等同于宿主策略开关）
export const STORAGE_KEY_WEB_SEARCH_REQUEST = 'webSearchRequestEnabled';

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

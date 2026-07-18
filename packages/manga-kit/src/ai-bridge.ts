// ================= AI 桥接核心纯函数（方案 7.1，从 tech-manga services/mulbyAiService.ts 平移） =================
// 只收敛与 prompt 文案 / 计价 / 用量上报形状无关的底层 helper（7.1 包边界）。

import { sniffImageMime } from './image-mime';

/** 纯文本创作调用的公共选项：关闭一切工具注入，防止 prompt 注入触发内部工具 */
export const NO_TOOLS = {
  capabilities: [] as string[],
  toolingPolicy: { enableInternalTools: false },
  mcp: { mode: 'off' as const },
  skills: { mode: 'off' as const }
};

/** 把 data URL 拆成 mimeType + ArrayBuffer，用于上传 AI 附件 / storage.attachment.put */
export const dataUrlToBuffer = (dataUrl: string): { mimeType: string; buffer: ArrayBuffer } => {
  const match = dataUrl.match(/^data:(image\/[a-z+.-]+);base64,(.+)$/i);
  const mimeType = match ? match[1] : 'image/png';
  const base64 = match ? match[2] : (dataUrl.split(',')[1] || dataUrl);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return { mimeType, buffer: bytes.buffer };
};

/**
 * 宽高比 → 尺寸字符串与 prompt 比例提示（方案 4.7）。
 * - canvasHint：generate 路径用，必须与 size 画布数学一致（否则模型自行留白/加边框凑比例）；
 * - requestedHint：edit 路径用（无 size 画布时忠实用户所选比例；第 6 章宿主分支落地后
 *   size/aspectRatio 随 edit 入参透传，hint 退化为辅助提示）。
 */
export const aspectRatioToSize = (aspectRatio: string): {
  size: string; canvasHint: string; requestedHint: string;
} => {
  switch (aspectRatio) {
    case '1:1':  return { size: '1024x1024', canvasHint: 'square 1:1', requestedHint: 'square 1:1' };
    case '4:3':  return { size: '1536x1024', canvasHint: 'landscape 3:2', requestedHint: 'landscape 4:3' };
    case '16:9': return { size: '1536x1024', canvasHint: 'landscape 3:2', requestedHint: 'wide landscape 16:9' };
    case '9:16': return { size: '1024x1536', canvasHint: 'tall portrait 2:3', requestedHint: 'tall portrait 9:16' };
    case '3:4':  return { size: '1024x1536', canvasHint: 'portrait 2:3', requestedHint: 'portrait 3:4' };
    case '2:3':
    default:     return { size: '1024x1536', canvasHint: 'portrait 2:3 (manga page)', requestedHint: 'portrait 2:3 (manga page)' };
  }
};

// 方案 4.6：本地 JSON 提取（大小写不敏感围栏剥离 + 首尾大括号截取，救回前置说明文字等脏输出）
export const extractJson = (text: string): string => {
  const stripped = text.replace(/```(?:json)?/gi, '').trim();
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  return start >= 0 && end > start ? stripped.slice(start, end + 1) : stripped;
};

/** 图像结果 → data URL（Mulby 返回纯 base64；mime 按魔数探测，方案 5.6） */
export const toDataUrl = (image: string) =>
  image.startsWith('data:') ? image : `data:${sniffImageMime(image)};base64,${image}`;

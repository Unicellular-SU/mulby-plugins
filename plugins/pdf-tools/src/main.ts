type Attachment = { path?: string; name?: string }
type ClipboardFile = { path?: string; name?: string }
type InputPayloadLike = { text?: unknown; input?: unknown; attachments?: unknown }
declare const mulby: any;

interface PluginContext {
  input?: unknown
  featureCode?: string
  attachments?: Attachment[]
}

interface PendingInitData {
  featureCode?: string
  route?: string
  input?: string
  attachments?: Attachment[]
}

const FEATURE_ROUTE_MAP: Record<string, string> = {
  merge: 'merge',
  split: 'split',
  arrange: 'arrange',
  compress: 'compress',
  watermark: 'watermark',
  'extract-img': 'extract-img',
  'pdf-to-img': 'pdf-to-img',
  'pdf-to-word': 'pdf-to-word',
  'pdf-to-ppt': 'pdf-to-ppt',
  'pdf-to-excel': 'pdf-to-excel',
}

let pendingInit: PendingInitData | null = null;

function normalizeAttachments(raw: unknown): Attachment[] {
  if (!Array.isArray(raw)) return [];
  const result: Attachment[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const path = typeof (item as { path?: unknown }).path === 'string' ? (item as { path: string }).path : undefined;
    const name = typeof (item as { name?: unknown }).name === 'string' ? (item as { name: string }).name : undefined;
    if (!path && !name) continue;
    result.push({ path, name });
  }
  return result;
}

function parseInputPayload(rawInput: unknown): { inputText?: string; attachments: Attachment[] } {
  if (!rawInput) return { attachments: [] };

  // input could be plain text path, JSON string, or object payload.
  if (typeof rawInput === 'string') {
    const trimmed = rawInput.trim();
    try {
      const parsed = JSON.parse(trimmed) as InputPayloadLike;
      const parsedInput = typeof parsed.text === 'string'
        ? parsed.text
        : (typeof parsed.input === 'string' ? parsed.input : trimmed);
      return {
        inputText: parsedInput,
        attachments: normalizeAttachments(parsed.attachments),
      };
    } catch {
      return { inputText: rawInput, attachments: [] };
    }
  }

  if (typeof rawInput === 'object') {
    const payload = rawInput as InputPayloadLike;
    const inputText = typeof payload.text === 'string'
      ? payload.text
      : (typeof payload.input === 'string' ? payload.input : undefined);
    return {
      inputText,
      attachments: normalizeAttachments(payload.attachments),
    };
  }

  return { attachments: [] };
}

async function resolveInitPayload(context: PluginContext): Promise<PendingInitData> {
  const route = context.featureCode ? FEATURE_ROUTE_MAP[context.featureCode] : undefined;
  const parsed = parseInputPayload(context.input);

  const mergedAttachments = [...normalizeAttachments(context.attachments), ...parsed.attachments];
  const dedupedAttachments = Array.from(
    new Map(mergedAttachments.map((item) => [`${item.path || ''}|${item.name || ''}`, item])).values(),
  );

  if (!dedupedAttachments.length && mulby.clipboard?.readFiles) {
    try {
      const clipboardFiles = await mulby.clipboard.readFiles();
      const clipboardAttachments = normalizeAttachments(clipboardFiles).filter((item) =>
        typeof item.path === 'string' ? /\.pdf$/i.test(item.path) : true,
      );
      dedupedAttachments.push(...clipboardAttachments);
    } catch {
      // ignore clipboard fallback errors
    }
  }

  let inputText = parsed.inputText;
  if (inputText && dedupedAttachments.length > 0) {
    const trimmed = inputText.trim();
    const isBareName = trimmed.length > 0 && !trimmed.includes('/') && !trimmed.includes('\\');
    if (isBareName && dedupedAttachments.some(a => a.path?.endsWith('/' + trimmed) || a.path?.endsWith('\\' + trimmed) || a.name === trimmed)) {
      inputText = undefined;
    } else if (dedupedAttachments.some(a => a.path === trimmed)) {
      inputText = undefined;
    }
  }

  return {
    featureCode: context.featureCode,
    route,
    input: inputText,
    attachments: dedupedAttachments,
  };
}

export function onLoad() {
  console.log('[pdf-tools] 插件已加载')
}

export function onUnload() {
  console.log('[pdf-tools] 插件已卸载')
}

export function onEnable() {
  console.log('[pdf-tools] 插件已启用')
}

export function onDisable() {
  console.log('[pdf-tools] 插件已禁用')
}

export async function run(context: PluginContext) {
  pendingInit = await resolveInitPayload(context);
  mulby.notification.show('PDF 工具箱已就绪');
}

export const rpc = {
  async getPendingInit() {
    return pendingInit;
  },
  async clearPendingInit() {
    pendingInit = null;
    return true;
  },
}

const plugin = { onLoad, onUnload, onEnable, onDisable, run }
export default plugin

import {
  ComicResponse,
  ComicPageData,
  CharacterSheetItem,
  PropSheetItem,
  TokenUsage,
  WorkflowStep,
} from '../types';

// ================= 会话持久化（方案 3.1 / 3.2，遵守 D5） =================
// 结构化数据走 storage.set('config') / storage.set('session') 两个 KV 键；
// 图像二进制走 storage.attachment.put，key 约定 page-<n> / char-<name> / prop-<name>；
// 生成成功点增量落盘，onPluginOut / pagehide 只兜底 flush 小体积元数据。
// 所有宿主 API 一律特性探测：无 window.mulby.storage 的环境静默降级（仅失去恢复能力）。

export const SCHEMA_VERSION = 1;
export const CONFIG_KEY = 'config';
export const SESSION_KEY = 'session';

/** 会话附件 id 前缀（page-/char-/prop-），清理时按此匹配 */
const SESSION_ATTACHMENT_RE = /^(page|char|prop)-/;

const getStorage = (): MulbyStorage | undefined => (window as Window).mulby?.storage;

// ---- 存储 schema ----

export type PersistedCharacter = Omit<CharacterSheetItem, 'referenceImage'> & { hasReference: boolean };
export type PersistedProp = Omit<PropSheetItem, 'referenceImage'> & { hasReference: boolean };
export type PersistedPage = Omit<ComicPageData, 'imageData' | 'isGenerating'> & { hasImage: boolean };

export interface PersistedSession {
  v: number;
  savedAt: number;
  workflowStep: WorkflowStep;          // 恢复到哪一步
  storyboardTab: 'SCRIPT' | 'CHARACTERS';
  sourceText: string;                  // 源文本属于会话内容，随 session 存（不入 config）
  comicScript: ComicResponse | null;   // character_sheet/prop_sheet 的 referenceImage 已剥离
  characterSheet: PersistedCharacter[];
  propSheet: PersistedProp[];
  pages: PersistedPage[];
  tokenUsage: TokenUsage;              // history 截断至最近 200 条，防 KV 膨胀
}

/** 剥离 sheet 内 referenceImage（referenceImage 为可选字段，剥离后仍满足 ComicResponse 类型） */
export const stripSheetImages = (script: ComicResponse | null): ComicResponse | null =>
  script && {
    ...script,
    character_sheet: (script.character_sheet || []).map(({ referenceImage, ...rest }) => rest),
    prop_sheet: (script.prop_sheet || []).map(({ referenceImage, ...rest }) => rest),
  };

// ---- 附件 id ----
// 附件 ID 即文件名，须满足宿主校验（无 / \ : * ? " < > | 与控制字符 \x00-\x1f、
// 首尾空白与结尾点、Windows 保留设备名、UTF-8 ≤ 200 字节、不得以 .tmp- 开头；
// 前缀 char-/prop-/page- 天然规避保留名与 .tmp-）。角色名可能含中文/特殊字符，统一消毒。
// 注：不同原名可能消毒后同 id（如 "a:b" 与 "a?b"），概率极低，本期接受（方案 3.1 风险 3）。
const sanitizeAttachmentId = (raw: string): string => {
  // eslint-disable-next-line no-control-regex
  let s = raw.replace(/[/\\:*?"<>|\x00-\x1f\s]/g, '_');
  while (new TextEncoder().encode(s).length > 180) s = s.slice(0, -1);
  return s.replace(/\.+$/, '') || 'unnamed';
};

export const attIdForPage = (n: number) => `page-${n}`;
export const attIdForChar = (name: string) => `char-${sanitizeAttachmentId(name)}`;
export const attIdForProp = (name: string) => `prop-${sanitizeAttachmentId(name)}`;

// ---- dataURL ↔ 二进制 ----
// 与 mulbyAiService.ts 的同名 helper 同构；为遵守「第 3 章不动 mulbyAiService」的边界
// 本地保留一份（第 4 章重构上传缓存时统一抽到共享模块）。
const dataUrlToBuffer = (dataUrl: string): { mimeType: string; buffer: ArrayBuffer } => {
  const match = dataUrl.match(/^data:(image\/[a-z+.-]+);base64,(.+)$/i);
  const mimeType = match ? match[1] : 'image/png';
  const base64 = match ? match[2] : (dataUrl.split(',')[1] || dataUrl);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return { mimeType, buffer: bytes.buffer };
};

/** dataURL → 附件；失败仅告警，不打断生成流程 */
export const putImageAttachment = async (id: string, dataUrl: string): Promise<boolean> => {
  const storage = getStorage();
  if (!storage?.attachment?.put) return false;
  try {
    const { mimeType, buffer } = dataUrlToBuffer(dataUrl);
    const res = await storage.attachment.put(id, buffer, mimeType);
    // 兼容旧宿主的 Promise<boolean> 签名与新宿主的 AttachmentPutResult
    const ok = typeof res === 'boolean' ? res : !!(res as { ok?: boolean })?.ok;
    if (!ok) {
      console.warn(`[persist] attachment.put(${id}) failed:`, (res as { error?: string })?.error ?? res);
    }
    return ok;
  } catch (e) {
    console.warn(`[persist] attachment.put(${id}) threw:`, e);
    return false;
  }
};

/** 附件 → dataURL（Blob + FileReader，避免手写 base64 大数组拼接） */
export const getImageAttachment = async (id: string): Promise<string | null> => {
  const storage = getStorage();
  if (!storage?.attachment?.get) return null;
  try {
    const data = await storage.attachment.get(id);
    if (!data) return null;
    const mimeType = (await storage.attachment.getType(id).catch(() => null)) || 'image/png';
    return await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(new Blob([data as BlobPart], { type: mimeType }));
    });
  } catch (e) {
    console.warn(`[persist] attachment.get(${id}) failed:`, e);
    return null;
  }
};

/** 删除全部会话附件（page-/char-/prop- 前缀）；也用于启动时的孤儿附件清理 */
export const clearSessionAttachments = async (): Promise<void> => {
  const storage = getStorage();
  if (!storage?.attachment?.list) return;
  try {
    const all = await storage.attachment.list();
    await Promise.allSettled(
      (all || [])
        .filter((a) => SESSION_ATTACHMENT_RE.test(a.id))
        .map((a) => storage.attachment.remove(a.id))
    );
  } catch (e) {
    console.warn('[persist] clearSessionAttachments failed:', e);
  }
};

// ---- session 防抖写入（debounce 800ms；flushSession 供兜底同步触发） ----

let pendingSession: PersistedSession | null = null;
let sessionTimer: ReturnType<typeof setTimeout> | null = null;

export const saveSessionDebounced = (s: PersistedSession, delay = 800): void => {
  pendingSession = s;
  if (sessionTimer) clearTimeout(sessionTimer);
  sessionTimer = setTimeout(() => { void flushSession(); }, delay);
};

/** 立即写入待落盘的 session 快照；无待写内容时为 no-op */
export const flushSession = async (): Promise<void> => {
  if (sessionTimer) { clearTimeout(sessionTimer); sessionTimer = null; }
  const s = pendingSession;
  pendingSession = null;
  if (!s) return;
  const storage = getStorage();
  if (!storage?.set) return;
  try {
    await storage.set(SESSION_KEY, s);
  } catch (e) {
    console.warn('[persist] session save failed:', e);
  }
};

/** 丢弃尚未写盘的 session 快照（丢弃会话时防止防抖尾巴把旧会话写回去） */
export const cancelPendingSessionSave = (): void => {
  if (sessionTimer) { clearTimeout(sessionTimer); sessionTimer = null; }
  pendingSession = null;
};

/** 丢弃持久化会话：session 键 + 全部会话附件；config 保留 */
export const discardPersistedSession = async (): Promise<void> => {
  cancelPendingSessionSave();
  const storage = getStorage();
  if (storage?.remove) {
    try { await storage.remove(SESSION_KEY); } catch { /* ignore */ }
  }
  await clearSessionAttachments();
};

// ---- 启动读回 ----

export const loadConfigFromStorage = async (): Promise<unknown> => {
  const storage = getStorage();
  if (!storage?.get) return null;
  try { return await storage.get(CONFIG_KEY); } catch { return null; }
};

export const saveConfigToStorage = async (value: unknown): Promise<void> => {
  const storage = getStorage();
  if (!storage?.set) return;
  try {
    await storage.set(CONFIG_KEY, value);
  } catch (e) {
    console.warn('[persist] config save failed:', e);
  }
};

export const loadSessionFromStorage = async (): Promise<unknown> => {
  const storage = getStorage();
  if (!storage?.get) return null;
  try { return await storage.get(SESSION_KEY); } catch { return null; }
};

/**
 * 会话是否可恢复：版本匹配 + 剧本存在 + 工作流已进入 STORYBOARDING/COMIC_GENERATION。
 * 快照 effect 不会在 CONFIG/SCRIPT_GENERATION 写盘，此处校验兼作损坏数据防线（宁可丢弃不可崩溃）。
 */
export const isRestorableSession = (s: unknown): s is PersistedSession => {
  if (!s || typeof s !== 'object') return false;
  const sess = s as Partial<PersistedSession>;
  return sess.v === SCHEMA_VERSION
    && !!sess.comicScript
    && (sess.workflowStep === WorkflowStep.STORYBOARDING || sess.workflowStep === WorkflowStep.COMIC_GENERATION)
    && Array.isArray(sess.characterSheet)
    && Array.isArray(sess.propSheet)
    && Array.isArray(sess.pages)
    && typeof sess.sourceText === 'string';
};

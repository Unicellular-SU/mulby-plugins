import {
  ComicResponse,
  ComicPageData,
  CharacterSheetItem,
  PropSheetItem,
  SceneSheetItem,
  TokenUsage,
  WorkflowStep,
  AppConfig,
} from '../engine-types';
// dataURL ↔ 二进制：与 mulbyAiService 共用 manga-kit 的同一实现（方案 7.1，兑现第 3 章"统一抽到共享模块"的注记）
import { dataUrlToBuffer } from '@mulby-plugins/manga-kit';

// ================= 多工程持久化（SCHEMA_VERSION 2） =================
// 存储模型：
// - `config`          全局默认偏好（保留原义，作为新建工程的默认值；工程打开期间不写）
// - `projects`        工程索引 [{ id, title, createdAt, updatedAt, workflowStep, pageCount, donePages, coverAttId }]
// - `project-<id>`    工程快照 = 会话快照 + 该工程自己的 config 快照（打开时一并恢复）
// - 附件命名空间加工程前缀：p-<id>-page-<n> / p-<id>-char-<name> / p-<id>-prop-<name>
// 新工程创建时机 = 剧本生成成功（原 beginNewSession 时刻）；不再清任何旧数据。
// v1→v2 迁移：旧 `session` 键可恢复 → 迁移为一个工程并搬移旧前缀附件；旧前缀
// page-/char-/prop- 仅在没有旧 session 时做孤儿清理；p-<id>- 前缀只随删除工程清除。
// 所有宿主 API 一律特性探测：无 window.mulby.storage 的环境静默降级（仅失去恢复能力）。

export const SCHEMA_VERSION = 2;
export const CONFIG_KEY = 'config';
const PROJECTS_INDEX_KEY = 'projects';
const LEGACY_SESSION_KEY = 'session';
const projectKey = (id: string) => `project-${id}`;

/** 旧版（v1）会话附件 id 前缀；孤儿清理仅限此前缀 */
const LEGACY_ATTACHMENT_RE = /^(page|char|prop)-/;
/** 工程附件 id 前缀（p-<id>-page/char/prop-） */
const projectAttPrefix = (pid: string) => `p-${pid}-`;

const getStorage = (): MulbyStorage | undefined => (window as Window).mulby?.storage;

// ---- 存储 schema ----

export type PersistedCharacter = Omit<CharacterSheetItem, 'referenceImage'> & { hasReference: boolean };
export type PersistedProp = Omit<PropSheetItem, 'referenceImage'> & { hasReference: boolean };
export type PersistedScene = Omit<SceneSheetItem, 'referenceImage'> & { hasReference: boolean };
export type PersistedPage = Omit<ComicPageData, 'imageData' | 'isGenerating' | 'progress'> & { hasImage: boolean };

/** v1 会话快照（仅迁移路径读取） */
export interface PersistedSession {
  v: number;
  savedAt: number;
  workflowStep: WorkflowStep;
  storyboardTab: 'SCRIPT' | 'CHARACTERS';
  sourceText: string;
  comicScript: ComicResponse | null;
  characterSheet: PersistedCharacter[];
  propSheet: PersistedProp[];
  sceneSheet?: PersistedScene[];   // 场景资产（后加字段；旧快照缺省视为 []）
  pages: PersistedPage[];
  tokenUsage: TokenUsage;
}

/** v2 工程快照 = 会话快照 + 该工程自己的 config 快照（sourceText 仍在快照顶层，不入 config） */
export interface PersistedProject extends PersistedSession {
  config?: Partial<Omit<AppConfig, 'sourceText'>>;
}

/** 工程索引条目（画廊卡片渲染所需的最小信息） */
export interface ProjectIndexEntry {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  workflowStep: WorkflowStep;
  pageCount: number;
  donePages: number;
  coverAttId?: string;    // 封面页（page_number 0）有图时的附件 id
}

/** 剥离 sheet 内 referenceImage（referenceImage 为可选字段，剥离后仍满足 ComicResponse 类型） */
export const stripSheetImages = (script: ComicResponse | null): ComicResponse | null =>
  script && {
    ...script,
    character_sheet: (script.character_sheet || []).map(({ referenceImage, ...rest }) => rest),
    prop_sheet: (script.prop_sheet || []).map(({ referenceImage, ...rest }) => rest),
    scene_sheet: (script.scene_sheet || []).map(({ referenceImage, ...rest }) => rest),
  };

// ---- 工程命名空间（模块级，与 mulbyAiService 的 activeModels 同模式） ----
// 附件写入/读取永远发生在某个工程激活期间（生成中 / 恢复后 / 打开后），
// attIdFor* 保持单参签名，所有调用方（useImageQueue / MangaApp / hook）零改动。

let activeProjectId: string | null = null;

/** 切换当前工程命名空间；打开/新建/丢弃工程时由 hook 调用 */
export const setActiveProjectId = (id: string | null): void => {
  activeProjectId = id;
};
export const getActiveProjectId = (): string | null => activeProjectId;

const requireProjectId = (): string => {
  if (!activeProjectId) {
    throw new Error('[manga-core] 无激活工程：附件读写必须在打开/新建工程之后进行');
  }
  return activeProjectId;
};

// ---- 附件 id ----
// 附件 ID 即文件名，须满足宿主校验（无 / \ : * ? " < > | 与控制字符 \x00-\x1f、
// 首尾空白与结尾点、Windows 保留设备名、UTF-8 ≤ 200 字节、不得以 .tmp- 开头；
// 前缀 p-<id>-char- 等天然规避保留名与 .tmp-）。角色名可能含中文/特殊字符，统一消毒。
// 注：不同原名可能消毒后同 id（如 "a:b" 与 "a?b"），概率极低，本期接受（方案 3.1 风险 3）。
const sanitizeAttachmentId = (raw: string): string => {
  // eslint-disable-next-line no-control-regex
  let s = raw.replace(/[/\\:*?"<>|\x00-\x1f\s]/g, '_');
  // 工程前缀占 ~12 字节，给名字部分留 160 字节，整 id 远低于 200 字节上限
  while (new TextEncoder().encode(s).length > 160) s = s.slice(0, -1);
  return s.replace(/\.+$/, '') || 'unnamed';
};

export const attIdForPage = (n: number) => `p-${requireProjectId()}-page-${n}`;
export const attIdForChar = (name: string) => `p-${requireProjectId()}-char-${sanitizeAttachmentId(name)}`;
export const attIdForProp = (name: string) => `p-${requireProjectId()}-prop-${sanitizeAttachmentId(name)}`;
export const attIdForScene = (name: string) => `p-${requireProjectId()}-scene-${sanitizeAttachmentId(name)}`;

/** 短随机工程 id（8 位，时间熵 + 随机熵；附件 id 长度预算内） */
const generateProjectId = (): string =>
  `${Date.now().toString(36).slice(-4)}${Math.random().toString(36).slice(2, 6)}`;

// ---- 附件读写 ----

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

// ---- 工程索引 CRUD ----

export const loadProjectIndex = async (): Promise<ProjectIndexEntry[]> => {
  const storage = getStorage();
  if (!storage?.get) return [];
  try {
    const raw = await storage.get(PROJECTS_INDEX_KEY);
    if (!Array.isArray(raw)) return [];
    return raw.filter(e => e && typeof e.id === 'string' && typeof e.title === 'string');
  } catch {
    return [];
  }
};

const saveProjectIndex = async (entries: ProjectIndexEntry[]): Promise<void> => {
  const storage = getStorage();
  if (!storage?.set) return;
  try {
    await storage.set(PROJECTS_INDEX_KEY, entries);
  } catch (e) {
    console.warn('[persist] project index save failed:', e);
  }
};

/** 新建工程索引条目（剧本生成成功时调用）；快照由快照 effect 随后写入 */
export const createProjectEntry = async (title: string): Promise<ProjectIndexEntry> => {
  const now = Date.now();
  const entry: ProjectIndexEntry = {
    id: generateProjectId(),
    title: title.trim() || 'Untitled',
    createdAt: now,
    updatedAt: now,
    workflowStep: WorkflowStep.STORYBOARDING,
    pageCount: 0,
    donePages: 0,
  };
  const index = await loadProjectIndex();
  await saveProjectIndex([entry, ...index]);
  return entry;
};

/** 重命名工程（仅改索引标题；快照内 comicScript.title 不动） */
export const renameProject = async (id: string, title: string): Promise<void> => {
  const index = await loadProjectIndex();
  const entry = index.find(e => e.id === id);
  if (!entry) return;
  entry.title = title.trim() || entry.title;
  await saveProjectIndex(index);
};

/** 删除工程：索引条目 + project-<id> 快照 + 全部 p-<id>- 前缀附件 */
export const deleteProject = async (id: string): Promise<void> => {
  // 防御：若删除的恰是待落盘工程，先丢弃防抖尾巴
  if (pendingProject && pendingProject.id === id) cancelPendingProjectSave();
  const storage = getStorage();
  const index = await loadProjectIndex();
  await saveProjectIndex(index.filter(e => e.id !== id));
  if (storage?.remove) {
    try { await storage.remove(projectKey(id)); } catch { /* ignore */ }
  }
  if (storage?.attachment?.list) {
    try {
      const prefix = projectAttPrefix(id);
      const all = await storage.attachment.list();
      await Promise.allSettled(
        (all || [])
          .filter(a => a.id.startsWith(prefix))
          .map(a => storage.attachment.remove(a.id))
      );
    } catch (e) {
      console.warn(`[persist] deleteProject(${id}) attachment cleanup failed:`, e);
    }
  }
};

// ---- 工程快照读写（防抖 800ms；flushProject 供切换工程与兜底同步触发） ----

let pendingProject: { id: string; snapshot: PersistedProject } | null = null;
let projectTimer: ReturnType<typeof setTimeout> | null = null;

export const saveProjectDebounced = (id: string, snapshot: PersistedProject, delay = 800): void => {
  pendingProject = { id, snapshot };
  if (projectTimer) clearTimeout(projectTimer);
  projectTimer = setTimeout(() => { void flushProject(); }, delay);
};

/** 丢弃尚未写盘的工程快照（删除/丢弃工程时防止防抖尾巴写回） */
export const cancelPendingProjectSave = (): void => {
  if (projectTimer) { clearTimeout(projectTimer); projectTimer = null; }
  pendingProject = null;
};

/** 立即写入待落盘的工程快照，并同步索引条目（updatedAt/阶段/页进度/封面）；无待写内容时为 no-op */
export const flushProject = async (): Promise<void> => {
  if (projectTimer) { clearTimeout(projectTimer); projectTimer = null; }
  const pending = pendingProject;
  pendingProject = null;
  if (!pending) return;
  const storage = getStorage();
  if (!storage?.set) return;
  const { id, snapshot } = pending;
  try {
    await storage.set(projectKey(id), snapshot);
  } catch (e) {
    console.warn('[persist] project save failed:', e);
  }
  // 索引同步：保留 title/createdAt（索引条目可能已被并发删除——消失则不重建）
  const index = await loadProjectIndex();
  const entry = index.find(e => e.id === id);
  if (!entry) return;
  entry.updatedAt = snapshot.savedAt;
  entry.workflowStep = snapshot.workflowStep;
  entry.pageCount = snapshot.pages.length;
  entry.donePages = snapshot.pages.filter(p => p.hasImage).length;
  entry.coverAttId = snapshot.pages.some(p => p.page_number === 0 && p.hasImage)
    ? `p-${id}-page-0`
    : undefined;
  await saveProjectIndex(index);
};

export const loadProject = async (id: string): Promise<unknown> => {
  const storage = getStorage();
  if (!storage?.get) return null;
  try { return await storage.get(projectKey(id)); } catch { return null; }
};

/** v2 工程快照是否可恢复：版本匹配 + 剧本存在 + 工作流已进入 STORYBOARDING/COMIC_GENERATION */
export const isRestorableProject = (s: unknown): s is PersistedProject => {
  if (!s || typeof s !== 'object') return false;
  const sess = s as Partial<PersistedProject>;
  return sess.v === SCHEMA_VERSION
    && !!sess.comicScript
    && (sess.workflowStep === WorkflowStep.STORYBOARDING || sess.workflowStep === WorkflowStep.COMIC_GENERATION)
    && Array.isArray(sess.characterSheet)
    && Array.isArray(sess.propSheet)
    && (sess.sceneSheet === undefined || Array.isArray(sess.sceneSheet)) // 场景为后加字段，旧快照缺省容忍
    && Array.isArray(sess.pages)
    && typeof sess.sourceText === 'string';
};

// ---- 全局默认 config（保留原义：新建工程的默认值） ----

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

// ---- v1 → v2 迁移与前缀感知清理 ----

/** 旧版 session 是否可恢复（v1 校验，仅迁移路径使用） */
const isRestorableLegacySession = (s: unknown): s is PersistedSession => {
  if (!s || typeof s !== 'object') return false;
  const sess = s as Partial<PersistedSession>;
  return sess.v === 1
    && !!sess.comicScript
    && (sess.workflowStep === WorkflowStep.STORYBOARDING || sess.workflowStep === WorkflowStep.COMIC_GENERATION)
    && Array.isArray(sess.characterSheet)
    && Array.isArray(sess.propSheet)
    && Array.isArray(sess.pages)
    && typeof sess.sourceText === 'string';
};

/** 清理旧版前缀（page-/char-/prop-）附件；仅在没有旧 session 时调用 */
const clearLegacyAttachments = async (): Promise<void> => {
  const storage = getStorage();
  if (!storage?.attachment?.list) return;
  try {
    const all = await storage.attachment.list();
    await Promise.allSettled(
      (all || [])
        .filter((a) => LEGACY_ATTACHMENT_RE.test(a.id))
        .map((a) => storage.attachment.remove(a.id))
    );
  } catch (e) {
    console.warn('[persist] clearLegacyAttachments failed:', e);
  }
};

/**
 * 启动迁移（v1 → v2）：
 * - 旧 `session` 可恢复 → 迁移为一个工程（标题取剧本 title，附件按旧 id 加 p-<id>- 前缀复制后删除旧件），删旧键；
 * - 旧 `session` 存在但不可恢复 → 视为损坏丢弃旧键，并清理旧前缀附件；
 * - 无旧 `session` → 仅做旧前缀孤儿清理。
 * p-<id>- 前缀附件不做孤儿清理（只随删除工程清除）。
 * 返回迁移出的工程索引条目（无迁移则为 null）。
 */
export const migrateLegacySession = async (): Promise<ProjectIndexEntry | null> => {
  const storage = getStorage();
  let legacy: unknown = null;
  if (storage?.get) {
    try { legacy = await storage.get(LEGACY_SESSION_KEY); } catch { legacy = null; }
  }

  if (legacy == null) {
    // 无旧 session：旧前缀孤儿清理
    void clearLegacyAttachments();
    return null;
  }

  if (!isRestorableLegacySession(legacy)) {
    // 版本不匹配 / 结构不完整：视为不可恢复，静默丢弃（宁可丢弃不可崩溃）
    if (storage?.remove) {
      try { await storage.remove(LEGACY_SESSION_KEY); } catch { /* ignore */ }
    }
    void clearLegacyAttachments();
    return null;
  }

  // 可恢复 → 建档迁移
  const entry = await createProjectEntry(legacy.comicScript?.title || 'Untitled');
  entry.createdAt = legacy.savedAt || entry.createdAt;
  entry.updatedAt = legacy.savedAt || entry.updatedAt;

  const snapshot: PersistedProject = {
    ...legacy,
    v: SCHEMA_VERSION,
    config: undefined, // v1 无工程级 config 快照；打开时回退全局默认 config
  };
  if (storage?.set) {
    try { await storage.set(projectKey(entry.id), snapshot); } catch (e) {
      console.warn('[persist] legacy migration snapshot save failed:', e);
    }
  }

  // 附件搬移：page-/char-/prop-xxx → p-<id>-page-/char-/prop-xxx（复制后删旧件，尽力而为）
  if (storage?.attachment?.list) {
    try {
      const all = await storage.attachment.list();
      const legacyAtts = (all || []).filter(a => LEGACY_ATTACHMENT_RE.test(a.id));
      for (const att of legacyAtts) {
        try {
          const data = await storage.attachment.get(att.id);
          if (!data) continue;
          const mimeType = (await storage.attachment.getType(att.id).catch(() => null)) || 'image/png';
          const res = await storage.attachment.put(`p-${entry.id}-${att.id}`, data, mimeType);
          const ok = typeof res === 'boolean' ? res : !!(res as { ok?: boolean })?.ok;
          if (ok) await storage.attachment.remove(att.id).catch(() => { /* ignore */ });
        } catch { /* 单件失败不阻塞整体迁移 */ }
      }
    } catch (e) {
      console.warn('[persist] legacy attachment migration failed:', e);
    }
  }

  // 索引条目按快照内容收尾
  entry.workflowStep = legacy.workflowStep;
  entry.pageCount = legacy.pages.length;
  entry.donePages = legacy.pages.filter(p => p.hasImage).length;
  entry.coverAttId = legacy.pages.some(p => p.page_number === 0 && p.hasImage)
    ? `p-${entry.id}-page-0`
    : undefined;
  const index = await loadProjectIndex();
  const i = index.findIndex(e => e.id === entry.id);
  if (i >= 0) { index[i] = entry; await saveProjectIndex(index); }

  if (storage?.remove) {
    try { await storage.remove(LEGACY_SESSION_KEY); } catch { /* ignore */ }
  }
  return entry;
};

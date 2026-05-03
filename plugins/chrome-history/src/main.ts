import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { env, platform } from 'process';

declare const mulby: any;

interface BackendPluginContext {
  featureCode?: string;
  input?: string;
  attachments?: Array<{
    path?: string;
    name?: string;
    kind?: 'file' | 'image';
  }>;
}

interface SqlDatabase {
  exec(sql: string, params?: unknown[]): Array<{ columns: string[]; values: unknown[][] }>;
  prepare(sql: string, params?: unknown[]): SqlStatement;
  close(): void;
}

interface SqlStatement {
  step(): boolean;
  getAsObject(): Record<string, unknown>;
  free(): void;
}

interface SqlModule {
  Database: new (data: Buffer | Uint8Array) => SqlDatabase;
}

interface HistoryItem {
  title: string;
  url: string;
  icon: string;
}

const PLUGIN_ID = 'chrome-history';
const PROFILE_STORAGE_KEY = 'profilePath';
const DEFAULT_ICON = 'icon/browser.png';
const RESULT_LIMIT = 80;

let sqlModulePromise: Promise<SqlModule> | null = null;
let cachedProfile = '';
let cachedLoadedAt = 0;
let historyDb: SqlDatabase | null = null;
let faviconDb: SqlDatabase | null = null;
let openedHistory: HistoryItem[] = [];

function notify(message: string, type?: string) {
  mulby.notification.show(message, type);
}

function getAppDataPath(): string {
  if (platform === 'win32') {
    return env.APPDATA || join(env.USERPROFILE || '', 'AppData', 'Roaming');
  }
  if (platform === 'darwin') {
    return join(env.HOME || '', 'Library', 'Application Support');
  }
  return env.XDG_CONFIG_HOME || join(env.HOME || '', '.config');
}

function getDefaultProfilePath(): string {
  const appData = getAppDataPath();
  if (platform === 'darwin') {
    return join(appData, 'Google/Chrome/Default');
  }
  if (platform === 'win32') {
    return join(appData, '../Local/Google/Chrome/User Data/Default');
  }
  return join(appData, 'google-chrome/default');
}

function normalizeProfilePath(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function getProfilePath(): string {
  return normalizeProfilePath(mulby.storage.get(PROFILE_STORAGE_KEY)) || getDefaultProfilePath();
}

function resolveSqlWasmDir(): string {
  const candidates = [
    join(__dirname, 'dist/third_party/sqljs'),
    join(__dirname, 'third_party/sqljs')
  ];
  for (const dir of candidates) {
    if (existsSync(join(dir, 'sql-wasm.js'))) {
      return dir;
    }
  }
  return candidates[0];
}

async function loadSqlJs(): Promise<SqlModule> {
  if (!sqlModulePromise) {
    sqlModulePromise = Promise.resolve().then(async () => {
      const sqlWasmDir = resolveSqlWasmDir();
      const sqlWasmJsPath = join(sqlWasmDir, 'sql-wasm.js');
      const sqlWasmCode = readFileSync(sqlWasmJsPath, 'utf8');
      const module = { exports: {} as any };
      const exports = module.exports;
      const initSqlJs =
        new Function(
          'require',
          'module',
          'exports',
          '__dirname',
          '__filename',
          `${sqlWasmCode}\nreturn module.exports;`
        )(require, module, exports, sqlWasmDir, sqlWasmJsPath).default || module.exports;

      return initSqlJs({
        locateFile: (file: string) => join(sqlWasmDir, file)
      }) as Promise<SqlModule>;
    });
  }
  return sqlModulePromise;
}

function readDatabaseWithWal(dbPath: string): Buffer {
  const dbBuffer = readFileSync(dbPath);
  const walPath = `${dbPath}-wal`;
  if (!existsSync(walPath)) {
    return dbBuffer;
  }

  const walBuffer = readFileSync(walPath);
  if (walBuffer.length < 32) {
    return dbBuffer;
  }

  const pageSize = walBuffer.readUInt32BE(8) || getSqlitePageSize(dbBuffer);
  const salt1 = walBuffer.readUInt32BE(16);
  const salt2 = walBuffer.readUInt32BE(20);
  const frameSize = pageSize + 24;
  let merged = dbBuffer;
  let committedPageCount = Math.ceil(merged.length / pageSize);
  let pendingFrames: Array<{ pageNumber: number; page: Uint8Array }> = [];

  for (let offset = 32; offset + frameSize <= walBuffer.length; offset += frameSize) {
    const pageNumber = walBuffer.readUInt32BE(offset);
    const frameCommitPageCount = walBuffer.readUInt32BE(offset + 4);
    const frameSalt1 = walBuffer.readUInt32BE(offset + 8);
    const frameSalt2 = walBuffer.readUInt32BE(offset + 12);

    if (!pageNumber || frameSalt1 !== salt1 || frameSalt2 !== salt2) {
      continue;
    }

    pendingFrames.push({
      pageNumber,
      page: new Uint8Array(walBuffer.subarray(offset + 24, offset + 24 + pageSize))
    });

    if (!frameCommitPageCount) {
      continue;
    }

    for (const frame of pendingFrames) {
      const pageOffset = (frame.pageNumber - 1) * pageSize;
      const requiredLength = pageOffset + pageSize;
      if (merged.length < requiredLength) {
        const expanded = Buffer.alloc(requiredLength);
        expanded.set(new Uint8Array(merged));
        merged = expanded;
      }
      merged.set(frame.page, pageOffset);
    }

    committedPageCount = frameCommitPageCount;
    pendingFrames = [];
  }

  return merged.subarray(0, committedPageCount * pageSize);
}

function getSqlitePageSize(dbBuffer: Buffer): number {
  if (dbBuffer.length < 100) {
    return 4096;
  }
  const pageSize = dbBuffer.readUInt16BE(16);
  return pageSize === 1 ? 65536 : pageSize;
}

function closeDatabases() {
  historyDb?.close();
  faviconDb?.close();
  historyDb = null;
  faviconDb = null;
}

async function initDatabases(profilePath = getProfilePath()) {
  if (
    historyDb &&
    faviconDb &&
    cachedProfile === profilePath &&
    (Date.now() - cachedLoadedAt) / 1000 < 30
  ) {
    return;
  }

  const historyPath = join(profilePath, 'History');
  const faviconPath = join(profilePath, 'Favicons');
  if (!existsSync(historyPath)) {
    throw new Error(`未找到 Chrome History 数据库: ${historyPath}`);
  }
  if (!existsSync(faviconPath)) {
    throw new Error(`未找到 Chrome Favicons 数据库: ${faviconPath}`);
  }

  const sql = await loadSqlJs();
  closeDatabases();
  historyDb = new sql.Database(readDatabaseWithWal(historyPath));
  faviconDb = new sql.Database(readDatabaseWithWal(faviconPath));
  cachedProfile = profilePath;
  cachedLoadedAt = Date.now();
}

function splitQueries(word?: string): string[] {
  return (word || '')
    .trim()
    .split(/\s+/g)
    .filter(Boolean);
}

function queryRows(db: SqlDatabase, sql: string, params: unknown[] = []): Record<string, unknown>[] {
  const statement = db.prepare(sql, params);
  const rows: Record<string, unknown>[] = [];
  try {
    while (statement.step()) {
      rows.push(statement.getAsObject());
    }
  } finally {
    statement.free();
  }
  return rows;
}

function getFavicon(urlValue: string): string {
  if (!faviconDb || !urlValue.startsWith('http')) {
    return DEFAULT_ICON;
  }

  try {
    const url = new URL(urlValue);
    url.search = '';
    url.pathname = '';
    const rows = queryRows(
      faviconDb,
      `select favicons.url as icon_url
       from favicons
       join icon_mapping on icon_mapping.icon_id = favicons.id
       where page_url like ?
       limit 1`,
      [`${url.toString()}%`]
    );
    const icon = rows[0]?.icon_url;
    return typeof icon === 'string' && icon.length > 0 ? icon : DEFAULT_ICON;
  } catch {
    return DEFAULT_ICON;
  }
}

async function searchHistory(keyword?: string, limit = RESULT_LIMIT): Promise<HistoryItem[]> {
  await initDatabases();
  if (!historyDb) {
    return [];
  }

  const queries = splitQueries(keyword);
  const where = queries
    .map(() => '(title like ? or url like ?)')
    .join(' and ');
  const params: unknown[] = queries.flatMap((query) => [`%${query}%`, `%${query}%`]);
  params.push(limit);

  const rows = queryRows(
    historyDb,
    `select title, url from urls
     ${where ? `where ${where}` : ''}
     order by last_visit_time desc
     limit ?`,
    params
  );

  const seen = new Set<string>();
  const results: HistoryItem[] = [];

  for (const row of rows) {
    const rawUrl = String(row.url || '');
    if (!rawUrl) {
      continue;
    }

    let dedupeKey = rawUrl;
    try {
      const url = new URL(rawUrl);
      url.search = '';
      dedupeKey = url.toString();
    } catch {
      // Keep the raw URL for non-standard schemes.
    }

    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);

    results.push({
      title: String(row.title || rawUrl),
      url: rawUrl,
      icon: getFavicon(rawUrl)
    });
  }

  if (queries.length === 0 && openedHistory.length > 0) {
    const merged = [...openedHistory, ...results];
    const byUrl = new Map<string, HistoryItem>();
    for (const item of merged) {
      if (!byUrl.has(item.url)) {
        byUrl.set(item.url, item);
      }
    }
    return Array.from(byUrl.values()).slice(0, limit);
  }

  return results;
}

async function setProfilePath(profilePath: string) {
  const trimmed = profilePath.trim();
  if (!trimmed) {
    throw new Error('Profile 路径不能为空');
  }
  if (!existsSync(trimmed)) {
    throw new Error(`目录不存在: ${trimmed}`);
  }
  if (!existsSync(join(trimmed, 'History'))) {
    throw new Error(`目录中未找到 History 数据库: ${trimmed}`);
  }

  mulby.storage.set(PROFILE_STORAGE_KEY, trimmed);
  closeDatabases();
  cachedProfile = '';
  cachedLoadedAt = 0;
  notify('Chrome Profile 目录已保存');
}

function firstAttachmentPath(context: BackendPluginContext): string | undefined {
  return context.attachments?.find((attachment) => attachment.path)?.path;
}

export async function run(context: BackendPluginContext) {
  const featureCode = context.featureCode || 'ch';

  if (featureCode === 'ch-setting') {
    const path = firstAttachmentPath(context) || context.input || '';
    try {
      await setProfilePath(path);
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), 'error');
    }
    return;
  }
}

export function onLoad() {
  console.log(`[${PLUGIN_ID}] plugin loaded`);
}

export function onUnload() {
  closeDatabases();
  console.log(`[${PLUGIN_ID}] plugin unloaded`);
}

export const rpc = {
  async search(keyword?: string) {
    try {
      return {
        profilePath: getProfilePath(),
        items: await searchHistory(keyword)
      };
    } catch (error) {
      return {
        profilePath: getProfilePath(),
        items: [],
        error: error instanceof Error ? error.message : String(error)
      };
    }
  },

  async open(url: string) {
    if (!url) {
      return { error: 'URL 为空' };
    }
    await mulby.shell.openExternal(url);
    const title = url;
    openedHistory = [{ title, url, icon: DEFAULT_ICON }, ...openedHistory.filter((item) => item.url !== url)].slice(0, 10);
    return { success: true };
  },

  async getProfilePath() {
    return {
      profilePath: getProfilePath(),
      defaultProfilePath: getDefaultProfilePath()
    };
  },

  async setProfilePath(profilePath: string) {
    try {
      await setProfilePath(profilePath);
      return { success: true, profilePath: getProfilePath() };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  },

  async chooseProfilePath() {
    const paths = await mulby.dialog.showOpenDialog({
      title: '选择 Chrome Profile 目录',
      properties: ['openDirectory', 'showHiddenFiles']
    });
    const profilePath = Array.isArray(paths) ? paths[0] : '';
    if (!profilePath) {
      return { cancelled: true };
    }
    return this.setProfilePath(profilePath);
  }
};

const plugin = { onLoad, onUnload, run, rpc };
export default plugin;

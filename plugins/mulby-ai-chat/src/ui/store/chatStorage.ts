import { storage, STORAGE_KEY_SESSIONS, STORAGE_NS } from '../utils';
import { ChatMessage, SegmentRecord, Session, SessionMeta, SessionSummary } from '../types';

const INDEX_KEY = 'chat:index';
const MIGRATED_V2_KEY = 'chat:migrated:v2';
const SESSION_LIMIT = 50;
const MESSAGE_LIMIT_PER_SESSION = 100;
const SEGMENT_SIZE = 25;

const metaKey = (sessionId: string) => `chat:s:${sessionId}:meta`;
const segKey = (sessionId: string, segmentIndex: number) =>
  `chat:s:${sessionId}:seg:${String(segmentIndex).padStart(6, '0')}`;
const sessionPrefix = (sessionId: string) => `chat:s:${sessionId}:`;

type StorageV2 = {
  get: (key: string, namespace?: string) => Promise<unknown>;
  set: (key: string, value: unknown, namespace?: string) => Promise<boolean>;
  remove: (key: string, namespace?: string) => Promise<boolean>;
  list: (options?: {
    prefix?: string;
    startsAfter?: string;
    limit?: number;
    order?: 'asc' | 'desc';
    namespace?: string;
  }) => Promise<{ items: { key: string }[]; nextCursor?: string }>;
  getMany: (
    keys: string[],
    options?: { namespace?: string }
  ) => Promise<Array<{ key: string; found: boolean; value?: unknown }>>;
  setMany: (
    items: { key: string; value: unknown; expectedVersion?: number | null }[],
    options?: { namespace?: string; atomic?: boolean }
  ) => Promise<{ success: boolean }>;
  transaction: (
    ops: { op: 'set' | 'remove'; key: string; value?: unknown; expectedVersion?: number | null }[],
    options?: { namespace?: string }
  ) => Promise<{ success: boolean }>;
  watch: (
    options: { namespace?: string; prefix?: string },
    callback: (event: { type: 'set' | 'remove' | 'clear'; key: string }) => void
  ) => () => void;
};

let previousSessionHashes = new Map<string, string>();
let previousSessionIds = new Set<string>();

function isV2Storage(api: unknown): api is StorageV2 {
  if (!api || typeof api !== 'object') return false;
  const candidate = api as Record<string, unknown>;
  return (
    typeof candidate.list === 'function' &&
    typeof candidate.getMany === 'function' &&
    typeof candidate.setMany === 'function' &&
    typeof candidate.transaction === 'function'
  );
}

function normalizeSessions(list: Session[]): Session[] {
  return list
    .slice(0, SESSION_LIMIT)
    .map((session) => ({
      ...session,
      messages: session.messages.slice(-MESSAGE_LIMIT_PER_SESSION),
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

function buildSummary(session: Session): SessionSummary {
  return {
    id: session.id,
    title: session.title,
    model: session.model,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    messageCount: session.messages.length,
    segmentCount: Math.ceil(session.messages.length / SEGMENT_SIZE),
  };
}

function buildSegments(session: Session): SegmentRecord[] {
  const records: SegmentRecord[] = [];
  for (let i = 0; i < session.messages.length; i += SEGMENT_SIZE) {
    records.push({
      sessionId: session.id,
      segmentIndex: Math.floor(i / SEGMENT_SIZE),
      messages: session.messages.slice(i, i + SEGMENT_SIZE),
    });
  }
  return records;
}

function buildSessionHash(session: Session): string {
  const last = session.messages[session.messages.length - 1];
  return [
    session.updatedAt,
    session.title,
    session.model,
    session.messages.length,
    last?.id || '',
    last?.content?.length || 0,
  ].join('|');
}

async function removeSessionKeys(storageApi: StorageV2, sessionId: string) {
  let startsAfter: string | undefined;
  const keys: string[] = [];
  const prefix = sessionPrefix(sessionId);
  do {
    const page = await storageApi.list({
      namespace: STORAGE_NS,
      prefix,
      startsAfter,
      limit: 200,
      order: 'asc',
    });
    const pageKeys = page.items.map((item) => item.key);
    keys.push(...pageKeys);
    startsAfter = page.nextCursor;
  } while (startsAfter);

  if (keys.length === 0) return;
  await storageApi.transaction(
    keys.map((key) => ({ op: 'remove' as const, key })),
    { namespace: STORAGE_NS }
  );
}

async function loadSessionsV2(storageApi: StorageV2): Promise<Session[]> {
  const indexRaw = await storageApi.get(INDEX_KEY, STORAGE_NS);
  const index = Array.isArray(indexRaw) ? (indexRaw as SessionSummary[]) : [];
  if (index.length === 0) return [];

  const sessions: Session[] = [];
  for (const summary of index) {
    const metaRaw = await storageApi.get(metaKey(summary.id), STORAGE_NS);
    const meta = (metaRaw as SessionMeta) || summary;
    const segmentCount = Math.max(meta.segmentCount || 0, 0);
    const keys = Array.from({ length: segmentCount }, (_, i) => segKey(summary.id, i));
    const segments = keys.length
      ? await storageApi.getMany(keys, { namespace: STORAGE_NS })
      : [];

    const messages: ChatMessage[] = [];
    segments.forEach((seg) => {
      if (!seg.found || !seg.value) return;
      const record = seg.value as SegmentRecord;
      if (Array.isArray(record.messages)) messages.push(...record.messages);
    });

    sessions.push({
      id: meta.id,
      title: meta.title,
      model: meta.model,
      createdAt: meta.createdAt,
      updatedAt: meta.updatedAt,
      messages: messages.slice(-MESSAGE_LIMIT_PER_SESSION),
    });
  }

  return sessions.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function loadSessionsFromStorage(): Promise<Session[]> {
  const storageApi = storage();
  if (!storageApi) return [];

  if (isV2Storage(storageApi)) {
    const v2Sessions = await loadSessionsV2(storageApi);
    if (v2Sessions.length > 0) {
      previousSessionIds = new Set(v2Sessions.map((s) => s.id));
      previousSessionHashes = new Map(
        v2Sessions.map((session) => [session.id, buildSessionHash(session)])
      );
      return v2Sessions;
    }
  }

  const legacy = (await storageApi.get(STORAGE_KEY_SESSIONS, STORAGE_NS)) as Session[] | undefined;
  if (!Array.isArray(legacy) || legacy.length === 0) return [];
  const normalized = normalizeSessions(legacy);
  await persistSessionsToStorage(normalized, true);
  return normalized;
}

export async function persistSessionsToStorage(
  sessions: Session[],
  migratedFromLegacy = false
) {
  const storageApi = storage();
  if (!storageApi) return;

  const normalized = normalizeSessions(sessions);
  if (!isV2Storage(storageApi)) {
    await storageApi.set(STORAGE_KEY_SESSIONS, normalized, STORAGE_NS);
    return;
  }

  const nextIds = new Set(normalized.map((session) => session.id));
  const summaries = normalized.map(buildSummary);

  for (const session of normalized) {
    const nextHash = buildSessionHash(session);
    const prevHash = previousSessionHashes.get(session.id);
    if (prevHash && prevHash === nextHash && !migratedFromLegacy) continue;

    const segments = buildSegments(session);
    const meta: SessionMeta = { ...buildSummary(session) };
    const items = [
      { key: metaKey(session.id), value: meta },
      ...segments.map((segment) => ({
        key: segKey(segment.sessionId, segment.segmentIndex),
        value: segment,
      })),
    ];
    await storageApi.setMany(items, { namespace: STORAGE_NS, atomic: true });
  }

  const removedIds = [...previousSessionIds].filter((id) => !nextIds.has(id));
  for (const removedId of removedIds) {
    await removeSessionKeys(storageApi, removedId);
  }

  await storageApi.setMany(
    [
      { key: INDEX_KEY, value: summaries },
      ...(migratedFromLegacy ? [{ key: MIGRATED_V2_KEY, value: true }] : []),
    ],
    { namespace: STORAGE_NS, atomic: true }
  );

  previousSessionIds = nextIds;
  previousSessionHashes = new Map(
    normalized.map((session) => [session.id, buildSessionHash(session)])
  );
}

export function subscribeChatStorage(callback: () => void): () => void {
  const storageApi = storage();
  if (!isV2Storage(storageApi) || typeof storageApi.watch !== 'function') {
    return () => {};
  }
  return storageApi.watch(
    { namespace: STORAGE_NS, prefix: 'chat:' },
    () => callback()
  );
}


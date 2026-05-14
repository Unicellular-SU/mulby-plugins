/**
 * Life profile memory system — a structured, user-editable long-term profile
 * for the desktop pet. Old short memory records are intentionally not read.
 */

import { extractJsonObject } from './json-utils'
import { logPetPresentation } from './presentation-debug'

export const PET_LIFE_PROFILE_STORAGE_KEY = 'pet-life-profile-v1'
export const PET_LIFE_PROFILE_META_STORAGE_KEY = 'pet-life-profile-meta-v1'

export const LIFE_PROFILE_CATEGORIES = [
  'profile',
  'preferences',
  'habits',
  'relationship',
  'recentNotes',
] as const

export type LifeProfileCategory = typeof LIFE_PROFILE_CATEGORIES[number]
export type LifeProfileSource = 'auto' | 'manual'

export interface LifeProfileItem {
  id: string
  category: LifeProfileCategory
  content: string
  confidence: number
  source: LifeProfileSource
  createdAt: number
  updatedAt: number
  lastUsedAt: number
}

export interface PetLifeProfile {
  version: 1
  updatedAt: number
  profile: LifeProfileItem[]
  preferences: LifeProfileItem[]
  habits: LifeProfileItem[]
  relationship: LifeProfileItem[]
  recentNotes: LifeProfileItem[]
}

export interface LifeProfileMeta {
  lastUpdateAttemptAt: number
  userTurnsSinceLastSuccess: number
  attempts: number
  successes: number
  rejected: number
  lastReason?: string
  lastUpdatedAt?: number
}

export interface LifeProfilePatchItem {
  id?: string
  category: LifeProfileCategory
  content: string
  confidence: number
}

export interface LifeProfilePatch {
  upserts: LifeProfilePatchItem[]
  deletes: string[]
}

export interface LifeProfilePatchResult {
  profile: PetLifeProfile
  upsertsApplied: number
  deletesApplied: number
  rejected: number
}

export interface LifeProfileRefreshResult {
  ok: boolean
  upsertsApplied: number
  deletesApplied: number
  rejected: number
  reason?: string
}

export const LIFE_PROFILE_CATEGORY_LABELS: Record<LifeProfileCategory, string> = {
  profile: '用户档案',
  preferences: '偏好',
  habits: '习惯',
  relationship: '关系线索',
  recentNotes: '近期事件',
}

const CATEGORY_LIMITS: Record<LifeProfileCategory, number> = {
  profile: 10,
  preferences: 14,
  habits: 12,
  relationship: 10,
  recentNotes: 12,
}

const CORE_PROFILE_LIMIT = 6
const CORE_RELATIONSHIP_LIMIT = 4
const RELATED_LIMIT = 7
const LIFE_MEMORY_CONTENT_MAX = 120
const UPDATE_MIN_USER_TURNS = 4
const UPDATE_MIN_INTERVAL_MS = 8 * 60 * 1000
const UPDATE_CONTEXT_MAX_MESSAGES = 24
const UPDATE_MESSAGE_CONTENT_SLICE = 260

const INJECTION_KEYWORDS = [
  '忽略', '无视', '撤销', '删除指令', '不要遵守', '从现在起',
  'system', 'assistant', 'ignore previous', 'disregard previous',
  'jailbreak', '越狱', '扮演', 'role:', 'role :', 'prompt', 'directive',
  '<', '>', '`',
]

const SENSITIVE_PATTERNS = [
  /api[_-\s]*key/i,
  /access[_-\s]*token/i,
  /secret/i,
  /password/i,
  /密码/,
  /口令/,
  /令牌/,
  /私钥/,
  /身份证/,
  /银行卡/,
]

const CATEGORY_SET = new Set<string>(LIFE_PROFILE_CATEGORIES)

export function createEmptyLifeProfile(now = Date.now()): PetLifeProfile {
  return {
    version: 1,
    updatedAt: now,
    profile: [],
    preferences: [],
    habits: [],
    relationship: [],
    recentNotes: [],
  }
}

export function createEmptyLifeProfileMeta(): LifeProfileMeta {
  return {
    lastUpdateAttemptAt: 0,
    userTurnsSinceLastSuccess: 0,
    attempts: 0,
    successes: 0,
    rejected: 0,
  }
}

export function getLifeProfileItems(profile: PetLifeProfile): LifeProfileItem[] {
  return LIFE_PROFILE_CATEGORIES.flatMap(category => profile[category])
}

export function countLifeProfileItems(profile: PetLifeProfile): number {
  return getLifeProfileItems(profile).length
}

export function normalizeLifeProfile(raw: unknown): PetLifeProfile {
  const now = Date.now()
  const empty = createEmptyLifeProfile(now)
  if (!raw || typeof raw !== 'object') return empty

  const source = raw as Record<string, unknown>
  const normalized: PetLifeProfile = {
    version: 1,
    updatedAt: typeof source.updatedAt === 'number' && Number.isFinite(source.updatedAt)
      ? source.updatedAt
      : now,
    profile: [],
    preferences: [],
    habits: [],
    relationship: [],
    recentNotes: [],
  }

  for (const category of LIFE_PROFILE_CATEGORIES) {
    const bucket = source[category]
    if (!Array.isArray(bucket)) continue
    normalized[category] = bucket
      .map(item => normalizeLifeProfileItem(item, category))
      .filter((item): item is LifeProfileItem => item != null)
      .slice(0, CATEGORY_LIMITS[category])
  }

  return normalized
}

export function normalizeLifeProfileMeta(raw: unknown): LifeProfileMeta {
  const empty = createEmptyLifeProfileMeta()
  if (!raw || typeof raw !== 'object') return empty
  const source = raw as Record<string, unknown>
  return {
    lastUpdateAttemptAt: finiteNumber(source.lastUpdateAttemptAt, 0),
    userTurnsSinceLastSuccess: Math.max(0, Math.floor(finiteNumber(source.userTurnsSinceLastSuccess, 0))),
    attempts: Math.max(0, Math.floor(finiteNumber(source.attempts, 0))),
    successes: Math.max(0, Math.floor(finiteNumber(source.successes, 0))),
    rejected: Math.max(0, Math.floor(finiteNumber(source.rejected, 0))),
    lastReason: typeof source.lastReason === 'string' ? source.lastReason.slice(0, 80) : undefined,
    lastUpdatedAt: typeof source.lastUpdatedAt === 'number' && Number.isFinite(source.lastUpdatedAt)
      ? source.lastUpdatedAt
      : undefined,
  }
}

export function parseLifeProfilePatchText(text: string): LifeProfilePatch | null {
  const { data } = extractJsonObject<Record<string, unknown>>(text)
  if (!data || typeof data !== 'object') return null

  const upsertsRaw = Array.isArray(data.upserts) ? data.upserts : []
  const deletesRaw = Array.isArray(data.deletes) ? data.deletes : []
  const upserts: LifeProfilePatchItem[] = []
  const deletes: string[] = []

  for (const raw of upsertsRaw) {
    if (!raw || typeof raw !== 'object') continue
    const o = raw as Record<string, unknown>
    const category = normalizeCategory(o.category)
    const content = typeof o.content === 'string' ? normalizeContent(o.content) : ''
    if (!category || !content || shouldRejectContent(content)) continue
    upserts.push({
      id: typeof o.id === 'string' && o.id.trim() ? o.id.trim().slice(0, 80) : undefined,
      category,
      content,
      confidence: normalizeConfidence(o.confidence),
    })
  }

  for (const raw of deletesRaw) {
    if (typeof raw === 'string' && raw.trim()) {
      deletes.push(raw.trim().slice(0, 80))
      continue
    }
    if (raw && typeof raw === 'object') {
      const id = (raw as Record<string, unknown>).id
      if (typeof id === 'string' && id.trim()) deletes.push(id.trim().slice(0, 80))
    }
  }

  return { upserts, deletes: [...new Set(deletes)] }
}

export function applyLifeProfilePatch(
  current: PetLifeProfile,
  patch: LifeProfilePatch,
  source: LifeProfileSource = 'auto',
  now = Date.now()
): LifeProfilePatchResult {
  const profile = normalizeLifeProfile(current)
  const byId = new Map<string, LifeProfileItem>()
  for (const item of getLifeProfileItems(profile)) byId.set(item.id, item)

  let upsertsApplied = 0
  let deletesApplied = 0
  let rejected = 0

  for (const id of patch.deletes) {
    if (!byId.has(id)) {
      rejected++
      continue
    }
    for (const category of LIFE_PROFILE_CATEGORIES) {
      const before = profile[category].length
      profile[category] = profile[category].filter(item => item.id !== id)
      if (profile[category].length !== before) {
        deletesApplied++
        byId.delete(id)
        break
      }
    }
  }

  for (const candidate of patch.upserts) {
    const content = normalizeContent(candidate.content)
    if (!content || shouldRejectContent(content)) {
      rejected++
      continue
    }

    const category = candidate.category
    const existingById = candidate.id ? byId.get(candidate.id) : null
    const existing = existingById ?? findSimilarItem(profile[category], content)
    if (existing) {
      if (existing.category !== category) {
        profile[existing.category] = profile[existing.category].filter(item => item.id !== existing.id)
        profile[category].push(existing)
      }
      existing.content = chooseBetterContent(existing.content, content)
      existing.category = category
      existing.confidence = Math.max(existing.confidence, candidate.confidence)
      existing.source = source
      existing.updatedAt = now
      existing.lastUsedAt = now
      upsertsApplied++
      continue
    }

    const item: LifeProfileItem = {
      id: generateId(),
      category,
      content,
      confidence: candidate.confidence,
      source,
      createdAt: now,
      updatedAt: now,
      lastUsedAt: now,
    }
    profile[category].push(item)
    byId.set(item.id, item)
    upsertsApplied++
  }

  for (const category of LIFE_PROFILE_CATEGORIES) {
    evictCategory(profile, category)
  }
  if (upsertsApplied > 0 || deletesApplied > 0) profile.updatedAt = now

  return { profile, upsertsApplied, deletesApplied, rejected }
}

export function updateLifeProfileItemContent(
  current: PetLifeProfile,
  id: string,
  content: string,
  now = Date.now()
): { ok: boolean; profile: PetLifeProfile; reason?: string } {
  const next = normalizeLifeProfile(current)
  const normalized = normalizeContent(content)
  if (!normalized) return { ok: false, profile: next, reason: 'empty' }
  if (shouldRejectContent(normalized)) return { ok: false, profile: next, reason: 'unsafe' }
  for (const item of getLifeProfileItems(next)) {
    if (item.id !== id) continue
    item.content = normalized
    item.source = 'manual'
    item.confidence = Math.max(item.confidence, 4)
    item.updatedAt = now
    item.lastUsedAt = now
    next.updatedAt = now
    return { ok: true, profile: next }
  }
  return { ok: false, profile: next, reason: 'missing' }
}

export function removeLifeProfileItem(current: PetLifeProfile, id: string, now = Date.now()): PetLifeProfile {
  const next = normalizeLifeProfile(current)
  let changed = false
  for (const category of LIFE_PROFILE_CATEGORIES) {
    const before = next[category].length
    next[category] = next[category].filter(item => item.id !== id)
    if (next[category].length !== before) changed = true
  }
  if (changed) next.updatedAt = now
  return next
}

export function buildLifeProfilePromptFromProfile(
  profile: PetLifeProfile,
  userText: string,
  triggerReason?: string
): string {
  return formatLifeProfilePrompt(selectPromptItems(profile, `${triggerReason ?? ''} ${userText}`))
}

export class LifeProfileController {
  private profile: PetLifeProfile = createEmptyLifeProfile()
  private meta: LifeProfileMeta = createEmptyLifeProfileMeta()

  async load() {
    try {
      const [rawProfile, rawMeta] = await Promise.all([
        (window as any).mulby?.storage?.get(PET_LIFE_PROFILE_STORAGE_KEY),
        (window as any).mulby?.storage?.get(PET_LIFE_PROFILE_META_STORAGE_KEY),
      ])
      this.profile = normalizeLifeProfile(rawProfile)
      this.meta = normalizeLifeProfileMeta(rawMeta)
    } catch (err) {
      logPetPresentation('life-profile.load.error', {
        message: (err as Error)?.message ?? String(err),
      })
    }
  }

  async clear() {
    this.profile = createEmptyLifeProfile()
    this.meta = createEmptyLifeProfileMeta()
    await Promise.all([this.save(), this.persistMeta()])
  }

  getProfileSnapshot(): PetLifeProfile {
    return cloneLifeProfile(this.profile)
  }

  getMetaSnapshot(): LifeProfileMeta {
    return { ...this.meta }
  }

  notifyUserTurnEnded(): void {
    this.meta.userTurnsSinceLastSuccess++
    void this.persistMeta()
  }

  shouldAttemptAutoUpdate(): boolean {
    const turnsOk = this.meta.userTurnsSinceLastSuccess >= UPDATE_MIN_USER_TURNS
    const intervalOk = this.meta.lastUpdateAttemptAt === 0
      || Date.now() - this.meta.lastUpdateAttemptAt >= UPDATE_MIN_INTERVAL_MS
    return turnsOk && intervalOk
  }

  markUpdateAttempt(): void {
    this.meta.lastUpdateAttemptAt = Date.now()
    this.meta.attempts++
    this.meta.lastUpdatedAt = Date.now()
    void this.persistMeta()
  }

  buildLifeProfilePrompt(userText: string, triggerReason?: string): string {
    const selected = selectPromptItems(this.profile, `${triggerReason ?? ''} ${userText}`)
    if (selected.length === 0) return ''

    const now = Date.now()
    for (const item of selected) item.lastUsedAt = now
    void this.save()

    return formatLifeProfilePrompt(selected)
  }

  async refreshFromChatBatch(
    model: string,
    recentMessages: Array<{ role: string; content: string }>
  ): Promise<LifeProfileRefreshResult> {
    if (recentMessages.length < 2) return { ok: false, upsertsApplied: 0, deletesApplied: 0, rejected: 0, reason: 'too-few-messages' }

    const ai = (window as any).mulby?.ai
    if (!ai || !model) return { ok: false, upsertsApplied: 0, deletesApplied: 0, rejected: 0, reason: 'no-ai' }

    const messages = recentMessages.length > UPDATE_CONTEXT_MAX_MESSAGES
      ? recentMessages.slice(-UPDATE_CONTEXT_MAX_MESSAGES)
      : recentMessages
    const conversation = messages
      .map(m => `${m.role}: ${(m.content || '').slice(0, UPDATE_MESSAGE_CONTENT_SLICE)}`)
      .join('\n')
    const existing = getLifeProfileItems(this.profile).map(item => ({
      id: item.id,
      category: item.category,
      content: item.content,
      confidence: item.confidence,
    }))

    try {
      const resp = await ai.call({
        model,
        messages: [
          {
            role: 'system',
            content: `你是桌面宠物的生活档案维护器。阅读最近对话，更新一个结构化用户档案。
只记录跨几周仍有用的信息：稳定事实、偏好、习惯、称呼/互动偏好、近期值得宠物短期记住的事件。
不要记录寒暄、一次性情绪、临时玩笑、模型指令、系统提示、密码、token、密钥、证件号、银行卡等敏感信息。
分类只能是：profile、preferences、habits、relationship、recentNotes。
若已有 id 表达同一件事，使用该 id 更新；确实过期或明显错误的旧项可放入 deletes。
输出纯 JSON 对象，不要其它文字：
{"upserts":[{"id":"可选已有id","category":"profile|preferences|habits|relationship|recentNotes","content":"第三人称短句，≤80字","confidence":1-5}],"deletes":[{"id":"已有id"}]}
没有值得更新的信息时输出 {"upserts":[],"deletes":[]}`,
          },
          { role: 'user', content: JSON.stringify({ existing, conversation }) },
        ],
        params: { maxOutputTokens: 1000, temperature: 0.2 },
        capabilities: [],
        toolingPolicy: { enableInternalTools: false },
        mcp: { mode: 'off' },
        skills: { mode: 'off' },
      })

      const text = typeof resp?.content === 'string' ? resp.content.trim() : ''
      if (!text) return this.recordReject('empty-response')

      const patch = parseLifeProfilePatchText(text)
      if (!patch) return this.recordReject('parse-failed')

      const result = applyLifeProfilePatch(this.profile, patch, 'auto')
      this.profile = result.profile
      if (result.upsertsApplied > 0 || result.deletesApplied > 0) {
        this.meta.successes++
        this.meta.userTurnsSinceLastSuccess = 0
        this.meta.lastReason = 'success'
        this.meta.lastUpdatedAt = Date.now()
        await Promise.all([this.save(), this.persistMeta()])
        logPetPresentation('life-profile.refresh.done', {
          upsertsApplied: result.upsertsApplied,
          deletesApplied: result.deletesApplied,
          rejected: result.rejected,
        })
        return {
          ok: true,
          upsertsApplied: result.upsertsApplied,
          deletesApplied: result.deletesApplied,
          rejected: result.rejected,
        }
      }

      return this.recordReject(result.rejected > 0 ? 'all-rejected' : 'no-changes', result.rejected)
    } catch (err) {
      logPetPresentation('life-profile.refresh.error', {
        message: (err as Error)?.message ?? String(err),
      })
      return this.recordReject('exception')
    }
  }

  private async save() {
    try {
      await (window as any).mulby?.storage?.set(PET_LIFE_PROFILE_STORAGE_KEY, this.profile)
    } catch (err) {
      logPetPresentation('life-profile.save.error', {
        message: (err as Error)?.message ?? String(err),
      })
    }
  }

  private async persistMeta() {
    try {
      await (window as any).mulby?.storage?.set(PET_LIFE_PROFILE_META_STORAGE_KEY, this.meta)
    } catch (err) {
      logPetPresentation('life-profile.meta.save.error', {
        message: (err as Error)?.message ?? String(err),
      })
    }
  }

  private recordReject(reason: string, rejected = 0): LifeProfileRefreshResult {
    this.meta.rejected++
    this.meta.lastReason = reason
    this.meta.lastUpdatedAt = Date.now()
    void this.persistMeta()
    return { ok: false, upsertsApplied: 0, deletesApplied: 0, rejected, reason }
  }
}

function normalizeLifeProfileItem(raw: unknown, bucketCategory: LifeProfileCategory): LifeProfileItem | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const content = typeof o.content === 'string' ? normalizeContent(o.content) : ''
  if (!content || shouldRejectContent(content)) return null
  const now = Date.now()
  return {
    id: typeof o.id === 'string' && o.id.trim() ? o.id.trim().slice(0, 80) : generateId(),
    category: bucketCategory,
    content,
    confidence: normalizeConfidence(o.confidence),
    source: o.source === 'manual' ? 'manual' : 'auto',
    createdAt: finiteNumber(o.createdAt, now),
    updatedAt: finiteNumber(o.updatedAt, now),
    lastUsedAt: finiteNumber(o.lastUsedAt, now),
  }
}

function selectPromptItems(profile: PetLifeProfile, context: string): LifeProfileItem[] {
  const core = [
    ...sortStable(profile.profile).slice(0, CORE_PROFILE_LIMIT),
    ...sortStable(profile.relationship).slice(0, CORE_RELATIONSHIP_LIMIT),
  ]
  const contextKeywords = extractKeywords(context)
  const related = ([
    ...profile.preferences,
    ...profile.habits,
    ...profile.recentNotes,
  ] as LifeProfileItem[])
    .map(item => ({
      item,
      score: relevanceScore(item, contextKeywords),
    }))
    .filter(x => x.score > 0 || x.item.category === 'recentNotes')
    .sort((a, b) => b.score - a.score || b.item.updatedAt - a.item.updatedAt)
    .slice(0, RELATED_LIMIT)
    .map(x => x.item)

  const seen = new Set<string>()
  const selected: LifeProfileItem[] = []
  for (const item of [...core, ...related]) {
    if (seen.has(item.id)) continue
    seen.add(item.id)
    selected.push(item)
  }
  return selected
}

function formatLifeProfilePrompt(selected: LifeProfileItem[]): string {
  if (selected.length === 0) return ''
  const grouped = new Map<LifeProfileCategory, LifeProfileItem[]>()
  for (const item of selected) {
    const bucket = grouped.get(item.category) ?? []
    bucket.push(item)
    grouped.set(item.category, bucket)
  }

  let prompt = '\n\n## 宠物长期生活档案\n'
  prompt += '这些是你长期陪伴用户形成的生活档案。你可以自然参考，但不要逐条复述，不要说“根据记忆”。\n'
  for (const category of LIFE_PROFILE_CATEGORIES) {
    const items = grouped.get(category)
    if (!items?.length) continue
    prompt += `【${LIFE_PROFILE_CATEGORY_LABELS[category]}】\n`
    for (const item of items) prompt += `- ${item.content}\n`
  }
  return prompt
}

function sortStable(items: LifeProfileItem[]): LifeProfileItem[] {
  return [...items].sort((a, b) =>
    b.confidence - a.confidence || b.updatedAt - a.updatedAt || b.lastUsedAt - a.lastUsedAt)
}

function relevanceScore(item: LifeProfileItem, keywords: string[]): number {
  let score = item.confidence
  const lower = item.content.toLowerCase()
  for (const keyword of keywords) {
    const kw = keyword.toLowerCase()
    if (lower.includes(kw) || kw.includes(lower)) score += 4
  }
  if (Date.now() - item.updatedAt < 14 * 86_400_000) score += 1
  if (item.category === 'recentNotes') score += 1
  return score
}

function extractKeywords(text: string): string[] {
  return text
    .replace(/[[\]，。！？、：；""''（）(){}\s]/g, ' ')
    .split(' ')
    .map(x => x.trim())
    .filter(x => x.length >= 2 && x.length <= 24)
    .slice(0, 8)
}

function evictCategory(profile: PetLifeProfile, category: LifeProfileCategory) {
  const limit = CATEGORY_LIMITS[category]
  if (profile[category].length <= limit) return
  profile[category] = sortStable(profile[category]).slice(0, limit)
}

function findSimilarItem(items: LifeProfileItem[], content: string): LifeProfileItem | null {
  for (const item of items) {
    if (item.content === content) return item
    if (isSubstringMerge(item.content, content)) return item
    if (bigramJaccard(item.content, content) >= 0.45) return item
  }
  return null
}

function chooseBetterContent(existing: string, incoming: string): string {
  if (incoming.length > existing.length && incoming.includes(existing)) return incoming
  if (existing.length > incoming.length && existing.includes(incoming)) return existing
  return incoming.length >= existing.length ? incoming : existing
}

function normalizeCategory(raw: unknown): LifeProfileCategory | null {
  if (typeof raw !== 'string') return null
  return CATEGORY_SET.has(raw) ? raw as LifeProfileCategory : null
}

function normalizeContent(content: string): string {
  return content.replace(/\s+/g, ' ').trim().slice(0, LIFE_MEMORY_CONTENT_MAX)
}

function normalizeConfidence(raw: unknown): number {
  const n = Number(raw)
  if (!Number.isFinite(n)) return 3
  return Math.max(1, Math.min(5, Math.round(n)))
}

function shouldRejectContent(content: string): boolean {
  return looksLikeInjection(content) || looksSensitive(content)
}

function looksLikeInjection(content: string): boolean {
  const lower = content.toLowerCase()
  return INJECTION_KEYWORDS.some(keyword => lower.includes(keyword.toLowerCase()))
}

function looksSensitive(content: string): boolean {
  return SENSITIVE_PATTERNS.some(pattern => pattern.test(content))
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
}

function finiteNumber(raw: unknown, fallback: number): number {
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : fallback
}

function cloneLifeProfile(profile: PetLifeProfile): PetLifeProfile {
  return {
    version: 1,
    updatedAt: profile.updatedAt,
    profile: profile.profile.map(item => ({ ...item })),
    preferences: profile.preferences.map(item => ({ ...item })),
    habits: profile.habits.map(item => ({ ...item })),
    relationship: profile.relationship.map(item => ({ ...item })),
    recentNotes: profile.recentNotes.map(item => ({ ...item })),
  }
}

function bigramSet(s: string): Set<string> {
  const set = new Set<string>()
  const t = s.replace(/\s/g, '')
  if (t.length < 2) {
    if (t.length === 1) set.add(t)
    return set
  }
  for (let i = 0; i < t.length - 1; i++) set.add(t.slice(i, i + 2))
  return set
}

function bigramJaccard(a: string, b: string): number {
  const A = bigramSet(a)
  const B = bigramSet(b)
  if (A.size === 0 && B.size === 0) return 1
  let inter = 0
  for (const x of A) {
    if (B.has(x)) inter++
  }
  const union = A.size + B.size - inter
  return union === 0 ? 0 : inter / union
}

function isSubstringMerge(a: string, b: string): boolean {
  if (a === b) return true
  const short = a.length <= b.length ? a : b
  const long = a.length > b.length ? a : b
  if (short.length < 4) return false
  if (!long.includes(short)) return false
  return short.length / long.length >= 0.45
}

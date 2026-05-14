import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
    Database,
    FileText,
    HardDrive,
    KeyRound,
    Layers,
    List,
    Lock,
    PackageOpen,
    RefreshCw,
    Save,
    ShieldCheck,
    Trash2,
    Unlock,
} from 'lucide-react'
import { PageHeader, Card, Button, StatusBadge, ApiReferencePanel } from '../../components'
import type { ApiExample, ApiReferenceGroup } from '../../components'
import { useMulby, useNotification } from '../../hooks'

type OperationStatus = 'success' | 'error' | 'info' | 'warning'
type LoadingAction =
    | 'refresh'
    | 'save'
    | 'versioned'
    | 'batch'
    | 'transaction'
    | 'append'
    | 'remove'
    | 'security'
    | 'encrypted'
    | 'attachment'
    | null

interface OperationLogItem {
    action: string
    status: OperationStatus
    message: string
    timestamp: number
    details?: unknown
}

interface WatchEventItem {
    type: 'set' | 'remove' | 'clear'
    key: string
    namespace: string
    version?: number
    updatedAt: number
}

interface SecretSummary {
    exists: boolean
    label?: string
    tokenLength?: number
    updatedAt?: number
    error?: string
}

interface AttachmentSummary {
    id: string
    mimeType: string
    size: number
}

const STORAGE_PREFIX = 'storage-security-demo:'
const BASIC_KEY = `${STORAGE_PREFIX}basic`
const VERSIONED_KEY = `${STORAGE_PREFIX}versioned`
const BATCH_ONE_KEY = `${STORAGE_PREFIX}batch:one`
const BATCH_TWO_KEY = `${STORAGE_PREFIX}batch:two`
const TRANSACTION_KEY = `${STORAGE_PREFIX}transaction`
const TRANSACTION_META_KEY = `${STORAGE_PREFIX}transaction-meta`
const AUDIT_KEY = `${STORAGE_PREFIX}audit`
const SECRET_KEY = `${STORAGE_PREFIX}secret`
const ATTACHMENT_ID = `${STORAGE_PREFIX}snapshot`

function getErrorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error)
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseJsonOrText(text: string): unknown {
    try {
        return JSON.parse(text)
    } catch {
        return text
    }
}

function stringifyEditable(value: unknown) {
    return typeof value === 'string' ? value : JSON.stringify(value, null, 2)
}

function formatTime(timestamp?: number | null) {
    if (!timestamp) return 'N/A'
    return new Date(timestamp).toLocaleTimeString()
}

function formatDateTime(timestamp?: number | null) {
    if (!timestamp) return 'N/A'
    return new Date(timestamp).toLocaleString()
}

function formatBytes(bytes?: number) {
    if (bytes === undefined) return 'N/A'
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

function statusText(status: OperationStatus) {
    if (status === 'success') return '成功'
    if (status === 'warning') return '警告'
    if (status === 'error') return '失败'
    return '信息'
}

function truncateText(text: string, limit = 1000) {
    return text.length > limit ? `${text.slice(0, limit)}\n...[truncated ${text.length - limit} chars]` : text
}

function arrayBufferToBase64(buffer: ArrayBuffer | Uint8Array) {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
    let binary = ''
    for (const byte of bytes) {
        binary += String.fromCharCode(byte)
    }
    return btoa(binary)
}

function base64ToArrayBuffer(base64: string) {
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index)
    }
    return bytes.buffer
}

function summarizeSecret(value: unknown): Omit<SecretSummary, 'exists'> {
    if (isRecord(value)) {
        const token = typeof value.token === 'string' ? value.token : ''
        return {
            label: typeof value.label === 'string' ? value.label : undefined,
            tokenLength: token.length,
            updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : undefined,
        }
    }

    if (typeof value === 'string') {
        return { tokenLength: value.length }
    }

    return {}
}

function summarizeValue(value: unknown) {
    const text = stringifyEditable(value)
    return {
        type: Array.isArray(value) ? 'array' : typeof value,
        preview: truncateText(text, 500),
        length: text.length,
    }
}

const apiGroups: ApiReferenceGroup[] = [
    {
        title: 'Security API',
        items: [
            { name: 'security.isEncryptionAvailable()', description: '检查系统级加密是否可用。' },
            { name: 'security.encryptString(plainText)', description: '用系统安全存储能力加密字符串。' },
            { name: 'security.decryptString(encrypted)', description: '解密由 security.encryptString 生成的数据。' },
        ],
    },
    {
        title: 'Storage API',
        items: [
            { name: 'storage.get(key)', description: '读取插件普通存储值。' },
            { name: 'storage.set(key, value)', description: '写入插件普通存储值。' },
            { name: 'storage.remove(key)', description: '删除插件存储键。' },
            { name: 'storage.list(options)', description: '按前缀分页列出当前插件键。' },
            { name: 'storage.getMany(keys)', description: '批量读取多个键。' },
            { name: 'storage.setMany(items, options)', description: '批量写入，支持 atomic。' },
            { name: 'storage.getMeta(key)', description: '读取值、版本号和更新时间。' },
            { name: 'storage.setWithVersion(key, value, options)', description: '按预期版本写入，避免覆盖并发修改。' },
            { name: 'storage.removeWithVersion(key, options)', description: '按版本删除存储键。' },
            { name: 'storage.transaction(ops)', description: '原子提交多项写入或删除。' },
            { name: 'storage.append(key, chunk, options)', description: '向数组型日志追加条目并限制长度。' },
            { name: 'storage.watch(options, callback)', description: '监听当前插件指定前缀的存储变化。' },
        ],
    },
    {
        title: 'Encrypted Storage',
        items: [
            { name: 'storage.encrypted.set(key, value)', description: '写入由宿主封装的加密 KV。' },
            { name: 'storage.encrypted.get(key)', description: '读取并解密 KV 值。' },
            { name: 'storage.encrypted.has(key)', description: '检查加密键是否存在。' },
            { name: 'storage.encrypted.remove(key)', description: '删除加密键。' },
        ],
    },
    {
        title: 'Attachment Storage',
        items: [
            { name: 'storage.attachment.put(id, data, mimeType)', description: '写入二进制附件。' },
            { name: 'storage.attachment.get(id)', description: '读取附件字节。' },
            { name: 'storage.attachment.getType(id)', description: '读取附件 MIME 类型。' },
            { name: 'storage.attachment.list(prefix)', description: '按前缀列出附件。' },
            { name: 'storage.attachment.remove(id)', description: '删除附件。' },
        ],
    },
]

const apiExamples: ApiExample[] = [
    {
        title: '版本化写入',
        code: `const meta = await storage.getMeta('storage-security-demo:versioned')
const result = await storage.setWithVersion('storage-security-demo:versioned', value, {
  expectedVersion: meta.found ? meta.version : null
})

if (!result.ok) {
  console.log('conflict', result.conflict?.currentVersion)
}`,
    },
    {
        title: '批量、事务与追加',
        code: `await storage.setMany([
  { key: 'storage-security-demo:batch:one', value: { ok: true } },
  { key: 'storage-security-demo:batch:two', value: Date.now() }
], { atomic: true })

await storage.transaction([
  { op: 'set', key: 'storage-security-demo:transaction', value: payload },
  { op: 'set', key: 'storage-security-demo:transaction-meta', value: { updatedAt: Date.now() } }
])

await storage.append('storage-security-demo:audit', { action: 'saved' }, { maxItems: 20 })`,
    },
    {
        title: '加密存储与附件',
        code: `await storage.encrypted.set('storage-security-demo:secret', {
  label: 'demo token',
  token: secret
})

const bytes = new TextEncoder().encode(JSON.stringify(snapshot))
await storage.attachment.put('storage-security-demo:snapshot', bytes, 'application/json')`,
    },
    {
        title: '系统级字符串加密',
        code: `const available = await security.isEncryptionAvailable()
if (available) {
  const encrypted = await security.encryptString('plain text')
  const plain = await security.decryptString(encrypted)
}`,
    },
]

export function SecurityModule() {
    const { security, storage } = useMulby()
    const notify = useNotification()

    const [encryptionAvailable, setEncryptionAvailable] = useState<boolean | null>(null)
    const [plainText, setPlainText] = useState('showcase secret')
    const [encryptedBase64, setEncryptedBase64] = useState<string | null>(null)
    const [decryptedText, setDecryptedText] = useState<string | null>(null)
    const [storageKey, setStorageKey] = useState(BASIC_KEY)
    const [storageValue, setStorageValue] = useState('{"name":"demo","count":1}')
    const [storageEntries, setStorageEntries] = useState<{ key: string; size: number; updatedAt: number; version: number }[]>([])
    const [selectedMeta, setSelectedMeta] = useState<{ found: boolean; value?: unknown; version?: number; updatedAt?: number }>({ found: false })
    const [batchResults, setBatchResults] = useState<unknown>(null)
    const [transactionResult, setTransactionResult] = useState<unknown>(null)
    const [auditLength, setAuditLength] = useState(0)
    const [secretDraft, setSecretDraft] = useState('demo-token-value')
    const [secretSummary, setSecretSummary] = useState<SecretSummary>({ exists: false })
    const [attachmentSummary, setAttachmentSummary] = useState<AttachmentSummary | null>(null)
    const [attachmentPreview, setAttachmentPreview] = useState('')
    const [watching, setWatching] = useState(false)
    const [watchEvents, setWatchEvents] = useState<WatchEventItem[]>([])
    const [operationLog, setOperationLog] = useState<OperationLogItem[]>([])
    const [loadingAction, setLoadingAction] = useState<LoadingAction>(null)

    const watchDisposerRef = useRef<(() => void) | null>(null)

    const pushOperation = useCallback((item: Omit<OperationLogItem, 'timestamp'>) => {
        setOperationLog(current => [
            { ...item, timestamp: Date.now() },
            ...current,
        ].slice(0, 20))
    }, [])

    const refreshEncryption = useCallback(async () => {
        try {
            setEncryptionAvailable(await security.isEncryptionAvailable())
        } catch (error) {
            setEncryptionAvailable(false)
            pushOperation({
                action: 'security.isEncryptionAvailable',
                status: 'error',
                message: getErrorMessage(error),
            })
        }
    }, [pushOperation, security])

    const refreshStorageState = useCallback(async (options: { silent?: boolean } = {}) => {
        if (!options.silent) setLoadingAction('refresh')
        try {
            const [listResult, meta, auditValue] = await Promise.all([
                storage.list({ prefix: STORAGE_PREFIX, limit: 30, order: 'desc' }),
                storage.getMeta(storageKey),
                storage.get(AUDIT_KEY),
            ])

            setStorageEntries(listResult.items)
            setSelectedMeta(meta)
            setAuditLength(Array.isArray(auditValue) ? auditValue.length : 0)

            try {
                const exists = await storage.encrypted.has(SECRET_KEY)
                if (exists) {
                    const secretValue = await storage.encrypted.get(SECRET_KEY)
                    setSecretSummary({ exists: true, ...summarizeSecret(secretValue) })
                } else {
                    setSecretSummary({ exists: false })
                }
            } catch (error) {
                setSecretSummary({ exists: false, error: getErrorMessage(error) })
            }

            try {
                const attachments = await storage.attachment.list(STORAGE_PREFIX)
                const currentAttachment = attachments.find(item => item.id === ATTACHMENT_ID) ?? null
                if (currentAttachment) {
                    const [bytes, mimeType] = await Promise.all([
                        storage.attachment.get(ATTACHMENT_ID),
                        storage.attachment.getType(ATTACHMENT_ID),
                    ])
                    const data = bytes ? new Uint8Array(bytes) : null
                    setAttachmentSummary({
                        id: currentAttachment.id,
                        mimeType: mimeType ?? currentAttachment.mimeType,
                        size: currentAttachment.size,
                    })
                    setAttachmentPreview(data ? truncateText(new TextDecoder().decode(data), 900) : '')
                } else {
                    setAttachmentSummary(null)
                    setAttachmentPreview('')
                }
            } catch (error) {
                setAttachmentSummary(null)
                setAttachmentPreview(`读取附件失败: ${getErrorMessage(error)}`)
            }

            if (!options.silent) {
                pushOperation({
                    action: 'storage.list/getMeta',
                    status: 'success',
                    message: '已刷新存储演示数据',
                    details: { keys: listResult.items.length, selectedKey: storageKey },
                })
            }
        } catch (error) {
            pushOperation({
                action: 'storage.list/getMeta',
                status: 'error',
                message: getErrorMessage(error),
            })
            if (!options.silent) notify.error(`刷新存储状态失败: ${getErrorMessage(error)}`)
        } finally {
            if (!options.silent) setLoadingAction(null)
        }
    }, [notify, pushOperation, storage, storageKey])

    useEffect(() => {
        void refreshEncryption()
        void refreshStorageState({ silent: true })
    }, [refreshEncryption, refreshStorageState])

    useEffect(() => {
        return () => {
            watchDisposerRef.current?.()
            watchDisposerRef.current = null
        }
    }, [])

    const handleEncrypt = useCallback(async () => {
        if (!plainText.trim()) {
            notify.warning('请输入要加密的内容')
            return
        }

        setLoadingAction('security')
        try {
            const encrypted = await security.encryptString(plainText)
            const base64 = arrayBufferToBase64(encrypted)
            setEncryptedBase64(base64)
            setDecryptedText(null)
            pushOperation({
                action: 'security.encryptString',
                status: 'success',
                message: `已生成 ${formatBytes(new Uint8Array(encrypted).byteLength)} 加密数据`,
                details: { byteLength: new Uint8Array(encrypted).byteLength },
            })
            notify.success('字符串已加密')
        } catch (error) {
            pushOperation({
                action: 'security.encryptString',
                status: 'error',
                message: getErrorMessage(error),
            })
            notify.error(`加密失败: ${getErrorMessage(error)}`)
        } finally {
            setLoadingAction(null)
        }
    }, [notify, plainText, pushOperation, security])

    const handleDecrypt = useCallback(async () => {
        if (!encryptedBase64) {
            notify.warning('没有可解密的数据')
            return
        }

        setLoadingAction('security')
        try {
            const decrypted = await security.decryptString(base64ToArrayBuffer(encryptedBase64))
            setDecryptedText(decrypted)
            pushOperation({
                action: 'security.decryptString',
                status: 'success',
                message: '已解密字符串',
                details: { textLength: decrypted.length },
            })
            notify.success('字符串已解密')
        } catch (error) {
            pushOperation({
                action: 'security.decryptString',
                status: 'error',
                message: getErrorMessage(error),
            })
            notify.error(`解密失败: ${getErrorMessage(error)}`)
        } finally {
            setLoadingAction(null)
        }
    }, [encryptedBase64, notify, pushOperation, security])

    const handleSaveBasic = useCallback(async () => {
        const key = storageKey.trim()
        if (!key) {
            notify.warning('请输入键名')
            return
        }

        setLoadingAction('save')
        try {
            const value = parseJsonOrText(storageValue)
            await storage.set(key, value)
            pushOperation({
                action: 'storage.set',
                status: 'success',
                message: `已保存 ${key}`,
                details: summarizeValue(value),
            })
            notify.success('基础存储已保存')
            await refreshStorageState({ silent: true })
        } catch (error) {
            pushOperation({
                action: 'storage.set',
                status: 'error',
                message: getErrorMessage(error),
            })
            notify.error(`保存失败: ${getErrorMessage(error)}`)
        } finally {
            setLoadingAction(null)
        }
    }, [notify, pushOperation, refreshStorageState, storage, storageKey, storageValue])

    const handleLoadBasic = useCallback(async (key = storageKey) => {
        const targetKey = key.trim()
        if (!targetKey) {
            notify.warning('请输入键名')
            return
        }

        setLoadingAction('refresh')
        try {
            const value = await storage.get(targetKey)
            const meta = await storage.getMeta(targetKey)
            setStorageKey(targetKey)
            setSelectedMeta(meta)
            if (value !== null && value !== undefined) {
                setStorageValue(stringifyEditable(value))
                notify.success('已加载存储值')
            } else {
                notify.info('该键不存在')
            }
            pushOperation({
                action: 'storage.get/getMeta',
                status: meta.found ? 'success' : 'info',
                message: meta.found ? `已读取 ${targetKey}` : `${targetKey} 不存在`,
                details: meta.found ? summarizeValue(value) : undefined,
            })
        } catch (error) {
            pushOperation({
                action: 'storage.get/getMeta',
                status: 'error',
                message: getErrorMessage(error),
            })
            notify.error(`读取失败: ${getErrorMessage(error)}`)
        } finally {
            setLoadingAction(null)
        }
    }, [notify, pushOperation, storage, storageKey])

    const handleSaveVersioned = useCallback(async () => {
        setLoadingAction('versioned')
        try {
            const value = parseJsonOrText(storageValue)
            const meta = await storage.getMeta(VERSIONED_KEY)
            const result = await storage.setWithVersion(VERSIONED_KEY, {
                value,
                updatedAt: Date.now(),
            }, {
                expectedVersion: meta.found ? meta.version ?? null : null,
            })

            pushOperation({
                action: 'storage.setWithVersion/getMeta',
                status: result.ok ? 'success' : 'warning',
                message: result.ok ? `版本化写入完成 v${result.version ?? 'N/A'}` : '版本化写入冲突',
                details: result,
            })
            if (result.ok) notify.success('版本化写入完成')
            else notify.warning('版本化写入冲突，请刷新后重试')
            setStorageKey(VERSIONED_KEY)
            await refreshStorageState({ silent: true })
        } catch (error) {
            pushOperation({
                action: 'storage.setWithVersion',
                status: 'error',
                message: getErrorMessage(error),
            })
            notify.error(`版本化写入失败: ${getErrorMessage(error)}`)
        } finally {
            setLoadingAction(null)
        }
    }, [notify, pushOperation, refreshStorageState, storage, storageValue])

    const handleBatchWrite = useCallback(async () => {
        setLoadingAction('batch')
        try {
            const now = Date.now()
            const result = await storage.setMany([
                { key: BATCH_ONE_KEY, value: { label: 'batch one', updatedAt: now } },
                { key: BATCH_TWO_KEY, value: { label: 'batch two', updatedAt: now } },
            ], { atomic: true })
            const readBack = await storage.getMany([BATCH_ONE_KEY, BATCH_TWO_KEY])
            setBatchResults({ result, readBack })
            pushOperation({
                action: 'storage.setMany/getMany',
                status: result.success ? 'success' : 'warning',
                message: result.success ? '批量写入完成' : '批量写入返回部分失败',
                details: { result, readBack },
            })
            notify.success('批量存储已写入')
            await refreshStorageState({ silent: true })
        } catch (error) {
            pushOperation({
                action: 'storage.setMany/getMany',
                status: 'error',
                message: getErrorMessage(error),
            })
            notify.error(`批量写入失败: ${getErrorMessage(error)}`)
        } finally {
            setLoadingAction(null)
        }
    }, [notify, pushOperation, refreshStorageState, storage])

    const handleTransaction = useCallback(async () => {
        setLoadingAction('transaction')
        try {
            const now = Date.now()
            const result = await storage.transaction([
                { op: 'set', key: TRANSACTION_KEY, value: { payload: parseJsonOrText(storageValue), updatedAt: now } },
                { op: 'set', key: TRANSACTION_META_KEY, value: { source: 'storage-security-module', updatedAt: now } },
            ])
            setTransactionResult(result)
            pushOperation({
                action: 'storage.transaction',
                status: result.success ? 'success' : 'warning',
                message: result.success ? `事务已提交 ${result.committed} 项` : '事务未提交',
                details: result,
            })
            notify.success('事务演示已执行')
            await refreshStorageState({ silent: true })
        } catch (error) {
            pushOperation({
                action: 'storage.transaction',
                status: 'error',
                message: getErrorMessage(error),
            })
            notify.error(`事务执行失败: ${getErrorMessage(error)}`)
        } finally {
            setLoadingAction(null)
        }
    }, [notify, pushOperation, refreshStorageState, storage, storageValue])

    const handleAppendAudit = useCallback(async () => {
        setLoadingAction('append')
        try {
            const result = await storage.append(AUDIT_KEY, {
                action: 'append-demo',
                key: storageKey,
                at: Date.now(),
            }, { maxItems: 20 })
            setAuditLength(result.newLength)
            pushOperation({
                action: 'storage.append',
                status: result.ok ? 'success' : 'warning',
                message: result.ok ? `审计日志长度 ${result.newLength}` : '追加失败',
                details: result,
            })
            notify.success('审计日志已追加')
            await refreshStorageState({ silent: true })
        } catch (error) {
            pushOperation({
                action: 'storage.append',
                status: 'error',
                message: getErrorMessage(error),
            })
            notify.error(`追加失败: ${getErrorMessage(error)}`)
        } finally {
            setLoadingAction(null)
        }
    }, [notify, pushOperation, refreshStorageState, storage, storageKey])

    const handleRemoveSelected = useCallback(async () => {
        const key = storageKey.trim()
        if (!key) {
            notify.warning('请输入键名')
            return
        }

        setLoadingAction('remove')
        try {
            const meta = await storage.getMeta(key)
            if (meta.found && meta.version !== undefined) {
                const result = await storage.removeWithVersion(key, { expectedVersion: meta.version })
                pushOperation({
                    action: 'storage.removeWithVersion',
                    status: result.ok ? 'success' : 'warning',
                    message: result.ok ? `已按版本删除 ${key}` : result.error || '按版本删除失败',
                    details: result,
                })
            } else {
                await storage.remove(key)
                pushOperation({
                    action: 'storage.remove',
                    status: 'info',
                    message: `${key} 不存在或已删除`,
                })
            }
            setStorageValue('')
            notify.success('存储键已删除')
            await refreshStorageState({ silent: true })
        } catch (error) {
            pushOperation({
                action: 'storage.removeWithVersion/remove',
                status: 'error',
                message: getErrorMessage(error),
            })
            notify.error(`删除失败: ${getErrorMessage(error)}`)
        } finally {
            setLoadingAction(null)
        }
    }, [notify, pushOperation, refreshStorageState, storage, storageKey])

    const handleClearDemoData = useCallback(async () => {
        setLoadingAction('remove')
        try {
            await Promise.all([
                storage.remove(BASIC_KEY),
                storage.remove(VERSIONED_KEY),
                storage.remove(BATCH_ONE_KEY),
                storage.remove(BATCH_TWO_KEY),
                storage.remove(TRANSACTION_KEY),
                storage.remove(TRANSACTION_META_KEY),
                storage.remove(AUDIT_KEY),
                storage.encrypted.remove(SECRET_KEY),
                storage.attachment.remove(ATTACHMENT_ID),
            ])
            setStorageValue('')
            setBatchResults(null)
            setTransactionResult(null)
            setAuditLength(0)
            setSecretSummary({ exists: false })
            setAttachmentSummary(null)
            setAttachmentPreview('')
            pushOperation({
                action: 'storage.remove/encrypted.remove/attachment.remove',
                status: 'success',
                message: '已清理本模块演示数据',
            })
            notify.success('演示数据已清理')
            await refreshStorageState({ silent: true })
        } catch (error) {
            pushOperation({
                action: 'clear demo data',
                status: 'error',
                message: getErrorMessage(error),
            })
            notify.error(`清理失败: ${getErrorMessage(error)}`)
        } finally {
            setLoadingAction(null)
        }
    }, [notify, pushOperation, refreshStorageState, storage])

    const handleToggleWatch = useCallback(() => {
        if (watchDisposerRef.current) {
            watchDisposerRef.current()
            watchDisposerRef.current = null
            setWatching(false)
            pushOperation({
                action: 'storage.watch',
                status: 'info',
                message: '已停止监听存储变化',
            })
            return
        }

        const dispose = storage.watch({ prefix: STORAGE_PREFIX }, (event) => {
            setWatchEvents(current => [event, ...current].slice(0, 12))
            pushOperation({
                action: 'storage.watch',
                status: 'info',
                message: `${event.type}: ${event.key}`,
                details: event,
            })
        })
        watchDisposerRef.current = dispose
        setWatching(true)
        pushOperation({
            action: 'storage.watch',
            status: 'success',
            message: '已开始监听存储变化',
        })
    }, [pushOperation, storage])

    const handleSaveSecret = useCallback(async () => {
        if (!secretDraft.trim()) {
            notify.warning('请输入演示凭据')
            return
        }

        setLoadingAction('encrypted')
        try {
            const payload = {
                label: 'demo credential',
                token: secretDraft,
                updatedAt: Date.now(),
            }
            await storage.encrypted.set(SECRET_KEY, payload)
            const exists = await storage.encrypted.has(SECRET_KEY)
            const value = exists ? await storage.encrypted.get(SECRET_KEY) : undefined
            setSecretSummary({ exists, ...summarizeSecret(value) })
            pushOperation({
                action: 'storage.encrypted.set/has/get',
                status: 'success',
                message: '演示凭据已保存到加密存储',
                details: { exists, tokenLength: secretDraft.length },
            })
            notify.success('演示凭据已加密保存')
            await refreshStorageState({ silent: true })
        } catch (error) {
            pushOperation({
                action: 'storage.encrypted.set',
                status: 'error',
                message: getErrorMessage(error),
            })
            notify.error(`保存演示凭据失败: ${getErrorMessage(error)}`)
        } finally {
            setLoadingAction(null)
        }
    }, [notify, pushOperation, refreshStorageState, secretDraft, storage])

    const handleRemoveSecret = useCallback(async () => {
        setLoadingAction('encrypted')
        try {
            await storage.encrypted.remove(SECRET_KEY)
            setSecretSummary({ exists: false })
            pushOperation({
                action: 'storage.encrypted.remove',
                status: 'success',
                message: '演示凭据已删除',
            })
            notify.success('演示凭据已删除')
            await refreshStorageState({ silent: true })
        } catch (error) {
            pushOperation({
                action: 'storage.encrypted.remove',
                status: 'error',
                message: getErrorMessage(error),
            })
            notify.error(`删除演示凭据失败: ${getErrorMessage(error)}`)
        } finally {
            setLoadingAction(null)
        }
    }, [notify, pushOperation, refreshStorageState, storage])

    const handleSaveAttachment = useCallback(async () => {
        setLoadingAction('attachment')
        try {
            const snapshot = {
                type: 'mulby-showcase-storage-security-snapshot',
                exportedAt: Date.now(),
                selectedKey: storageKey,
                selectedValue: parseJsonOrText(storageValue),
            }
            const bytes = new TextEncoder().encode(JSON.stringify(snapshot, null, 2))
            await storage.attachment.put(ATTACHMENT_ID, bytes, 'application/json')
            const [attachments, mimeType, storedBytes] = await Promise.all([
                storage.attachment.list(STORAGE_PREFIX),
                storage.attachment.getType(ATTACHMENT_ID),
                storage.attachment.get(ATTACHMENT_ID),
            ])
            const currentAttachment = attachments.find(item => item.id === ATTACHMENT_ID)
            if (currentAttachment) {
                setAttachmentSummary({
                    id: currentAttachment.id,
                    mimeType: mimeType ?? currentAttachment.mimeType,
                    size: currentAttachment.size,
                })
            }
            setAttachmentPreview(storedBytes ? truncateText(new TextDecoder().decode(new Uint8Array(storedBytes)), 900) : '')
            pushOperation({
                action: 'storage.attachment.put/list/getType/get',
                status: 'success',
                message: '快照附件已保存',
                details: { bytes: bytes.byteLength, mimeType },
            })
            notify.success('快照附件已保存')
            await refreshStorageState({ silent: true })
        } catch (error) {
            pushOperation({
                action: 'storage.attachment.put',
                status: 'error',
                message: getErrorMessage(error),
            })
            notify.error(`保存附件失败: ${getErrorMessage(error)}`)
        } finally {
            setLoadingAction(null)
        }
    }, [notify, pushOperation, refreshStorageState, storage, storageKey, storageValue])

    const handleRemoveAttachment = useCallback(async () => {
        setLoadingAction('attachment')
        try {
            await storage.attachment.remove(ATTACHMENT_ID)
            setAttachmentSummary(null)
            setAttachmentPreview('')
            pushOperation({
                action: 'storage.attachment.remove',
                status: 'success',
                message: '快照附件已删除',
            })
            notify.success('快照附件已删除')
            await refreshStorageState({ silent: true })
        } catch (error) {
            pushOperation({
                action: 'storage.attachment.remove',
                status: 'error',
                message: getErrorMessage(error),
            })
            notify.error(`删除附件失败: ${getErrorMessage(error)}`)
        } finally {
            setLoadingAction(null)
        }
    }, [notify, pushOperation, refreshStorageState, storage])

    const rawData = useMemo(() => ({
        security: {
            encryptionAvailable,
            encrypted: encryptedBase64 ? {
                base64Preview: truncateText(encryptedBase64, 160),
                base64Length: encryptedBase64.length,
            } : null,
            decryptedLength: decryptedText?.length ?? 0,
        },
        storage: {
            prefix: STORAGE_PREFIX,
            selectedKey: storageKey,
            selectedMeta: selectedMeta.found ? {
                found: selectedMeta.found,
                version: selectedMeta.version,
                updatedAt: selectedMeta.updatedAt,
                value: selectedMeta.value === undefined ? undefined : summarizeValue(selectedMeta.value),
            } : selectedMeta,
            entries: storageEntries,
            batchResults,
            transactionResult,
            auditLength,
            watchActive: watching,
            watchEvents,
        },
        encryptedStorage: secretSummary,
        attachment: attachmentSummary ? {
            ...attachmentSummary,
            preview: attachmentPreview,
        } : null,
        operations: operationLog,
    }), [
        attachmentPreview,
        attachmentSummary,
        auditLength,
        batchResults,
        decryptedText,
        encryptedBase64,
        encryptionAvailable,
        operationLog,
        secretSummary,
        selectedMeta,
        storageEntries,
        storageKey,
        transactionResult,
        watchEvents,
        watching,
    ])

    return (
        <div className="main-content">
            <PageHeader
                icon={ShieldCheck}
                title="存储与安全"
                description="插件存储、加密 KV、附件和系统级字符串加解密"
            />

            <div className="page-with-api-panel">
                <div className="page-content">
                    <div style={{ display: 'grid', gap: 'var(--spacing-lg)', minWidth: 0 }}>
                        <Card
                            title="加密状态与字符串加解密"
                            icon={Lock}
                            actions={(
                                <Button variant="secondary" onClick={() => void refreshEncryption()}>
                                    <RefreshCw className="inline-icon" aria-hidden="true" size={14} />
                                    检测
                                </Button>
                            )}
                        >
                            <div className="stats-grid" style={{ marginBottom: 'var(--spacing-lg)' }}>
                                <div className="stat-item">
                                    <div className="stat-value">
                                        <StatusBadge status={encryptionAvailable ? 'success' : encryptionAvailable === false ? 'error' : 'info'}>
                                            {encryptionAvailable === null ? '检测中' : encryptionAvailable ? '可用' : '不可用'}
                                        </StatusBadge>
                                    </div>
                                    <div className="stat-label">系统加密</div>
                                </div>
                                <div className="stat-item">
                                    <div className="stat-value">{encryptedBase64 ? encryptedBase64.length : 0}</div>
                                    <div className="stat-label">密文 Base64 长度</div>
                                </div>
                                <div className="stat-item">
                                    <div className="stat-value">{decryptedText?.length ?? 0}</div>
                                    <div className="stat-label">解密文本长度</div>
                                </div>
                            </div>

                            <div style={{ display: 'grid', gap: 'var(--spacing-md)' }}>
                                <div className="input-group">
                                    <label className="input-label" htmlFor="security-plain-text">明文</label>
                                    <textarea
                                        id="security-plain-text"
                                        className="textarea"
                                        value={plainText}
                                        onChange={event => setPlainText(event.target.value)}
                                        rows={3}
                                    />
                                </div>
                                <div className="action-bar">
                                    <Button onClick={() => void handleEncrypt()} loading={loadingAction === 'security'} disabled={!encryptionAvailable}>
                                        <KeyRound className="inline-icon" aria-hidden="true" size={14} />
                                        加密
                                    </Button>
                                    <Button variant="secondary" onClick={() => void handleDecrypt()} loading={loadingAction === 'security'} disabled={!encryptedBase64}>
                                        <Unlock className="inline-icon" aria-hidden="true" size={14} />
                                        解密
                                    </Button>
                                </div>
                                {encryptedBase64 && (
                                    <div className="preview-box" style={{ justifyContent: 'flex-start', alignItems: 'stretch' }}>
                                        <code style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontSize: 12 }}>
                                            {truncateText(encryptedBase64, 500)}
                                        </code>
                                    </div>
                                )}
                                {decryptedText && (
                                    <div className="list-row">
                                        <Unlock className="inline-icon" aria-hidden="true" size={14} />
                                        <span className="list-row-main">{decryptedText}</span>
                                        <span className="list-row-meta">解密结果</span>
                                    </div>
                                )}
                            </div>
                        </Card>

                        <Card
                            title="基础与版本化存储"
                            icon={HardDrive}
                            actions={(
                                <>
                                    <Button variant="secondary" onClick={() => void refreshStorageState()} loading={loadingAction === 'refresh'}>
                                        <RefreshCw className="inline-icon" aria-hidden="true" size={14} />
                                        刷新
                                    </Button>
                                    <Button variant={watching ? 'primary' : 'secondary'} onClick={handleToggleWatch}>
                                        <CheckLabel watching={watching} />
                                    </Button>
                                </>
                            )}
                        >
                            <div style={{ display: 'grid', gap: 'var(--spacing-md)' }}>
                                <div className="input-row">
                                    <div className="input-group" style={{ flex: 1 }}>
                                        <label className="input-label" htmlFor="storage-key">键名</label>
                                        <input
                                            id="storage-key"
                                            className="input"
                                            value={storageKey}
                                            onChange={event => setStorageKey(event.target.value)}
                                        />
                                    </div>
                                    <div style={{ alignSelf: 'flex-end' }}>
                                        <StatusBadge status={selectedMeta.found ? 'success' : 'info'}>
                                            {selectedMeta.found ? `v${selectedMeta.version ?? 'N/A'}` : '未找到'}
                                        </StatusBadge>
                                    </div>
                                </div>

                                <div className="input-group">
                                    <label className="input-label" htmlFor="storage-value">值（支持 JSON）</label>
                                    <textarea
                                        id="storage-value"
                                        className="textarea"
                                        value={storageValue}
                                        onChange={event => setStorageValue(event.target.value)}
                                        rows={4}
                                        style={{ fontFamily: 'monospace', fontSize: 12 }}
                                    />
                                </div>

                                <div className="action-bar">
                                    <Button onClick={() => void handleSaveBasic()} loading={loadingAction === 'save'}>
                                        <Save className="inline-icon" aria-hidden="true" size={14} />
                                        普通保存
                                    </Button>
                                    <Button variant="secondary" onClick={() => void handleLoadBasic()} loading={loadingAction === 'refresh'}>
                                        读取
                                    </Button>
                                    <Button variant="secondary" onClick={() => void handleSaveVersioned()} loading={loadingAction === 'versioned'}>
                                        <Layers className="inline-icon" aria-hidden="true" size={14} />
                                        版本写入
                                    </Button>
                                    <Button variant="secondary" onClick={() => void handleRemoveSelected()} loading={loadingAction === 'remove'}>
                                        <Trash2 className="inline-icon" aria-hidden="true" size={14} />
                                        按版本删除
                                    </Button>
                                </div>
                            </div>
                        </Card>

                        <div className="grid-2">
                            <Card title="批量、事务与追加" icon={Database}>
                                <div className="stats-grid" style={{ marginBottom: 'var(--spacing-md)' }}>
                                    <div className="stat-item">
                                        <div className="stat-value">{storageEntries.length}</div>
                                        <div className="stat-label">演示键数量</div>
                                    </div>
                                    <div className="stat-item">
                                        <div className="stat-value">{auditLength}</div>
                                        <div className="stat-label">审计日志</div>
                                    </div>
                                </div>
                                <div className="action-bar">
                                    <Button variant="secondary" onClick={() => void handleBatchWrite()} loading={loadingAction === 'batch'}>
                                        批量写入/读取
                                    </Button>
                                    <Button variant="secondary" onClick={() => void handleTransaction()} loading={loadingAction === 'transaction'}>
                                        事务写入
                                    </Button>
                                    <Button variant="secondary" onClick={() => void handleAppendAudit()} loading={loadingAction === 'append'}>
                                        追加日志
                                    </Button>
                                    <Button variant="secondary" onClick={() => void handleClearDemoData()} loading={loadingAction === 'remove'}>
                                        <Trash2 className="inline-icon" aria-hidden="true" size={14} />
                                        清理演示数据
                                    </Button>
                                </div>
                            </Card>

                            <Card title="存储键与监听事件" icon={List}>
                                <div style={{ display: 'grid', gap: 'var(--spacing-sm)' }}>
                                    {storageEntries.length > 0 ? storageEntries.map(entry => (
                                        <button
                                            type="button"
                                            className="list-row"
                                            key={entry.key}
                                            onClick={() => void handleLoadBasic(entry.key)}
                                            style={{ border: 0, textAlign: 'left', cursor: 'pointer' }}
                                        >
                                            <Database className="inline-icon" aria-hidden="true" size={14} />
                                            <span className="list-row-main">{entry.key}</span>
                                            <span className="list-row-meta">v{entry.version}</span>
                                            <span className="list-row-meta">{formatBytes(entry.size)}</span>
                                        </button>
                                    )) : (
                                        <div className="empty-state">
                                            <Database aria-hidden="true" size={28} />
                                            <p>还没有本模块演示数据</p>
                                        </div>
                                    )}
                                    {watchEvents.slice(0, 4).map((event, index) => (
                                        <div className="list-row" key={`${event.key}-${event.updatedAt}-${index}`}>
                                            <span className="list-row-main">{event.key}</span>
                                            <span className="list-row-meta">{event.type}</span>
                                            <span className="list-row-meta">{formatTime(event.updatedAt)}</span>
                                        </div>
                                    ))}
                                </div>
                            </Card>
                        </div>

                        <div className="grid-2">
                            <Card
                                title="加密 KV 存储"
                                icon={ShieldCheck}
                                actions={secretSummary.exists ? (
                                    <Button variant="secondary" onClick={() => void handleRemoveSecret()} loading={loadingAction === 'encrypted'}>
                                        <Trash2 className="inline-icon" aria-hidden="true" size={14} />
                                        删除
                                    </Button>
                                ) : null}
                            >
                                <div style={{ display: 'grid', gap: 'var(--spacing-md)' }}>
                                    <div className="input-group">
                                        <label className="input-label" htmlFor="encrypted-secret">演示凭据</label>
                                        <input
                                            id="encrypted-secret"
                                            className="input"
                                            type="password"
                                            value={secretDraft}
                                            onChange={event => setSecretDraft(event.target.value)}
                                        />
                                    </div>
                                    <div className="list-row">
                                        <ShieldCheck className="inline-icon" aria-hidden="true" size={14} />
                                        <span className="list-row-main">{SECRET_KEY}</span>
                                        <span className="list-row-meta">{secretSummary.exists ? '已保存' : '未保存'}</span>
                                        <span className="list-row-meta">长度 {secretSummary.tokenLength ?? 0}</span>
                                    </div>
                                    {secretSummary.error && (
                                        <div style={{ color: 'var(--error-text)', fontSize: 12 }}>{secretSummary.error}</div>
                                    )}
                                    <div className="action-bar">
                                        <Button onClick={() => void handleSaveSecret()} loading={loadingAction === 'encrypted'}>
                                            <KeyRound className="inline-icon" aria-hidden="true" size={14} />
                                            加密保存
                                        </Button>
                                    </div>
                                </div>
                            </Card>

                            <Card
                                title="附件存储"
                                icon={PackageOpen}
                                actions={attachmentSummary ? (
                                    <Button variant="secondary" onClick={() => void handleRemoveAttachment()} loading={loadingAction === 'attachment'}>
                                        <Trash2 className="inline-icon" aria-hidden="true" size={14} />
                                        删除
                                    </Button>
                                ) : null}
                            >
                                <div style={{ display: 'grid', gap: 'var(--spacing-md)' }}>
                                    {attachmentSummary ? (
                                        <div className="list-row">
                                            <FileText className="inline-icon" aria-hidden="true" size={14} />
                                            <span className="list-row-main">{attachmentSummary.id}</span>
                                            <span className="list-row-meta">{attachmentSummary.mimeType}</span>
                                            <span className="list-row-meta">{formatBytes(attachmentSummary.size)}</span>
                                        </div>
                                    ) : (
                                        <div className="empty-state">
                                            <PackageOpen aria-hidden="true" size={28} />
                                            <p>还没有快照附件</p>
                                        </div>
                                    )}
                                    <div className="action-bar">
                                        <Button onClick={() => void handleSaveAttachment()} loading={loadingAction === 'attachment'}>
                                            <PackageOpen className="inline-icon" aria-hidden="true" size={14} />
                                            保存快照
                                        </Button>
                                    </div>
                                    {attachmentPreview && (
                                        <div className="preview-box" style={{ justifyContent: 'flex-start', alignItems: 'stretch' }}>
                                            <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 12 }}>
                                                {attachmentPreview}
                                            </pre>
                                        </div>
                                    )}
                                </div>
                            </Card>
                        </div>

                        <Card title="最近操作" icon={List}>
                            <div style={{ display: 'grid', gap: 'var(--spacing-sm)' }}>
                                {operationLog.length > 0 ? operationLog.map((item, index) => (
                                    <div className="list-row" key={`${item.timestamp}-${index}`}>
                                        <StatusBadge status={item.status}>{statusText(item.status)}</StatusBadge>
                                        <span className="list-row-main">{item.action}</span>
                                        <span className="list-row-meta">{item.message}</span>
                                        <span className="list-row-meta">{formatDateTime(item.timestamp)}</span>
                                    </div>
                                )) : (
                                    <div className="empty-state">
                                        <List aria-hidden="true" size={28} />
                                        <p>暂无操作记录</p>
                                    </div>
                                )}
                            </div>
                        </Card>
                    </div>
                </div>

                <ApiReferencePanel apiGroups={apiGroups} examples={apiExamples} rawData={rawData} />
            </div>
        </div>
    )
}

function CheckLabel({ watching }: { watching: boolean }) {
    return (
        <>
            <RefreshCw className="inline-icon" aria-hidden="true" size={14} />
            {watching ? '停止监听' : '开始监听'}
        </>
    )
}

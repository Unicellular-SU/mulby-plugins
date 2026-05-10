import type { ApiExampleModule } from './types'
import { attempt, catalogModule, callBackendExample, mulby, playground, text, unavailable } from './helpers'

async function readClipboardPlayground() {
  const api = mulby()
  if (!api?.clipboard) return unavailable('Clipboard read')
  const [format, textValue] = await Promise.all([
    api.clipboard.getFormat(),
    api.clipboard.readText()
  ])
  const image = await api.clipboard.readImage()
  const files = await api.clipboard.readFiles()
  return {
    ok: true,
    title: 'Clipboard read',
    data: {
      format,
      textPreview: String(textValue ?? '').slice(0, 240),
      imageBytes: image?.byteLength ?? image?.length ?? 0,
      files: Array.isArray(files) ? files.slice(0, 10) : files
    }
  }
}

async function writeClipboardTextPlayground() {
  const api = mulby()
  if (!api?.clipboard) return unavailable('Clipboard write text')
  const value = `Mulby demo clipboard sample ${new Date().toISOString()}`
  await api.clipboard.writeText(value)
  return { ok: true, title: 'Clipboard write text', data: { written: value } }
}

async function writeClipboardImagePlayground() {
  const api = mulby()
  if (!api?.clipboard) return unavailable('Clipboard write image')
  const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAQAAAAAYLlVAAAAkElEQVR42u3PMQ0AAAwCoNm/9HI83BLIOdwqCgAAAAAAAAAAAAAAAAAA4P8D1wABq2wWmQAAAABJRU5ErkJggg=='
  const result = await api.clipboard.writeImage?.(image)
  return { ok: true, title: 'Clipboard write image', data: { result, imagePreview: image } }
}

async function readClipboardHistoryStats() {
  const data = await callBackendExample('clipboardHistoryStats')
  if ((data as any)?.warning) return data as any
  return { ok: true, title: 'Clipboard history stats', data }
}

async function queryClipboardHistory() {
  const data = await callBackendExample('clipboardHistoryQuery')
  if ((data as any)?.warning) return data as any
  return { ok: true, title: 'Clipboard history query', data }
}

async function guardedClipboardHistoryDelete() {
  const data = await callBackendExample('clipboardHistoryDeleteGuard')
  if ((data as any)?.warning) return data as any
  return { ok: true, title: 'Clipboard history guarded delete', data }
}

export const dataExamples: ApiExampleModule[] = [
  catalogModule('storage', {
    title: 'Storage',
    category: 'data',
    contexts: ['renderer', 'backend'],
    notes: [
      'Renderer storage accepts an optional namespace; backend storage is isolated to the current plugin.',
      'Use encrypted storage for tokens and attachment storage for binary data up to the host limit.'
    ],
    examples: [
      {
        id: 'storage-roundtrip',
        label: 'Write and read plugin data',
        description: 'Stores, reads, lists, batches, versions, appends, watches, and removes demo-owned renderer storage keys.',
        methods: [
          'storage.get',
          'storage.set',
          'storage.remove',
          'storage.getAll',
          'storage.getAllWithMeta',
          'storage.listNamespaces',
          'storage.list',
          'storage.getMany',
          'storage.setMany',
          'storage.getMeta',
          'storage.setWithVersion',
          'storage.removeWithVersion',
          'storage.transaction',
          'storage.append',
          'storage.watch'
        ],
        safety: 'writes-plugin-data',
        code: `const off = window.mulby.storage.watch({ prefix: 'mulby-demo:' }, console.log)
await window.mulby.storage.set('mulby-demo:lastRun', { at: Date.now() })
const value = await window.mulby.storage.get('mulby-demo:lastRun')
const meta = await window.mulby.storage.getMeta('mulby-demo:lastRun')
await window.mulby.storage.append('mulby-demo:events', { type: 'run' }, { maxItems: 5 })
await window.mulby.storage.remove('mulby-demo:lastRun')
off()`,
        async run() {
          const api = mulby()
          if (!api?.storage) return unavailable('Storage roundtrip')
          const payload = { at: new Date().toISOString(), source: 'mulby-demo' }
          const events: unknown[] = []
          const off = api.storage.watch?.({ prefix: 'mulby-demo:' }, (event: unknown) => events.push(event))
          await api.storage.set('mulby-demo:lastRun', payload)
          await api.storage.setMany?.([
            { key: 'mulby-demo:batch-a', value: { index: 1 } },
            { key: 'mulby-demo:batch-b', value: { index: 2 } }
          ], { atomic: true })
          await api.storage.setWithVersion?.('mulby-demo:versioned', { version: 1 }, { expectedVersion: null })
          await api.storage.append?.('mulby-demo:events', { type: 'run', at: payload.at }, { maxItems: 5 })
          await api.storage.transaction?.([
            { op: 'set', key: 'mulby-demo:tx-a', value: { tx: true } },
            { op: 'remove', key: 'mulby-demo:tx-missing' }
          ])
          const [value, all, allWithMeta, namespaces, list, many, meta, versionedMeta] = await Promise.all([
            api.storage.get('mulby-demo:lastRun'),
            attempt('getAll', () => api.storage.getAll?.()),
            attempt('getAllWithMeta', () => api.storage.getAllWithMeta?.('global')),
            attempt('listNamespaces', () => api.storage.listNamespaces?.()),
            attempt('list', () => api.storage.list?.({ prefix: 'mulby-demo:', limit: 20 })),
            attempt('getMany', () => api.storage.getMany?.(['mulby-demo:lastRun', 'mulby-demo:batch-a'])),
            attempt('getMeta', () => api.storage.getMeta?.('mulby-demo:lastRun')),
            attempt('getMeta:versioned', () => api.storage.getMeta?.('mulby-demo:versioned'))
          ])
          await api.storage.removeWithVersion?.('mulby-demo:versioned', { expectedVersion: versionedMeta.ok ? (versionedMeta.value as any)?.version : undefined })
          await api.storage.remove('mulby-demo:lastRun')
          await api.storage.remove('mulby-demo:batch-a')
          await api.storage.remove('mulby-demo:batch-b')
          await api.storage.remove('mulby-demo:events')
          await api.storage.remove('mulby-demo:tx-a')
          off?.()
          return {
            ok: true,
            title: 'Storage roundtrip',
            data: {
              value,
              all,
              allWithMeta,
              namespaces,
              list,
              many,
              meta,
              versionedMeta,
              watchEvents: events,
              removed: true
            }
          }
        }
      },
      {
        id: 'storage-backend-keys',
        label: 'Backend keys and clear',
        description: 'Uses backend storage keys and clear on demo-owned keys, then restores lifecycle metadata.',
        methods: ['storage.clear', 'storage.keys', 'storage.has', 'storage.bulkSet'],
        safety: 'writes-plugin-data',
        code: `await window.mulby.host.call('mulby-demo', 'runBackendExample', 'backendStorageRoundtrip')`,
        async run() {
          const data = await callBackendExample('backendStorageRoundtrip')
          if ((data as any)?.warning) return data as any
          return { ok: true, title: 'Backend storage keys', data }
        }
      },
      {
        id: 'storage-encrypted-attachment',
        label: 'Encrypted and attachment storage',
        description: 'Writes, reads, checks, lists, and removes demo-owned encrypted and binary values.',
        methods: [
          'storage.encrypted.set',
          'storage.encrypted.get',
          'storage.encrypted.remove',
          'storage.encrypted.has',
          'storage.attachment.put',
          'storage.attachment.get',
          'storage.attachment.getType',
          'storage.attachment.remove',
          'storage.attachment.list'
        ],
        safety: 'writes-plugin-data',
        code: `await window.mulby.storage.encrypted.set('mulby-demo:secret', { ok: true })\nconst secret = await window.mulby.storage.encrypted.get('mulby-demo:secret')\nawait window.mulby.storage.attachment.put('mulby-demo:blob', new TextEncoder().encode('demo'), 'text/plain')\nconst blob = await window.mulby.storage.attachment.get('mulby-demo:blob')`,
        async run() {
          const api = mulby()
          if (!api?.storage) return unavailable('Encrypted and attachment storage')
          const secretKey = 'mulby-demo:secret'
          const attachmentId = 'mulby-demo:blob'
          const secretPayload = { ok: true, at: new Date().toISOString() }
          await api.storage.encrypted?.set(secretKey, secretPayload)
          const secret = await api.storage.encrypted?.get(secretKey)
          const hasSecret = await api.storage.encrypted?.has?.(secretKey)
          await api.storage.encrypted?.remove(secretKey)

          const bytes = new TextEncoder().encode('Mulby demo attachment')
          await api.storage.attachment?.put(attachmentId, bytes, 'text/plain')
          const attachmentType = await api.storage.attachment?.getType(attachmentId)
          const attachment = await api.storage.attachment?.get(attachmentId)
          const list = await api.storage.attachment?.list('mulby-demo')
          await api.storage.attachment?.remove(attachmentId)
          return {
            ok: true,
            title: 'Encrypted and attachment storage',
            data: {
              secret,
              hasSecret,
              attachmentType,
              attachmentBytes: attachment?.byteLength ?? attachment?.length,
              listed: list
            }
          }
        }
      }
    ]
  }),
  catalogModule('clipboard', {
    title: 'Clipboard',
    category: 'data',
    contexts: ['renderer', 'backend'],
    notes: [
      'Requires `manifest.permissions.clipboard: true` for clipboard and clipboard-history access.',
      'This demo reads text and format by default; write examples use explicit demo text.'
    ],
    playground: playground(
      text('Clipboard inspector', '剪贴板检查器'),
      text(
        'Read the current clipboard, then write explicit demo text or image payloads when requested.',
        '读取当前剪贴板，并在用户点击时写入明确标记的演示文本或图片。'
      ),
      [
        {
          id: 'clipboard.read',
          label: text('Read clipboard', '读取剪贴板'),
          description: text('Shows current format, text preview, image size, and file entries.', '显示当前格式、文本预览、图片大小和文件条目。'),
          methods: ['clipboard.readText', 'clipboard.readImage', 'clipboard.readFiles', 'clipboard.getFormat'],
          safety: 'requires-permission',
          cleanup: false,
          code: `const format = await window.mulby.clipboard.getFormat()\nconst text = await window.mulby.clipboard.readText()`,
          run: readClipboardPlayground
        },
        {
          id: 'clipboard.writeText',
          label: text('Write text', '写入文本'),
          description: text('Writes a timestamped demo string.', '写入带时间戳的演示文本。'),
          methods: ['clipboard.writeText'],
          safety: 'writes-plugin-data',
          cleanup: false,
          code: `await window.mulby.clipboard.writeText('Mulby demo clipboard sample')`,
          run: writeClipboardTextPlayground
        },
        {
          id: 'clipboard.writeImage',
          label: text('Write image', '写入图片'),
          description: text('Writes a small demo PNG data URL to the clipboard.', '向剪贴板写入一个小型演示 PNG data URL。'),
          methods: ['clipboard.writeImage'],
          safety: 'writes-plugin-data',
          cleanup: false,
          code: `await window.mulby.clipboard.writeImage(dataUrl)`,
          run: writeClipboardImagePlayground
        }
      ],
      ['status', 'preview', 'json']
    ),
    examples: [
      {
        id: 'clipboard-read',
        label: 'Read clipboard format and text',
        description: 'Reads current clipboard format and text without modifying the clipboard.',
        methods: ['clipboard.readText', 'clipboard.readImage', 'clipboard.readFiles', 'clipboard.getFormat'],
        safety: 'requires-permission',
        code: `const format = await window.mulby.clipboard.getFormat()\nconst text = await window.mulby.clipboard.readText()`,
        async run() {
          const api = mulby()
          if (!api?.clipboard) return unavailable('Clipboard read')
          const [format, text] = await Promise.all([
            api.clipboard.getFormat(),
            api.clipboard.readText()
          ])
          const image = await api.clipboard.readImage()
          const files = await api.clipboard.readFiles()
          return {
            ok: true,
            title: 'Clipboard read',
            data: {
              format,
              textPreview: String(text ?? '').slice(0, 120),
              hasImage: Boolean(image),
              files: Array.isArray(files) ? files.slice(0, 5) : files
            }
          }
        }
      },
      {
        id: 'clipboard-write-demo',
        label: 'Write demo text',
        description: 'Writes a clearly labeled demo string to the clipboard.',
        methods: ['clipboard.writeText', 'clipboard.writeImage', 'clipboard.writeFiles'],
        safety: 'writes-plugin-data',
        code: `await window.mulby.clipboard.writeText('Mulby demo clipboard sample')\nawait window.mulby.clipboard.writeImage(dataUrl)\nawait window.mulby.clipboard.writeFiles([])`,
        async run() {
          const api = mulby()
          if (!api?.clipboard) return unavailable('Clipboard write')
          const text = `Mulby demo clipboard sample ${new Date().toISOString()}`
          await api.clipboard.writeText(text)
          const imageResult = await api.clipboard.writeImage?.(
            'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lw9LNgAAAABJRU5ErkJggg=='
          )
          let writeFilesResult: unknown = null
          try {
            writeFilesResult = await api.clipboard.writeFiles?.([])
          } catch (error) {
            writeFilesResult = error instanceof Error ? error.message : String(error)
          }
          return { ok: true, title: 'Clipboard write', data: { written: text, imageResult, writeFilesResult } }
        }
      }
    ]
  }),
  catalogModule('clipboard-history', {
    title: 'Clipboard History',
    category: 'data',
    contexts: ['renderer', 'backend'],
    notes: [
      'Clipboard history is user data. Prefer small limits and avoid rendering sensitive content by default.',
      'The host currently exposes clipboard history reliably through backend `context.api.clipboardHistory`; renderer examples call it through Host RPC.'
    ],
    playground: playground(
      text('Clipboard history workbench', '剪贴板历史工作台'),
      text(
        'Use backend Host RPC to read stats, query recent records, and run guarded destructive operations.',
        '通过后端 Host RPC 读取统计、查询最近记录，并执行带保护的破坏性操作。'
      ),
      [
        {
          id: 'clipboardHistory.stats',
          label: text('Read stats', '读取统计'),
          description: text('Reads aggregate clipboard history counts.', '读取剪贴板历史聚合统计。'),
          methods: ['clipboardHistory.stats'],
          safety: 'requires-permission',
          cleanup: false,
          code: `await window.mulby.host.call('mulby-demo', 'runBackendExample', 'clipboardHistoryStats')`,
          run: readClipboardHistoryStats
        },
        {
          id: 'clipboardHistory.query',
          label: text('Query recent', '查询最近记录'),
          description: text('Queries recent items and exercises get/copy/favorite toggles without leaving favorites changed.', '查询最近项目，并演示 get/copy/favorite 切换且不改变收藏状态。'),
          methods: ['clipboardHistory.query', 'clipboardHistory.get', 'clipboardHistory.copy', 'clipboardHistory.toggleFavorite'],
          safety: 'requires-permission',
          cleanup: false,
          code: `await window.mulby.host.call('mulby-demo', 'runBackendExample', 'clipboardHistoryQuery')`,
          run: queryClipboardHistory
        },
        {
          id: 'clipboardHistory.delete',
          label: text('Guarded delete', '保护性删除'),
          description: text('Calls delete with an impossible demo id and does not clear user history.', '使用不可能存在的演示 id 调用 delete，不清空用户历史。'),
          methods: ['clipboardHistory.delete', 'clipboardHistory.clear'],
          safety: 'requires-permission',
          cleanup: true,
          code: `await window.mulby.host.call('mulby-demo', 'runBackendExample', 'clipboardHistoryDeleteGuard')`,
          run: guardedClipboardHistoryDelete
        }
      ],
      ['status', 'table', 'json']
    ),
    examples: [
      {
        id: 'clipboard-history-stats',
        label: 'Read history stats',
        description: 'Reads aggregate clipboard history counts.',
        methods: ['clipboardHistory.stats'],
        safety: 'requires-permission',
        code: `const stats = await window.mulby.host.call('mulby-demo', 'runBackendExample', 'clipboardHistoryStats')`,
        async run() {
          const data = await callBackendExample('clipboardHistoryStats')
          if ((data as any)?.warning) return data as any
          return { ok: true, title: 'Clipboard history stats', data }
        }
      },
      {
        id: 'clipboard-history-query',
        label: 'Query and copy recent record',
        description: 'Queries recent records, reads the first record by id, copies it, toggles favorite twice, and leaves history unchanged.',
        methods: ['clipboardHistory.query', 'clipboardHistory.get', 'clipboardHistory.copy', 'clipboardHistory.toggleFavorite'],
        safety: 'requires-permission',
        code: `const result = await window.mulby.host.call('mulby-demo', 'runBackendExample', 'clipboardHistoryQuery')`,
        async run() {
          const data = await callBackendExample('clipboardHistoryQuery')
          if ((data as any)?.warning) return data as any
          return { ok: true, title: 'Clipboard history query', data }
        }
      },
      {
        id: 'clipboard-history-delete-clear',
        label: 'Delete and clear guarded demo',
        description: 'Executes delete with a demo-only impossible id and skips destructive clear unless the user opts into editing the snippet.',
        methods: ['clipboardHistory.delete', 'clipboardHistory.clear'],
        safety: 'requires-permission',
        code: `await window.mulby.host.call('mulby-demo', 'runBackendExample', 'clipboardHistoryDeleteGuard')\n// context.api.clipboardHistory.clear()`,
        async run() {
          const data = await callBackendExample('clipboardHistoryDeleteGuard')
          if ((data as any)?.warning) return data as any
          return { ok: true, title: 'Clipboard history delete guard', data }
        }
      }
    ]
  }),
  catalogModule('security', {
    title: 'Security',
    category: 'data',
    contexts: ['renderer', 'backend'],
    notes: [
      'Use `storage.encrypted` for persisted secrets; `security.encryptString` is useful for explicit safe-storage transforms.',
      'Encryption availability depends on the host OS safe storage backend.'
    ],
    examples: [
      {
        id: 'security-availability',
        label: 'Check encryption availability',
        description: 'Encrypts and decrypts a demo string when host safe storage is available.',
        methods: ['security.isEncryptionAvailable', 'security.encryptString', 'security.decryptString'],
        safety: 'safe',
        code: `const available = await window.mulby.security.isEncryptionAvailable()\nconst encrypted = available ? await window.mulby.security.encryptString('Mulby demo') : null\nconst decrypted = encrypted ? await window.mulby.security.decryptString(encrypted) : null`,
        async run() {
          const api = mulby()
          if (!api?.security) return unavailable('Security availability')
          const available = await api.security.isEncryptionAvailable()
          const encrypted = available ? await api.security.encryptString('Mulby demo secret') : null
          const decrypted = encrypted ? await api.security.decryptString(encrypted) : null
          return {
            ok: true,
            title: 'Security availability',
            data: {
              available,
              encryptedBytes: encrypted?.byteLength ?? encrypted?.length ?? 0,
              decrypted
            }
          }
        }
      }
    ]
  })
]

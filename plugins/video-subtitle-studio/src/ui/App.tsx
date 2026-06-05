import { Download, FileVideo, FolderOpen, Languages, Loader2, Play, Redo2, RefreshCw, Save, SaveAll, Scissors, Settings2, Undo2, Wand2, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { normalizeOpenAiTranscription, normalizeVolcengineTranscription, buildOpenAiTranscriptionRequest } from './lib/asr'
import { cleanupFiles, extractAudioChunks, getMediaDurationMs } from './lib/audio'
import { mergeChunkResults, type AudioChunk } from './lib/chunking'
import { exportJson, exportSrt, exportVtt, formatVttTime, mergeSubtitles, splitByText, splitByTime, splitByWord, type SubtitleCue } from './lib/subtitles'
import { translateSubtitles } from './lib/translate'
import { PROJECT_EXTENSION, parseProject, projectFileName, serializeProject } from './lib/project'
import { useMulby } from './hooks/useMulby'
import { useHistoryState } from './hooks/useHistoryState'
import { CueList, type SplitRequest } from './components/CueList'
import { VideoPreview, type VideoPreviewHandle } from './components/VideoPreview'

type ProviderId = 'openai' | 'volcengine'
type ExportFormat = 'srt' | 'vtt' | 'json' | 'bilingual-srt'

interface PluginInitData {
  attachments?: Array<{ path?: string }>
}

type VolcengineApiMode = 'flash' | 'standard'

interface StudioSettings {
  provider: ProviderId
  openAiBaseUrl: string
  openAiModel: string
  openAiLanguage: string
  volcengineApiMode: VolcengineApiMode
  volcengineEndpoint: string
  volcengineSubmitUrl: string
  volcengineQueryUrl: string
  volcengineAppId: string
  volcengineResourceId: string
  targetLanguage: string
  translateModel: string
}

const VOLC_FLASH_ENDPOINT = 'https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash'
const VOLC_SUBMIT_URL = 'https://openspeech.bytedance.com/api/v3/auc/bigmodel/submit'
const VOLC_QUERY_URL = 'https://openspeech.bytedance.com/api/v3/auc/bigmodel/query'

const SETTINGS_KEY = 'video-subtitle-studio.settings.v1'
const OPENAI_KEY = 'video-subtitle-studio.openai.api-key'
const VOLCENGINE_KEY = 'video-subtitle-studio.volcengine.access-token'
const DRAFT_KEY = 'video-subtitle-studio.draft.v1'
const DRAFT_DEBOUNCE_MS = 1500

interface DraftSnapshot {
  videoPath: string
  durationMs: number
  cues: SubtitleCue[]
  savedAt: string
}

type ChunkStatus = 'pending' | 'running' | 'done' | 'failed'

interface ChunkJob {
  chunk: AudioChunk
  path: string
  status: ChunkStatus
  error?: string
  cues?: SubtitleCue[]
}

const TARGET_LANGUAGE_PRESETS = [
  '中文',
  '英文',
  '日文',
  '韩文',
  '法文',
  '德文',
  '西班牙文',
  '俄文',
  '葡萄牙文',
  '繁体中文'
] as const

const DEFAULT_SETTINGS: StudioSettings = {
  provider: 'openai',
  openAiBaseUrl: 'https://api.openai.com/v1',
  openAiModel: 'whisper-1',
  openAiLanguage: 'zh',
  volcengineApiMode: 'standard',
  volcengineEndpoint: VOLC_FLASH_ENDPOINT,
  volcengineSubmitUrl: VOLC_SUBMIT_URL,
  volcengineQueryUrl: VOLC_QUERY_URL,
  volcengineAppId: '',
  volcengineResourceId: 'volc.seedasr.auc',
  targetLanguage: '英文',
  translateModel: ''
}

function normalizeSettings(raw: unknown): StudioSettings {
  if (!raw || typeof raw !== 'object') return DEFAULT_SETTINGS
  const value = raw as Partial<StudioSettings>
  return {
    provider: value.provider === 'volcengine' ? 'volcengine' : 'openai',
    openAiBaseUrl: value.openAiBaseUrl || DEFAULT_SETTINGS.openAiBaseUrl,
    openAiModel: value.openAiModel || DEFAULT_SETTINGS.openAiModel,
    openAiLanguage: value.openAiLanguage || DEFAULT_SETTINGS.openAiLanguage,
    volcengineApiMode: value.volcengineApiMode === 'flash' ? 'flash' : 'standard',
    volcengineEndpoint: value.volcengineEndpoint || DEFAULT_SETTINGS.volcengineEndpoint,
    volcengineSubmitUrl: value.volcengineSubmitUrl || DEFAULT_SETTINGS.volcengineSubmitUrl,
    volcengineQueryUrl: value.volcengineQueryUrl || DEFAULT_SETTINGS.volcengineQueryUrl,
    volcengineAppId: value.volcengineAppId || '',
    volcengineResourceId: value.volcengineResourceId || (value.volcengineApiMode === 'flash' ? 'volc.bigasr.auc_turbo' : 'volc.seedasr.auc'),
    targetLanguage: value.targetLanguage || DEFAULT_SETTINGS.targetLanguage,
    translateModel: value.translateModel || ''
  }
}

function fileName(path: string) {
  return path.split(/[\\/]/).pop() || path
}

function unwrapHostData<T>(value: any): T | undefined {
  return value?.data ?? value
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = ''
  const chunkSize = 0x8000
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize))
  }
  return btoa(binary)
}

async function readBytes(filesystem: any, path: string): Promise<Uint8Array> {
  const value = await filesystem.readFile(path)
  if (value instanceof Uint8Array) return value
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  if (Array.isArray(value)) return new Uint8Array(value)
  throw new Error('无法读取音频分片内容。')
}

async function transcribeOpenAi(filesystem: any, path: string, settings: StudioSettings, apiKey: string) {
  if (!apiKey) throw new Error('请先在设置中填写 OpenAI API Key。')
  const bytes = await readBytes(filesystem, path)
  const request = buildOpenAiTranscriptionRequest({
    model: settings.openAiModel,
    language: settings.openAiLanguage || undefined,
    timestampGranularity: 'segment'
  })
  const form = new FormData()
  form.append('file', new Blob([bytes], { type: 'audio/mpeg' }), 'chunk.mp3')
  form.append('model', request.model)
  form.append('response_format', request.response_format)
  for (const item of request.timestamp_granularities) form.append('timestamp_granularities[]', item)
  if (request.language) form.append('language', request.language)
  if (request.prompt) form.append('prompt', request.prompt)

  const response = await fetch(`${settings.openAiBaseUrl.replace(/\/$/, '')}/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form
  })
  if (!response.ok) throw new Error(`OpenAI ASR 请求失败：${response.status} ${await response.text()}`)
  return normalizeOpenAiTranscription(await response.json())
}

function createRequestId() {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  } catch {
    // fall through to manual UUID generation
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = (Math.random() * 16) | 0
    const value = char === 'x' ? random : (random & 0x3) | 0x8
    return value.toString(16)
  })
}

interface VolcengineCreds {
  appId: string
  token: string
  resourceId: string
}

function readVolcengineCreds(settings: StudioSettings, accessToken: string): VolcengineCreds {
  const appId = settings.volcengineAppId.trim()
  const token = accessToken.trim()
  const fallback = settings.volcengineApiMode === 'flash' ? 'volc.bigasr.auc_turbo' : 'volc.seedasr.auc'
  const resourceId = (settings.volcengineResourceId || fallback).trim()
  if (!appId) throw new Error('请先在设置中填写火山引擎 App ID。')
  if (!token) throw new Error('请先在设置中填写火山引擎 Access Token。')
  return { appId, token, resourceId }
}

function volcengineHeaders(creds: VolcengineCreds, requestId: string, includeSequence: boolean) {
  return {
    'Content-Type': 'application/json',
    'X-Api-App-Key': creds.appId,
    'X-Api-Access-Key': creds.token,
    'X-Api-Resource-Id': creds.resourceId,
    'X-Api-Request-Id': requestId,
    ...(includeSequence ? { 'X-Api-Sequence': '-1' } : {})
  }
}

function volcengineRequestBody() {
  return {
    model_name: 'bigmodel',
    show_utterances: true,
    enable_itn: true,
    enable_punc: true
  } as const
}

async function transcribeVolcengineFlash(filesystem: any, path: string, settings: StudioSettings, creds: VolcengineCreds) {
  const bytes = await readBytes(filesystem, path)
  const response = await fetch(settings.volcengineEndpoint.trim() || VOLC_FLASH_ENDPOINT, {
    method: 'POST',
    headers: volcengineHeaders(creds, createRequestId(), true),
    body: JSON.stringify({
      user: { uid: creds.appId },
      audio: { data: bytesToBase64(bytes), format: 'mp3' },
      request: volcengineRequestBody()
    })
  })

  const statusCode = response.headers.get('X-Api-Status-Code')
  const apiMessage = response.headers.get('X-Api-Message')
  const logSuffix = response.headers.get('X-Tt-Logid') ? `（LogID: ${response.headers.get('X-Tt-Logid')}）` : ''
  if (!response.ok) throw new Error(`火山引擎 ASR 请求失败：${response.status} ${await response.text()}${logSuffix}`)
  if (statusCode && statusCode !== '20000000') {
    throw new Error(`火山引擎 ASR 失败（${statusCode} ${apiMessage || ''}）：${await response.text()}${logSuffix}`)
  }
  return normalizeVolcengineTranscription(await response.json())
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function transcribeVolcengineStandard(
  filesystem: any,
  path: string,
  settings: StudioSettings,
  creds: VolcengineCreds,
  onProgress?: (label: string) => void
) {
  const bytes = await readBytes(filesystem, path)
  const requestId = createRequestId()

  const submit = await fetch(settings.volcengineSubmitUrl.trim() || VOLC_SUBMIT_URL, {
    method: 'POST',
    headers: volcengineHeaders(creds, requestId, true),
    body: JSON.stringify({
      user: { uid: creds.appId },
      audio: { data: bytesToBase64(bytes), format: 'mp3' },
      request: volcengineRequestBody()
    })
  })

  const submitStatus = submit.headers.get('X-Api-Status-Code')
  const submitMessage = submit.headers.get('X-Api-Message')
  const submitLog = submit.headers.get('X-Tt-Logid') || ''
  const submitLogSuffix = submitLog ? `（LogID: ${submitLog}）` : ''
  if (!submit.ok) throw new Error(`火山引擎提交任务失败：${submit.status} ${await submit.text()}${submitLogSuffix}`)
  if (submitStatus && submitStatus !== '20000000') {
    throw new Error(`火山引擎提交任务失败（${submitStatus} ${submitMessage || ''}）${submitLogSuffix}`)
  }

  const maxAttempts = 600
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    await sleep(attempt === 0 ? 1500 : 2500)
    const query = await fetch(settings.volcengineQueryUrl.trim() || VOLC_QUERY_URL, {
      method: 'POST',
      headers: volcengineHeaders(creds, requestId, false),
      body: JSON.stringify({})
    })

    const queryStatus = query.headers.get('X-Api-Status-Code')
    const queryMessage = query.headers.get('X-Api-Message')
    const queryLog = query.headers.get('X-Tt-Logid') || submitLog
    const queryLogSuffix = queryLog ? `（LogID: ${queryLog}）` : ''

    if (!query.ok) throw new Error(`火山引擎查询失败：${query.status} ${await query.text()}${queryLogSuffix}`)

    if (queryStatus === '20000000') {
      return normalizeVolcengineTranscription(await query.json())
    }
    if (queryStatus === '20000001' || queryStatus === '20000002') {
      onProgress?.(`火山引擎识别中（${queryStatus === '20000002' ? '排队' : '处理'}）`)
      continue
    }
    if (queryStatus === '20000003') {
      throw new Error(`火山引擎：静音音频，未检测到人声${queryLogSuffix}`)
    }
    throw new Error(`火山引擎查询失败（${queryStatus || '未知'} ${queryMessage || ''}）：${await query.text()}${queryLogSuffix}`)
  }

  throw new Error('火山引擎识别超时，请稍后重试或缩短音频时长。')
}

async function transcribeVolcengine(
  filesystem: any,
  path: string,
  settings: StudioSettings,
  accessToken: string,
  onProgress?: (label: string) => void
) {
  const creds = readVolcengineCreds(settings, accessToken)
  return settings.volcengineApiMode === 'flash'
    ? transcribeVolcengineFlash(filesystem, path, settings, creds)
    : transcribeVolcengineStandard(filesystem, path, settings, creds, onProgress)
}

export default function App() {
  const { ai, clipboard, dialog, ffmpeg, filesystem, host, notification, storage, system } = useMulby()
  const [videoPath, setVideoPath] = useState('')
  const [durationMs, setDurationMs] = useState(0)
  const [settings, setSettings] = useState<StudioSettings>(DEFAULT_SETTINGS)
  const [openAiKey, setOpenAiKey] = useState('')
  const [volcengineKey, setVolcengineKey] = useState('')
  const cueHistory = useHistoryState<SubtitleCue[]>([])
  const cues = cueHistory.state
  const setCues = cueHistory.set
  const [status, setStatus] = useState('等待导入视频')
  const [busy, setBusy] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [aiModels, setAiModels] = useState<Array<{ id: string; label?: string }>>([])
  const [draft, setDraft] = useState<DraftSnapshot | null>(null)
  const draftReadyRef = useRef(false)
  const [chunkJobs, setChunkJobs] = useState<ChunkJob[]>([])
  const [retryingIndex, setRetryingIndex] = useState<number | null>(null)
  const chunkPathsRef = useRef<string[]>([])
  const [currentTimeMs, setCurrentTimeMs] = useState(0)
  const [projectPath, setProjectPath] = useState('')
  const videoRef = useRef<VideoPreviewHandle | null>(null)

  const totalText = useMemo(() => cues.map((cue) => cue.text).join('\n'), [cues])
  const failedChunks = useMemo(() => chunkJobs.filter((job) => job.status === 'failed'), [chunkJobs])
  const activeCue = useMemo(
    () => cues.find((cue) => currentTimeMs >= cue.startMs && currentTimeMs < cue.endMs),
    [cues, currentTimeMs]
  )

  const seekToCue = useCallback((startMs: number) => {
    videoRef.current?.seek(startMs, true)
  }, [])

  useEffect(() => {
    document.documentElement.classList.toggle('dark', new URLSearchParams(window.location.search).get('theme') === 'dark')
    window.mulby?.onThemeChange?.((theme: 'light' | 'dark') => {
      document.documentElement.classList.toggle('dark', theme === 'dark')
    })
    window.mulby?.onPluginInit?.((data: PluginInitData) => {
      const first = data.attachments?.map((item) => item.path).find((path): path is string => Boolean(path))
      if (first) void loadVideo(first)
    })

    void (async () => {
      const saved = normalizeSettings(await storage?.get?.(SETTINGS_KEY))
      setSettings(saved)
      setOpenAiKey(String((await storage?.encrypted?.get?.(OPENAI_KEY)) || ''))
      setVolcengineKey(String((await storage?.encrypted?.get?.(VOLCENGINE_KEY)) || ''))
      try {
        const models = await ai?.allModels?.()
        setAiModels(Array.isArray(models) ? models.filter((model) => model?.id) : [])
      } catch {
        setAiModels([])
      }
      try {
        const rawDraft = await storage?.get?.(DRAFT_KEY)
        if (rawDraft && typeof rawDraft === 'object' && Array.isArray((rawDraft as DraftSnapshot).cues) && (rawDraft as DraftSnapshot).cues.length) {
          setDraft(rawDraft as DraftSnapshot)
        }
      } catch {
        // Draft restore is best-effort.
      }
      try {
        const pending = unwrapHostData<{ paths?: string[] }>(await host?.call?.('getPendingInit'))
        if (pending?.paths?.[0]) await loadVideo(pending.paths[0])
      } catch {
        // Host RPC is optional during early startup.
      }
      draftReadyRef.current = true
    })()
  }, [])

  const clearDraft = useCallback(() => {
    try {
      const result = storage?.remove?.(DRAFT_KEY)
      if (result && typeof result.then === 'function') result.catch(() => undefined)
    } catch {
      // best-effort
    }
  }, [storage])

  useEffect(() => {
    if (!draftReadyRef.current) return
    if (!cues.length) {
      clearDraft()
      return
    }
    const timer = setTimeout(() => {
      if (projectPath) {
        // Bound to a project file: persist there and keep the storage draft empty
        // so reopening never shows a stale "unsaved draft" prompt.
        const content = serializeProject({
          videoPath,
          durationMs,
          cues,
          meta: {
            provider: settings.provider,
            targetLanguage: settings.targetLanguage,
            translateModel: settings.translateModel || undefined
          }
        })
        const result = filesystem?.writeFile?.(projectPath, content, 'utf-8')
        if (result && typeof result.then === 'function') {
          result
            .then(() => setStatus(`已自动保存到工程：${fileName(projectPath)}`))
            .catch(() => undefined)
        }
        clearDraft()
        return
      }
      const snapshot: DraftSnapshot = { videoPath, durationMs, cues, savedAt: new Date().toISOString() }
      void storage?.set?.(DRAFT_KEY, snapshot)
    }, DRAFT_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [cues, videoPath, durationMs, clearDraft, projectPath, settings, filesystem])

  useEffect(() => {
    return () => {
      const paths = chunkPathsRef.current
      chunkPathsRef.current = []
      if (paths.length) void cleanupFiles(filesystem, paths)
    }
  }, [filesystem])

  useEffect(() => {
    if (!showSettings) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShowSettings(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [showSettings])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'z') return
      const target = event.target as HTMLElement | null
      const tag = target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return
      event.preventDefault()
      if (event.shiftKey) cueHistory.redo()
      else cueHistory.undo()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [cueHistory.undo, cueHistory.redo])

  async function loadVideo(path: string) {
    setVideoPath(path)
    cueHistory.reset([])
    setProjectPath('')
    setStatus('读取视频时长')
    try {
      const nextDuration = await getMediaDurationMs(path)
      setDurationMs(nextDuration)
      setStatus(`已导入：${fileName(path)}`)
    } catch (error) {
      setDurationMs(0)
      setStatus(error instanceof Error ? error.message : '读取视频失败')
    }
  }

  async function pickVideo() {
    const paths = await dialog?.showOpenDialog?.({
      title: '选择视频文件',
      properties: ['openFile'],
      filters: [{ name: '视频文件', extensions: ['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v'] }]
    })
    if (Array.isArray(paths) && paths[0]) await loadVideo(paths[0])
  }

  async function saveSettings() {
    await storage?.set?.(SETTINGS_KEY, settings)
    await storage?.encrypted?.set?.(OPENAI_KEY, openAiKey)
    await storage?.encrypted?.set?.(VOLCENGINE_KEY, volcengineKey)
    notification?.show?.('设置已保存', 'success')
    setShowSettings(false)
  }

  function changeTargetLanguage(language: string) {
    setSettings((current) => {
      const next = { ...current, targetLanguage: language }
      void storage?.set?.(SETTINGS_KEY, next)
      return next
    })
  }

  const transcribeOneChunk = useCallback(
    (path: string, label: (text: string) => void) =>
      settings.provider === 'openai'
        ? transcribeOpenAi(filesystem, path, settings, openAiKey)
        : transcribeVolcengine(filesystem, path, settings, volcengineKey, label),
    [filesystem, settings, openAiKey, volcengineKey]
  )

  const applyJobsToCues = useCallback(
    (jobs: ChunkJob[], commit: boolean) => {
      const results = jobs
        .filter((job) => job.status === 'done' && job.cues)
        .map((job) => ({ chunk: job.chunk, cues: job.cues as SubtitleCue[] }))
      const merged = mergeChunkResults(results).map((cue, index) => ({ ...cue, id: `cue-${index + 1}` }))
      if (commit) cueHistory.reset(merged)
      else setCues(merged, { commit: false })
      return merged
    },
    [cueHistory, setCues]
  )

  async function cleanupChunkFiles() {
    const paths = chunkPathsRef.current
    chunkPathsRef.current = []
    if (paths.length) await cleanupFiles(filesystem, paths)
  }

  async function generateSubtitles() {
    if (!videoPath) {
      notification?.show?.('请先导入视频文件', 'warning')
      return
    }

    try {
      setBusy(true)
      cueHistory.reset([])
      await cleanupChunkFiles()
      setChunkJobs([])
      const actualDuration = durationMs || (await getMediaDurationMs(videoPath))
      setDurationMs(actualDuration)
      const chunks = await extractAudioChunks({ ffmpeg, filesystem, system }, videoPath, actualDuration, setStatus)
      chunkPathsRef.current = chunks.map((item) => item.path)

      let jobs: ChunkJob[] = chunks.map((item) => ({ chunk: item.chunk, path: item.path, status: 'pending' as ChunkStatus }))
      setChunkJobs(jobs)

      const total = chunks.length
      for (const item of chunks) {
        const position = `${item.chunk.index + 1}/${total}`
        jobs = jobs.map((job) => (job.chunk.index === item.chunk.index ? { ...job, status: 'running' as ChunkStatus } : job))
        setChunkJobs(jobs)
        setStatus(`识别音频分片 ${position}`)
        try {
          const chunkCues = await transcribeOneChunk(item.path, (label) => setStatus(`识别音频分片 ${position} · ${label}`))
          jobs = jobs.map((job) =>
            job.chunk.index === item.chunk.index ? { ...job, status: 'done' as ChunkStatus, cues: chunkCues, error: undefined } : job
          )
        } catch (error) {
          const message = error instanceof Error ? error.message : '分片识别失败'
          jobs = jobs.map((job) =>
            job.chunk.index === item.chunk.index ? { ...job, status: 'failed' as ChunkStatus, error: message } : job
          )
        }
        setChunkJobs(jobs)
        const partial = applyJobsToCues(jobs, false)
        const failedSoFar = jobs.filter((job) => job.status === 'failed').length
        setStatus(`已处理分片 ${position} · 当前 ${partial.length} 条字幕${failedSoFar ? ` · ${failedSoFar} 个分片失败` : ''}`)
      }

      const merged = applyJobsToCues(jobs, true)
      const failedCount = jobs.filter((job) => job.status === 'failed').length
      if (failedCount) {
        setStatus(`字幕生成完成（${failedCount} 个分片失败，可单独重试），共 ${merged.length} 条`)
        notification?.show?.(`${failedCount} 个分片识别失败，可点击重试`, 'warning')
      } else {
        setStatus(`字幕生成完成，共 ${merged.length} 条`)
        notification?.show?.('字幕生成完成', 'success')
        await cleanupChunkFiles()
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '字幕生成失败'
      setStatus(message)
      notification?.show?.(message, 'error')
    } finally {
      setBusy(false)
    }
  }

  async function retryChunk(index: number) {
    const job = chunkJobs.find((item) => item.chunk.index === index)
    if (!job) return
    const total = chunkJobs.length
    const position = `${index + 1}/${total}`
    try {
      setRetryingIndex(index)
      let jobs = chunkJobs.map((item) => (item.chunk.index === index ? { ...item, status: 'running' as ChunkStatus } : item))
      setChunkJobs(jobs)
      setStatus(`重试分片 ${position}`)
      const chunkCues = await transcribeOneChunk(job.path, (label) => setStatus(`重试分片 ${position} · ${label}`))
      jobs = jobs.map((item) =>
        item.chunk.index === index ? { ...item, status: 'done' as ChunkStatus, cues: chunkCues, error: undefined } : item
      )
      setChunkJobs(jobs)
      const merged = applyJobsToCues(jobs, true)
      const failedCount = jobs.filter((item) => item.status === 'failed').length
      setStatus(`分片 ${position} 重试成功，共 ${merged.length} 条字幕${failedCount ? ` · 仍有 ${failedCount} 个失败` : ''}`)
      if (!failedCount) {
        notification?.show?.('全部分片识别完成', 'success')
        await cleanupChunkFiles()
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '分片重试失败'
      setChunkJobs((current) =>
        current.map((item) => (item.chunk.index === index ? { ...item, status: 'failed' as ChunkStatus, error: message } : item))
      )
      setStatus(message)
      notification?.show?.(message, 'error')
    } finally {
      setRetryingIndex(null)
    }
  }

  async function translateAll() {
    try {
      setBusy(true)
      setStatus('正在调用 Mulby AI 翻译字幕')
      const translated = await translateSubtitles(cues, {
        ai,
        model: settings.translateModel || undefined,
        targetLanguage: settings.targetLanguage,
        onChunk: () => setStatus('正在接收翻译结果')
      })
      setCues(translated)
      setStatus('翻译完成')
      notification?.show?.('翻译完成', 'success')
    } catch (error) {
      const message = error instanceof Error ? error.message : '翻译失败'
      setStatus(message)
      notification?.show?.(message, 'error')
    } finally {
      setBusy(false)
    }
  }

  async function exportFile(format: ExportFormat) {
    if (!cues.length) return
    const ext = format === 'json' ? 'json' : format === 'vtt' ? 'vtt' : 'srt'
    const savePath = await dialog?.showSaveDialog?.({
      title: '导出字幕',
      defaultPath: `${fileName(videoPath).replace(/\.[^.]+$/, '') || 'subtitles'}.${ext}`,
      filters: [{ name: ext.toUpperCase(), extensions: [ext] }]
    })
    if (!savePath) return

    const output =
      format === 'json'
        ? exportJson(cues)
        : format === 'vtt'
          ? exportVtt(cues)
          : exportSrt(format === 'bilingual-srt' ? cues : cues.map(({ translation: _translation, ...cue }) => cue))

    await filesystem?.writeFile?.(savePath, output, 'utf-8')
    notification?.show?.('字幕已导出', 'success')
  }

  async function writeProjectTo(savePath: string) {
    const content = serializeProject({
      videoPath,
      durationMs,
      cues,
      meta: {
        provider: settings.provider,
        targetLanguage: settings.targetLanguage,
        translateModel: settings.translateModel || undefined
      }
    })
    await filesystem?.writeFile?.(savePath, content, 'utf-8')
    setProjectPath(savePath)
    clearDraft()
    setStatus(`工程已保存：${fileName(savePath)}`)
    notification?.show?.('工程已保存', 'success')
  }

  async function promptSavePath() {
    return (await dialog?.showSaveDialog?.({
      title: '保存工程',
      defaultPath: projectPath || projectFileName(videoPath),
      filters: [{ name: '字幕工程', extensions: [PROJECT_EXTENSION] }]
    })) as string | undefined
  }

  async function saveProject() {
    if (!cues.length) {
      notification?.show?.('当前没有可保存的字幕', 'warning')
      return
    }
    try {
      const savePath = projectPath || (await promptSavePath())
      if (!savePath) return
      await writeProjectTo(savePath)
    } catch (error) {
      const message = error instanceof Error ? error.message : '保存工程失败'
      setStatus(message)
      notification?.show?.(message, 'error')
    }
  }

  async function saveProjectAs() {
    if (!cues.length) {
      notification?.show?.('当前没有可保存的字幕', 'warning')
      return
    }
    try {
      const savePath = await promptSavePath()
      if (!savePath) return
      await writeProjectTo(savePath)
    } catch (error) {
      const message = error instanceof Error ? error.message : '另存为失败'
      setStatus(message)
      notification?.show?.(message, 'error')
    }
  }

  async function loadProject() {
    const paths = await dialog?.showOpenDialog?.({
      title: '导入工程',
      properties: ['openFile'],
      filters: [{ name: '字幕工程', extensions: [PROJECT_EXTENSION, 'json'] }]
    })
    const path = Array.isArray(paths) ? paths[0] : undefined
    if (!path) return

    try {
      const content = await filesystem?.readFile?.(path, 'utf-8')
      const text =
        typeof content === 'string'
          ? content
          : content instanceof Uint8Array
            ? new TextDecoder().decode(content)
            : String(content ?? '')
      const project = parseProject(text)
      setVideoPath(project.videoPath)
      setDurationMs(project.durationMs)
      cueHistory.reset(project.cues)
      setProjectPath(path)
      setStatus(
        `已导入工程：${fileName(path)}（${project.cues.length} 条字幕${
          project.savedAt ? ` · 保存于 ${new Date(project.savedAt).toLocaleString()}` : ''
        }）`
      )
      notification?.show?.('工程已导入', 'success')
    } catch (error) {
      const message = error instanceof Error ? error.message : '导入工程失败'
      setStatus(message)
      notification?.show?.(message, 'error')
    }
  }

  function restoreDraft() {
    if (!draft) return
    setVideoPath(draft.videoPath)
    setDurationMs(draft.durationMs)
    cueHistory.reset(draft.cues)
    setStatus(`已恢复上次草稿（${draft.cues.length} 条字幕）`)
    setDraft(null)
    notification?.show?.('草稿已恢复', 'success')
  }

  function dismissDraft() {
    setDraft(null)
    clearDraft()
  }

  const updateCue = useCallback((id: string, patch: Partial<SubtitleCue>) => {
    setCues((current) => current.map((cue) => (cue.id === id ? { ...cue, ...patch } : cue)))
  }, [])

  const deleteCue = useCallback((id: string) => {
    setCues((current) => current.filter((cue) => cue.id !== id))
  }, [])

  const splitCue = useCallback((id: string, request: SplitRequest) => {
    setCues((current) => {
      const index = current.findIndex((cue) => cue.id === id)
      if (index < 0) return current
      const cue = current[index]
      const pair =
        request.kind === 'text'
          ? splitByText(cue, request.textIndex)
          : request.kind === 'time'
            ? splitByTime(cue, request.splitMs)
            : splitByWord(cue, request.wordIndex)
      const next = [...current.slice(0, index), pair[0], pair[1], ...current.slice(index + 1)]
      return next.map((item, idx) => ({ ...item, id: `cue-${idx + 1}` }))
    })
  }, [])

  const mergeCue = useCallback((id: string) => {
    setCues((current) => {
      const index = current.findIndex((cue) => cue.id === id)
      if (index <= 0) return current
      const merged = mergeSubtitles(current[index - 1], current[index])
      const next = [...current.slice(0, index - 1), merged, ...current.slice(index + 1)]
      return next.map((item, idx) => ({ ...item, id: `cue-${idx + 1}` }))
    })
  }, [])

  function setVolcengineApiMode(mode: VolcengineApiMode) {
    setSettings((current) => {
      const autoResourceIds = ['volc.bigasr.auc_turbo', 'volc.seedasr.auc', 'volc.bigasr.auc', '']
      const nextResourceId = autoResourceIds.includes(current.volcengineResourceId.trim())
        ? mode === 'flash'
          ? 'volc.bigasr.auc_turbo'
          : 'volc.seedasr.auc'
        : current.volcengineResourceId
      return { ...current, volcengineApiMode: mode, volcengineResourceId: nextResourceId }
    })
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-slate-950 text-slate-100">
      <header className="shrink-0 border-b border-white/10 bg-slate-950/90 px-4 py-3 sm:px-6 sm:py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.35em] text-cyan-300 sm:text-xs">Mulby Subtitle Studio</p>
            <h1 className="mt-0.5 truncate text-lg font-semibold sm:mt-1 sm:text-2xl">视频字幕工作台</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button className="btn-secondary" onClick={cueHistory.undo} disabled={busy || !cueHistory.canUndo} title="撤销 (Ctrl/Cmd+Z)" aria-label="撤销">
              <Undo2 size={16} />
            </button>
            <button className="btn-secondary" onClick={cueHistory.redo} disabled={busy || !cueHistory.canRedo} title="重做 (Ctrl/Cmd+Shift+Z)" aria-label="重做">
              <Redo2 size={16} />
            </button>
            <button className="btn-secondary" onClick={loadProject} disabled={busy}>
              <FolderOpen size={16} />
              <span className="hidden sm:inline">导入工程</span>
            </button>
            <button
              className="btn-secondary"
              onClick={saveProject}
              disabled={busy || !cues.length}
              title={projectPath ? `保存到 ${fileName(projectPath)}` : '保存工程'}
            >
              <Save size={16} />
              <span className="hidden sm:inline">保存工程</span>
            </button>
            <button className="btn-secondary" onClick={saveProjectAs} disabled={busy || !cues.length} title="另存为新文件">
              <SaveAll size={16} />
              <span className="hidden sm:inline">另存为</span>
            </button>
            <button className="btn-secondary" onClick={() => setShowSettings(true)}>
              <Settings2 size={16} />
              <span className="hidden sm:inline">设置</span>
            </button>
          </div>
        </div>
      </header>

      {draft && (
        <div className="shrink-0 border-b border-amber-400/20 bg-amber-400/10 px-4 py-2.5 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-amber-100">
              检测到上次未保存的草稿（{draft.cues.length} 条字幕
              {draft.savedAt ? ` · ${new Date(draft.savedAt).toLocaleString()}` : ''}），是否恢复？
            </p>
            <div className="flex items-center gap-2">
              <button className="btn-primary" onClick={restoreDraft}>恢复草稿</button>
              <button className="btn-ghost" onClick={dismissDraft}>忽略</button>
            </div>
          </div>
        </div>
      )}

      <main className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4 sm:p-5 lg:flex-row lg:overflow-hidden">
        <aside className="shrink-0 space-y-4 lg:w-[340px] lg:overflow-y-auto lg:pr-1 xl:w-[360px]">
          {videoPath && (
            <VideoPreview ref={videoRef} videoPath={videoPath} caption={activeCue?.text} onTimeUpdate={setCurrentTimeMs} />
          )}
          <section className="panel">
            <div className="flex items-center gap-3">
              <div className="rounded-2xl bg-cyan-400/15 p-3 text-cyan-200">
                <FileVideo size={24} />
              </div>
              <div className="min-w-0">
                <p className="truncate font-medium">{videoPath ? fileName(videoPath) : '尚未导入视频'}</p>
                <p className="text-sm text-slate-400">{durationMs ? `时长 ${formatVttTime(durationMs)}` : '支持 mp4/mov/mkv/webm/avi/m4v'}</p>
                {projectPath && <p className="mt-0.5 truncate text-xs text-cyan-300/80" title={projectPath}>工程：{fileName(projectPath)}</p>}
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button className="btn-secondary" onClick={pickVideo} disabled={busy}>
                <Download size={16} />
                导入视频
              </button>
              <button className="btn-primary" onClick={generateSubtitles} disabled={busy || !videoPath}>
                {busy ? <Loader2 className="animate-spin" size={16} /> : <Wand2 size={16} />}
                生成字幕
              </button>
            </div>
          </section>

          <section className="panel">
            <h2 className="section-title">处理状态</h2>
            <p className="mt-3 rounded-xl bg-slate-900 p-3 text-sm text-slate-300">{status}</p>
            <div className="mt-4 grid grid-cols-2 gap-2 text-sm text-slate-400">
              <span>字幕条数</span>
              <strong className="text-right text-slate-100">{cues.length}</strong>
              <span>原文字数</span>
              <strong className="text-right text-slate-100">{totalText.length}</strong>
            </div>
          </section>

          {failedChunks.length > 0 && (
            <section className="panel space-y-2 border-red-400/25">
              <h2 className="section-title text-red-200">失败分片（{failedChunks.length}）</h2>
              <p className="text-xs leading-relaxed text-slate-400">已识别的分片已保留，可单独重试失败分片，无需重新提取音频。</p>
              <div className="space-y-2">
                {failedChunks.map((job) => (
                  <div key={job.chunk.index} className="rounded-xl border border-red-400/20 bg-red-500/5 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-red-100">
                        分片 #{job.chunk.index + 1}（{formatVttTime(job.chunk.startMs)} - {formatVttTime(job.chunk.endMs)}）
                      </span>
                      <button
                        className="btn-secondary"
                        disabled={busy || retryingIndex !== null}
                        onClick={() => retryChunk(job.chunk.index)}
                      >
                        {retryingIndex === job.chunk.index ? <Loader2 className="animate-spin" size={14} /> : <RefreshCw size={14} />}
                        重试
                      </button>
                    </div>
                    {job.error && <p className="mt-1.5 line-clamp-2 text-xs text-red-300/80">{job.error}</p>}
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="panel space-y-2">
            <h2 className="section-title">输出</h2>
            <label className="field">
              <span>翻译目标语言</span>
              <select
                value={TARGET_LANGUAGE_PRESETS.includes(settings.targetLanguage as (typeof TARGET_LANGUAGE_PRESETS)[number]) ? settings.targetLanguage : '__custom__'}
                onChange={(event) => {
                  if (event.target.value !== '__custom__') changeTargetLanguage(event.target.value)
                }}
              >
                {TARGET_LANGUAGE_PRESETS.map((language) => (
                  <option key={language} value={language}>{language}</option>
                ))}
                {!TARGET_LANGUAGE_PRESETS.includes(settings.targetLanguage as (typeof TARGET_LANGUAGE_PRESETS)[number]) && (
                  <option value="__custom__">{`自定义：${settings.targetLanguage || '未设置'}`}</option>
                )}
              </select>
            </label>
            <button className="btn-secondary w-full" disabled={!cues.length || busy} onClick={translateAll}>
              <Languages size={16} />
              翻译字幕
            </button>
            <div className="grid grid-cols-2 gap-2">
              <button className="btn-secondary" disabled={!cues.length} onClick={() => exportFile('srt')}>SRT</button>
              <button className="btn-secondary" disabled={!cues.length} onClick={() => exportFile('vtt')}>VTT</button>
              <button className="btn-secondary" disabled={!cues.length} onClick={() => exportFile('json')}>JSON</button>
              <button className="btn-secondary" disabled={!cues.length} onClick={() => exportFile('bilingual-srt')}>双语 SRT</button>
            </div>
            <button className="btn-ghost w-full" disabled={!totalText} onClick={() => clipboard?.writeText?.(totalText)}>
              复制原文
            </button>
          </section>
        </aside>

        <section className="panel flex min-h-[360px] flex-1 flex-col lg:min-h-0">
          <div className="mb-4 flex shrink-0 items-center justify-between gap-3">
            <h2 className="section-title">字幕时间轴</h2>
            <div className="flex items-center gap-3 text-sm text-slate-400">
              {videoPath && <span className="font-mono text-xs text-cyan-200">{formatVttTime(currentTimeMs)}</span>}
              <span className="hidden items-center gap-2 sm:flex">
                <Scissors size={15} />
                点击 ▶ 跳转 · 可编辑文本和时间
              </span>
            </div>
          </div>

          {!cues.length ? (
            <div className="flex flex-1 flex-col items-center justify-center rounded-3xl border border-dashed border-white/15 bg-slate-900/60 p-6 text-center">
              <Play className="mb-4 text-cyan-300" size={42} />
              <p className="text-lg font-medium">导入视频后生成字幕</p>
              <p className="mt-2 max-w-md text-sm text-slate-400">长视频会按 8 分钟分片并保留重叠窗口，再把每段时间戳回填到全局时间轴。</p>
            </div>
          ) : (
            <CueList
              cues={cues}
              onChange={updateCue}
              onDelete={deleteCue}
              onSplit={splitCue}
              onMerge={mergeCue}
              currentTimeMs={currentTimeMs}
              formatTime={formatVttTime}
              activeCueId={activeCue?.id ?? null}
              onSeek={seekToCue}
            />
          )}
        </section>
      </main>

      {showSettings && (
        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          onClick={(event) => {
            if (event.target === event.currentTarget) setShowSettings(false)
          }}
        >
          <div className="modal-card">
            <div className="modal-header">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-cyan-300">Settings</p>
                <h2 className="mt-1 text-lg font-semibold">ASR 与翻译设置</h2>
              </div>
              <button className="icon-button hover:text-white" aria-label="关闭设置" onClick={() => setShowSettings(false)}>
                <X size={18} />
              </button>
            </div>

            <div className="modal-body">
              <label className="field">
                <span>ASR Provider</span>
                <select value={settings.provider} onChange={(event) => setSettings({ ...settings, provider: event.target.value as ProviderId })}>
                  <option value="openai">OpenAI / Whisper</option>
                  <option value="volcengine">火山引擎豆包语音</option>
                </select>
              </label>
              {settings.provider === 'openai' ? (
                <>
                  <label className="field"><span>Base URL</span><input value={settings.openAiBaseUrl} onChange={(event) => setSettings({ ...settings, openAiBaseUrl: event.target.value })} /></label>
                  <label className="field"><span>模型</span><input value={settings.openAiModel} onChange={(event) => setSettings({ ...settings, openAiModel: event.target.value })} /></label>
                  <label className="field"><span>语言</span><input value={settings.openAiLanguage} onChange={(event) => setSettings({ ...settings, openAiLanguage: event.target.value })} /></label>
                  <label className="field"><span>API Key</span><input type="password" value={openAiKey} onChange={(event) => setOpenAiKey(event.target.value)} /></label>
                </>
              ) : (
                <>
                  <label className="field">
                    <span>接口版本</span>
                    <select value={settings.volcengineApiMode} onChange={(event) => setVolcengineApiMode(event.target.value as VolcengineApiMode)}>
                      <option value="standard">标准版（submit/query 异步，支持 2.0）</option>
                      <option value="flash">极速版（recognize/flash 同步）</option>
                    </select>
                  </label>
                  {settings.volcengineApiMode === 'flash' ? (
                    <label className="field"><span>Endpoint（极速版 recognize/flash）</span><input value={settings.volcengineEndpoint} onChange={(event) => setSettings({ ...settings, volcengineEndpoint: event.target.value })} /></label>
                  ) : (
                    <>
                      <label className="field"><span>Submit URL</span><input value={settings.volcengineSubmitUrl} onChange={(event) => setSettings({ ...settings, volcengineSubmitUrl: event.target.value })} /></label>
                      <label className="field"><span>Query URL</span><input value={settings.volcengineQueryUrl} onChange={(event) => setSettings({ ...settings, volcengineQueryUrl: event.target.value })} /></label>
                    </>
                  )}
                  <label className="field">
                    <span>Resource ID</span>
                    <input value={settings.volcengineResourceId} onChange={(event) => setSettings({ ...settings, volcengineResourceId: event.target.value })} placeholder={settings.volcengineApiMode === 'flash' ? 'volc.bigasr.auc_turbo' : 'volc.seedasr.auc'} />
                  </label>
                  <label className="field"><span>App ID（X-Api-App-Key）</span><input value={settings.volcengineAppId} onChange={(event) => setSettings({ ...settings, volcengineAppId: event.target.value })} /></label>
                  <label className="field"><span>Access Token（X-Api-Access-Key）</span><input type="password" value={volcengineKey} onChange={(event) => setVolcengineKey(event.target.value)} /></label>
                  <p className="text-xs leading-relaxed text-slate-500">标准版 2.0 用 <code>volc.seedasr.auc</code>，1.0 用 <code>volc.bigasr.auc</code>，极速版用 <code>volc.bigasr.auc_turbo</code>。Resource ID 必须与控制台开通的服务一致。</p>
                </>
              )}
              <label className="field">
                <span>目标语言（自定义）</span>
                <input value={settings.targetLanguage} onChange={(event) => setSettings({ ...settings, targetLanguage: event.target.value })} placeholder="可在主界面快速切换，或在此填写自定义语言" />
              </label>
              <label className="field">
                <span>翻译模型</span>
                <select value={settings.translateModel} onChange={(event) => setSettings({ ...settings, translateModel: event.target.value })}>
                  <option value="">使用 Mulby 默认模型</option>
                  {aiModels.map((model) => <option key={model.id} value={model.id}>{model.label || model.id}</option>)}
                </select>
              </label>
            </div>

            <div className="modal-footer flex items-center justify-end gap-2">
              <button className="btn-ghost" onClick={() => setShowSettings(false)}>取消</button>
              <button className="btn-primary" onClick={saveSettings}>
                <Save size={16} />
                保存设置
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

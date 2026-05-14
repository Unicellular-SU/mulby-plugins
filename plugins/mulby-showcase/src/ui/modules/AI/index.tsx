import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
    BadgeInfo,
    Bot,
    BrainCircuit,
    CircleStop,
    FileImage,
    Gauge,
    Image as ImageIcon,
    KeyRound,
    List,
    Paperclip,
    Play,
    PlugZap,
    RefreshCw,
    Search,
    Send,
    Sparkles,
    WandSparkles,
} from 'lucide-react'
import { PageHeader, Card, Button, StatusBadge, ApiReferencePanel } from '../../components'
import type { ApiExample, ApiReferenceGroup } from '../../components'
import { useMulby, useNotification } from '../../hooks'

type LoadingAction =
    | 'models'
    | 'call'
    | 'stream'
    | 'tokens'
    | 'connection'
    | 'connection-stream'
    | 'models-fetch'
    | 'tools'
    | 'discovery'
    | 'attachment-upload'
    | 'attachment-get'
    | 'attachment-delete'
    | 'image-generate'
    | 'image-stream'
    | 'image-edit'
    | null

type OperationStatus = 'success' | 'error' | 'info' | 'warning'

interface OperationLogItem {
    action: string
    status: OperationStatus
    message: string
    timestamp: number
    details?: unknown
}

interface HostCallResponse<T> {
    success: boolean
    data: T
    error?: string
}

interface ShowcaseHost {
    call<T>(method: string, ...args: unknown[]): Promise<HostCallResponse<T>>
}

interface AiToolDemoResult {
    content?: string | AiMessageContent[]
    reasoning?: string
    usage?: AiTokenBreakdown
    toolCall?: unknown
    toolResult?: unknown
    policyDebug?: unknown
}

type AiStreamChunk = Omit<AiMessage, 'chunkType'> & {
    __requestId?: string
    chunkType?: AiMessage['chunkType'] | 'tool-progress'
    tool_progress?: {
        id?: string
        name: string
        progress: number
        total?: number
        message?: string
    }
}

type ImageStreamRequest = ReturnType<MulbyAi['images']['generateStream']>
type AiMcpService = Awaited<ReturnType<MulbyAi['mcp']['listServers']>>[number]

const SHOWCASE_PLUGIN_ID = '@mulby/showcase'
const DEFAULT_PROMPT = '用两句话说明 Mulby 插件可以如何使用 AI API。'
const DEFAULT_TOOL_PROMPT = '请获取当前时间，然后回显“Mulby AI tool demo”。'
const DEFAULT_IMAGE_PROMPT = 'A clean desktop app icon concept for an AI API showcase, flat vector style'
const IMAGE_SIZE_OPTIONS = ['1024x1024', '1024x1536', '1536x1024']

function getErrorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error)
}

function formatTime(timestamp?: number | null) {
    if (!timestamp) return 'N/A'
    return new Date(timestamp).toLocaleTimeString()
}

function contentToText(content: AiMessage['content']) {
    if (!content) return ''
    if (typeof content === 'string') return content

    return content
        .map(item => {
            if (item.type === 'text') return item.text
            if (item.type === 'image') return `[image:${item.attachmentId}]`
            return `[file:${item.filename || item.attachmentId}]`
        })
        .join('\n')
}

function chunkToText(chunk: AiStreamChunk) {
    if (chunk.__requestId) return ''
    if (chunk.chunkType === 'reasoning' && chunk.reasoning_content) return `[reasoning] ${chunk.reasoning_content}`
    if (chunk.chunkType === 'tool-call') return `[tool-call] ${JSON.stringify(chunk.tool_call || {})}`
    if (chunk.chunkType === 'tool-result') return `[tool-result] ${JSON.stringify(chunk.tool_result || {})}`
    if (chunk.chunkType === 'tool-progress') return `[tool-progress] ${chunk.tool_progress?.name || 'tool'} ${chunk.tool_progress?.message || ''}`
    if (chunk.chunkType === 'error') return `[error] ${chunk.error?.message || 'AI stream failed'}`
    return contentToText(chunk.content)
}

function summarizeModel(model: AiModel) {
    return {
        id: model.id,
        label: model.label,
        providerLabel: model.providerLabel,
        endpointType: model.endpointType,
        capabilities: model.capabilities?.map(capability => capability.type) || [],
    }
}

function isTextModel(model: AiModel) {
    const capabilities = model.capabilities?.map(capability => capability.type) || []
    if (capabilities.length === 0) return model.endpointType !== 'image-generation'
    return capabilities.some(type => type === 'text' || type === 'reasoning' || type === 'function_calling')
}

function isImageModel(model: AiModel) {
    return model.endpointType === 'image-generation'
        || model.supportedEndpointTypes?.includes('image-generation')
        || model.id.toLowerCase().includes('image')
}

function redactProviderInput(input: { providerId: string; baseURL?: string; apiKey?: string }) {
    return {
        providerId: input.providerId,
        baseURL: input.baseURL || undefined,
        apiKey: input.apiKey ? '[redacted]' : undefined,
    }
}

function summarizeAttachment(attachment: AiAttachmentRef | null) {
    if (!attachment) return null
    return {
        attachmentId: attachment.attachmentId,
        mimeType: attachment.mimeType,
        size: attachment.size,
        filename: attachment.filename,
        purpose: attachment.purpose,
        expiresAt: attachment.expiresAt,
    }
}

function summarizeImages(images: string[]) {
    return images.map((image, index) => ({
        index,
        base64Length: image.length,
        preview: image.slice(0, 80),
    }))
}

function imageDataUrl(image: string) {
    return image.startsWith('data:') ? image : `data:image/png;base64,${image}`
}

function statusText(status: OperationStatus) {
    if (status === 'success') return '成功'
    if (status === 'warning') return '警告'
    if (status === 'error') return '失败'
    return '信息'
}

function formatTokenUsage(usage?: AiTokenBreakdown | null) {
    if (!usage) return 'N/A'
    const total = usage.inputTokens + usage.outputTokens
    return `${usage.inputTokens} input / ${usage.outputTokens} output / ${total} total`
}

export function AIModule() {
    const { ai, dialog, host } = useMulby(SHOWCASE_PLUGIN_ID)
    const showcaseHost = host as unknown as ShowcaseHost
    const notify = useNotification()

    const [models, setModels] = useState<AiModel[]>([])
    const [selectedModel, setSelectedModel] = useState('')
    const [selectedImageModel, setSelectedImageModel] = useState('')
    const [systemPrompt, setSystemPrompt] = useState('你是 Mulby Showcase 插件中的简洁助手。')
    const [prompt, setPrompt] = useState(DEFAULT_PROMPT)
    const [callResult, setCallResult] = useState<AiMessage | null>(null)
    const [streamText, setStreamText] = useState('')
    const [streamChunks, setStreamChunks] = useState<string[]>([])
    const [streamFinal, setStreamFinal] = useState<AiMessage | null>(null)
    const [connectionResult, setConnectionResult] = useState<{ success: boolean; message?: string } | null>(null)
    const [connectionStreamText, setConnectionStreamText] = useState('')
    const [tokenEstimate, setTokenEstimate] = useState<AiTokenBreakdown | null>(null)
    const [providerId, setProviderId] = useState('openai')
    const [providerBaseURL, setProviderBaseURL] = useState('')
    const [providerApiKey, setProviderApiKey] = useState('')
    const [fetchedModels, setFetchedModels] = useState<AiModel[]>([])
    const [modelsFetchMessage, setModelsFetchMessage] = useState<string | null>(null)
    const [toolPrompt, setToolPrompt] = useState(DEFAULT_TOOL_PROMPT)
    const [toolResult, setToolResult] = useState<AiToolDemoResult | null>(null)
    const [mcpServices, setMcpServices] = useState<AiMcpService[]>([])
    const [mcpTools, setMcpTools] = useState<AiMcpTool[]>([])
    const [enabledSkills, setEnabledSkills] = useState<AiSkillRecord[]>([])
    const [skillPreview, setSkillPreview] = useState<AiSkillPreview | null>(null)
    const [webSearchSettings, setWebSearchSettings] = useState<{ activeProvider: string; providers: Array<{ id: string; name: string; type: 'local' | 'api' | 'custom' }> } | null>(null)
    const [disabledPluginTools, setDisabledPluginTools] = useState<string[]>([])
    const [attachmentPath, setAttachmentPath] = useState('')
    const [attachmentMimeType, setAttachmentMimeType] = useState('image/png')
    const [attachment, setAttachment] = useState<AiAttachmentRef | null>(null)
    const [attachmentLookup, setAttachmentLookup] = useState<AiAttachmentRef | null>(null)
    const [imagePrompt, setImagePrompt] = useState(DEFAULT_IMAGE_PROMPT)
    const [imageSize, setImageSize] = useState(IMAGE_SIZE_OPTIONS[0])
    const [generatedImages, setGeneratedImages] = useState<string[]>([])
    const [imageStreamEvents, setImageStreamEvents] = useState<string[]>([])
    const [imageStreamPreview, setImageStreamPreview] = useState<string | null>(null)
    const [imageTokens, setImageTokens] = useState<AiTokenBreakdown | null>(null)
    const [operationLog, setOperationLog] = useState<OperationLogItem[]>([])
    const [loadingAction, setLoadingAction] = useState<LoadingAction>(null)

    const requestIdRef = useRef<string | null>(null)
    const abortedRef = useRef(false)
    const imageStreamRequestRef = useRef<ImageStreamRequest | null>(null)

    const textModels = useMemo(() => models.filter(isTextModel), [models])
    const imageModels = useMemo(() => models.filter(isImageModel), [models])
    const activeImageModel = selectedImageModel || imageModels[0]?.id || selectedModel

    const pushOperation = useCallback((item: Omit<OperationLogItem, 'timestamp'>) => {
        setOperationLog(current => [
            { ...item, timestamp: Date.now() },
            ...current,
        ].slice(0, 12))
    }, [])

    const callShowcaseHost = useCallback(async <T,>(method: string, ...args: unknown[]) => {
        const result = await showcaseHost.call<T>(method, ...args)
        if (!result.success) {
            throw new Error(result.error || `RPC 调用失败：${method}`)
        }
        return result.data
    }, [showcaseHost])

    const buildMessages = useCallback((userPrompt = prompt): AiMessage[] => [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
    ], [prompt, systemPrompt])

    const loadModels = useCallback(async () => {
        setLoadingAction('models')
        try {
            const nextModels = await ai.allModels()
            setModels(nextModels)
            const nextTextModel = nextModels.find(isTextModel) || nextModels[0]
            const nextImageModel = nextModels.find(isImageModel)
            if (!selectedModel && nextTextModel) setSelectedModel(nextTextModel.id)
            if (!selectedImageModel && nextImageModel) setSelectedImageModel(nextImageModel.id)
            pushOperation({
                action: 'ai.allModels',
                status: 'success',
                message: `已读取 ${nextModels.length} 个模型`,
            })
        } catch (error) {
            const message = getErrorMessage(error)
            pushOperation({ action: 'ai.allModels', status: 'error', message })
            notify.error(`模型读取失败: ${message}`)
        } finally {
            setLoadingAction(null)
        }
    }, [ai, notify, pushOperation, selectedImageModel, selectedModel])

    useEffect(() => {
        void loadModels()
    }, [loadModels])

    const runCall = useCallback(async () => {
        if (!prompt.trim()) {
            notify.warning('请输入提示词')
            return
        }

        setLoadingAction('call')
        setCallResult(null)
        try {
            const result = await ai.call({
                model: selectedModel || undefined,
                messages: buildMessages(),
                mcp: { mode: 'off' },
                skills: { mode: 'off' },
                toolingPolicy: { enableInternalTools: false },
                params: { temperature: 0.2, maxOutputTokens: 800 },
            })
            setCallResult(result)
            pushOperation({
                action: 'ai.call',
                status: 'success',
                message: `返回 ${contentToText(result.content).length} 个字符`,
                details: result.usage,
            })
        } catch (error) {
            const message = getErrorMessage(error)
            pushOperation({ action: 'ai.call', status: 'error', message })
            notify.error(`AI 调用失败: ${message}`)
        } finally {
            setLoadingAction(null)
        }
    }, [ai, buildMessages, notify, prompt, pushOperation, selectedModel])

    const runStream = useCallback(async () => {
        if (!prompt.trim()) {
            notify.warning('请输入提示词')
            return
        }

        abortedRef.current = false
        requestIdRef.current = null
        setStreamText('')
        setStreamChunks([])
        setStreamFinal(null)
        setLoadingAction('stream')

        try {
            const finalMessage = await ai.call(
                {
                    model: selectedModel || undefined,
                    messages: buildMessages(),
                    mcp: { mode: 'off' },
                    skills: { mode: 'off' },
                    toolingPolicy: { enableInternalTools: false },
                    params: { temperature: 0.2, maxOutputTokens: 800 },
                },
                (chunk) => {
                    const streamChunk = chunk as AiStreamChunk
                    if (streamChunk.__requestId) {
                        requestIdRef.current = streamChunk.__requestId
                        return
                    }

                    if (abortedRef.current) return

                    const text = chunkToText(streamChunk)
                    if (!text) return

                    setStreamChunks(current => [...current, text].slice(-40))
                    if (streamChunk.chunkType === 'text' || !streamChunk.chunkType) {
                        setStreamText(current => `${current}${text}`)
                    }
                }
            )

            if (abortedRef.current) return

            setStreamFinal(finalMessage)
            pushOperation({
                action: 'ai.call(stream)',
                status: 'success',
                message: `流式调用完成，requestId=${requestIdRef.current || 'N/A'}`,
                details: finalMessage.usage,
            })
        } catch (error) {
            const message = getErrorMessage(error)
            const isAbort = abortedRef.current
                || message.toLowerCase().includes('abort')
                || message.toLowerCase().includes('cancel')
            if (!isAbort) {
                pushOperation({ action: 'ai.call(stream)', status: 'error', message })
                notify.error(`流式调用失败: ${message}`)
            }
        } finally {
            setLoadingAction(null)
        }
    }, [ai, buildMessages, notify, prompt, pushOperation, selectedModel])

    const stopStream = useCallback(async () => {
        abortedRef.current = true
        const requestId = requestIdRef.current
        setLoadingAction(null)

        if (!requestId) {
            pushOperation({
                action: 'ai.abort',
                status: 'warning',
                message: '尚未收到 requestId，已停止本地 UI 写入',
            })
            return
        }

        try {
            await ai.abort(requestId)
            pushOperation({
                action: 'ai.abort',
                status: 'success',
                message: `已中止请求 ${requestId}`,
            })
        } catch (error) {
            const message = getErrorMessage(error)
            pushOperation({ action: 'ai.abort', status: 'error', message })
        }
    }, [ai, pushOperation])

    const estimateTokens = useCallback(async () => {
        setLoadingAction('tokens')
        try {
            const result = await ai.tokens.estimate({
                model: selectedModel || undefined,
                messages: buildMessages(),
                outputText: contentToText(callResult?.content),
            })
            setTokenEstimate(result)
            pushOperation({
                action: 'ai.tokens.estimate',
                status: 'success',
                message: `输入 ${result.inputTokens}，输出 ${result.outputTokens}`,
            })
        } catch (error) {
            const message = getErrorMessage(error)
            pushOperation({ action: 'ai.tokens.estimate', status: 'error', message })
            notify.error(`Token 估算失败: ${message}`)
        } finally {
            setLoadingAction(null)
        }
    }, [ai, buildMessages, callResult, notify, pushOperation, selectedModel])

    const testConnection = useCallback(async () => {
        setLoadingAction('connection')
        try {
            const result = await ai.testConnection({ model: selectedModel || undefined })
            setConnectionResult(result)
            pushOperation({
                action: 'ai.testConnection',
                status: result.success ? 'success' : 'warning',
                message: result.message || (result.success ? '连接正常' : '连接失败'),
            })
        } catch (error) {
            const message = getErrorMessage(error)
            setConnectionResult({ success: false, message })
            pushOperation({ action: 'ai.testConnection', status: 'error', message })
        } finally {
            setLoadingAction(null)
        }
    }, [ai, pushOperation, selectedModel])

    const testConnectionStream = useCallback(async () => {
        setConnectionStreamText('')
        setLoadingAction('connection-stream')
        try {
            const result = await ai.testConnectionStream(
                { model: selectedModel || undefined },
                (chunk) => {
                    setConnectionStreamText(current => `${current}${chunk.type === 'reasoning' ? '[reasoning] ' : ''}${chunk.text}`)
                }
            )
            setConnectionResult({ success: result.success, message: result.message })
            pushOperation({
                action: 'ai.testConnectionStream',
                status: result.success ? 'success' : 'warning',
                message: result.message || '流式连接测试完成',
                details: { reasoning: result.reasoning },
            })
        } catch (error) {
            const message = getErrorMessage(error)
            pushOperation({ action: 'ai.testConnectionStream', status: 'error', message })
        } finally {
            setLoadingAction(null)
        }
    }, [ai, pushOperation, selectedModel])

    const fetchProviderModels = useCallback(async () => {
        if (!providerId.trim()) {
            notify.warning('请输入 providerId')
            return
        }

        const input = {
            providerId: providerId.trim(),
            baseURL: providerBaseURL.trim() || undefined,
            apiKey: providerApiKey.trim() || undefined,
        }

        setLoadingAction('models-fetch')
        try {
            const result = await ai.models.fetch(input)
            setFetchedModels(result.models || [])
            setModelsFetchMessage(result.message || null)
            pushOperation({
                action: 'ai.models.fetch',
                status: 'success',
                message: `拉取到 ${result.models.length} 个模型`,
                details: redactProviderInput(input),
            })
        } catch (error) {
            const message = getErrorMessage(error)
            pushOperation({ action: 'ai.models.fetch', status: 'error', message, details: redactProviderInput(input) })
        } finally {
            setLoadingAction(null)
        }
    }, [ai, notify, providerApiKey, providerBaseURL, providerId, pushOperation])

    const runToolDemo = useCallback(async () => {
        setLoadingAction('tools')
        setToolResult(null)
        try {
            const result = await callShowcaseHost<AiToolDemoResult>('runAiToolDemo', {
                model: selectedModel || undefined,
                prompt: toolPrompt,
            })
            setToolResult(result)
            pushOperation({
                action: 'host.call(runAiToolDemo)',
                status: 'success',
                message: '内部工具调用完成',
                details: result.usage,
            })
        } catch (error) {
            const message = getErrorMessage(error)
            pushOperation({ action: 'host.call(runAiToolDemo)', status: 'error', message })
            notify.error(`工具调用示例失败: ${message}`)
        } finally {
            setLoadingAction(null)
        }
    }, [callShowcaseHost, notify, pushOperation, selectedModel, toolPrompt])

    const loadDiscovery = useCallback(async () => {
        setLoadingAction('discovery')
        try {
            const [services, skills, webSearch, disabledTools] = await Promise.all([
                ai.mcp.listServers(),
                ai.skills.listEnabled(),
                ai.tooling.webSearch.getSettings(),
                ai.tooling.pluginTools.getDisabled(),
            ])

            const activeServer = services.find(server => server.isActive) || services[0]
            const tools = activeServer ? await ai.mcp.listTools(activeServer.id) : []
            const preview = await ai.skills.preview({
                prompt,
                option: {
                    model: selectedModel || undefined,
                    messages: buildMessages(),
                },
            })

            setMcpServices(services)
            setMcpTools(tools)
            setEnabledSkills(skills)
            setSkillPreview(preview)
            setWebSearchSettings(webSearch)
            setDisabledPluginTools(disabledTools)
            pushOperation({
                action: 'ai discovery',
                status: 'success',
                message: `MCP ${services.length} 个，技能 ${skills.length} 个，插件工具禁用 ${disabledTools.length} 项`,
            })
        } catch (error) {
            const message = getErrorMessage(error)
            pushOperation({ action: 'ai discovery', status: 'error', message })
        } finally {
            setLoadingAction(null)
        }
    }, [ai, buildMessages, prompt, pushOperation, selectedModel])

    const chooseAttachmentFile = useCallback(async () => {
        try {
            const paths = await dialog.showOpenDialog({
                title: '选择 AI 附件',
                properties: ['openFile'],
                filters: [
                    { name: 'Images and Documents', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'pdf', 'txt', 'md'] },
                    { name: 'All Files', extensions: ['*'] },
                ],
            })
            if (paths[0]) {
                setAttachmentPath(paths[0])
                const lower = paths[0].toLowerCase()
                if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) setAttachmentMimeType('image/jpeg')
                else if (lower.endsWith('.webp')) setAttachmentMimeType('image/webp')
                else if (lower.endsWith('.pdf')) setAttachmentMimeType('application/pdf')
                else if (lower.endsWith('.txt')) setAttachmentMimeType('text/plain')
                else setAttachmentMimeType('image/png')
            }
        } catch (error) {
            notify.error(`选择文件失败: ${getErrorMessage(error)}`)
        }
    }, [dialog, notify])

    const uploadAttachment = useCallback(async () => {
        if (!attachmentPath.trim()) {
            notify.warning('请输入或选择附件路径')
            return
        }

        setLoadingAction('attachment-upload')
        try {
            const uploaded = await ai.attachments.upload({
                filePath: attachmentPath.trim(),
                mimeType: attachmentMimeType.trim() || 'application/octet-stream',
                purpose: attachmentMimeType.startsWith('image/') ? 'vision' : 'file',
            })
            setAttachment(uploaded)
            setAttachmentLookup(uploaded)
            pushOperation({
                action: 'ai.attachments.upload',
                status: 'success',
                message: `已上传 ${uploaded.attachmentId}`,
                details: summarizeAttachment(uploaded),
            })
        } catch (error) {
            const message = getErrorMessage(error)
            pushOperation({ action: 'ai.attachments.upload', status: 'error', message })
        } finally {
            setLoadingAction(null)
        }
    }, [ai, attachmentMimeType, attachmentPath, notify, pushOperation])

    const getAttachment = useCallback(async () => {
        if (!attachment?.attachmentId) {
            notify.warning('请先上传附件')
            return
        }

        setLoadingAction('attachment-get')
        try {
            const result = await ai.attachments.get(attachment.attachmentId)
            setAttachmentLookup(result)
            pushOperation({
                action: 'ai.attachments.get',
                status: result ? 'success' : 'warning',
                message: result ? `已读取 ${result.attachmentId}` : '附件不存在',
            })
        } catch (error) {
            const message = getErrorMessage(error)
            pushOperation({ action: 'ai.attachments.get', status: 'error', message })
        } finally {
            setLoadingAction(null)
        }
    }, [ai, attachment, notify, pushOperation])

    const deleteAttachment = useCallback(async () => {
        if (!attachment?.attachmentId) {
            notify.warning('请先上传附件')
            return
        }

        setLoadingAction('attachment-delete')
        try {
            await ai.attachments.delete(attachment.attachmentId)
            pushOperation({
                action: 'ai.attachments.delete',
                status: 'success',
                message: `已删除 ${attachment.attachmentId}`,
            })
            setAttachment(null)
            setAttachmentLookup(null)
        } catch (error) {
            const message = getErrorMessage(error)
            pushOperation({ action: 'ai.attachments.delete', status: 'error', message })
        } finally {
            setLoadingAction(null)
        }
    }, [ai, attachment, notify, pushOperation])

    const generateImage = useCallback(async () => {
        if (!activeImageModel) {
            notify.warning('当前没有可用的图像模型')
            return
        }

        setLoadingAction('image-generate')
        try {
            const result = await ai.images.generate({
                model: activeImageModel,
                prompt: imagePrompt,
                size: imageSize,
                count: 1,
            })
            setGeneratedImages(result.images)
            setImageTokens(result.tokens)
            pushOperation({
                action: 'ai.images.generate',
                status: 'success',
                message: `生成 ${result.images.length} 张图片`,
                details: result.tokens,
            })
        } catch (error) {
            const message = getErrorMessage(error)
            pushOperation({ action: 'ai.images.generate', status: 'error', message })
        } finally {
            setLoadingAction(null)
        }
    }, [activeImageModel, ai, imagePrompt, imageSize, notify, pushOperation])

    const generateImageStream = useCallback(async () => {
        if (!activeImageModel) {
            notify.warning('当前没有可用的图像模型')
            return
        }

        setImageStreamEvents([])
        setImageStreamPreview(null)
        setLoadingAction('image-stream')
        try {
            const request = ai.images.generateStream(
                {
                    model: activeImageModel,
                    prompt: imagePrompt,
                    size: imageSize,
                    count: 1,
                },
                (chunk) => {
                    const line = `${chunk.type}${chunk.stage ? `:${chunk.stage}` : ''}${chunk.message ? ` ${chunk.message}` : ''}`
                    setImageStreamEvents(current => [line, ...current].slice(0, 12))
                    if (chunk.image) setImageStreamPreview(chunk.image)
                }
            )
            imageStreamRequestRef.current = request
            const result = await request
            setGeneratedImages(result.images)
            setImageTokens(result.tokens)
            pushOperation({
                action: 'ai.images.generateStream',
                status: 'success',
                message: `流式生成 ${result.images.length} 张图片`,
            })
        } catch (error) {
            const message = getErrorMessage(error)
            const isAbort = message.toLowerCase().includes('abort') || message.toLowerCase().includes('cancel')
            pushOperation({
                action: 'ai.images.generateStream',
                status: isAbort ? 'warning' : 'error',
                message: isAbort ? '图片流式生成已中止' : message,
            })
        } finally {
            imageStreamRequestRef.current = null
            setLoadingAction(null)
        }
    }, [activeImageModel, ai, imagePrompt, imageSize, notify, pushOperation])

    const stopImageStream = useCallback(() => {
        imageStreamRequestRef.current?.abort()
        pushOperation({
            action: 'ai.images.generateStream.abort',
            status: 'info',
            message: '已请求停止图片流式生成',
        })
    }, [pushOperation])

    const editImage = useCallback(async () => {
        if (!activeImageModel) {
            notify.warning('当前没有可用的图像模型')
            return
        }
        if (!attachment?.attachmentId) {
            notify.warning('请先上传一个图像附件')
            return
        }

        setLoadingAction('image-edit')
        try {
            const result = await ai.images.edit({
                model: activeImageModel,
                imageAttachmentId: attachment.attachmentId,
                prompt: imagePrompt,
            })
            setGeneratedImages(result.images)
            setImageTokens(result.tokens)
            pushOperation({
                action: 'ai.images.edit',
                status: 'success',
                message: `编辑生成 ${result.images.length} 张图片`,
            })
        } catch (error) {
            const message = getErrorMessage(error)
            pushOperation({ action: 'ai.images.edit', status: 'error', message })
        } finally {
            setLoadingAction(null)
        }
    }, [activeImageModel, ai, attachment, imagePrompt, notify, pushOperation])

    const apiGroups: ApiReferenceGroup[] = useMemo(() => [
        {
            title: 'Chat And Stream',
            items: [
                { name: 'ai.call(option)', description: '非流式 AI 对话调用。' },
                { name: 'ai.call(option, onChunk)', description: '流式 AI 调用，首个 chunk 携带 requestId。' },
                { name: 'ai.abort(requestId)', description: '渲染进程可靠中止流式调用。' },
            ],
        },
        {
            title: 'Models And Tokens',
            items: [
                { name: 'ai.allModels()', description: '读取当前可用模型。' },
                { name: 'ai.models.fetch(input)', description: '按 provider 能力拉取模型列表。' },
                { name: 'ai.testConnection(input)', description: '快速测试模型或 provider 连通性。' },
                { name: 'ai.testConnectionStream(input, onChunk)', description: '流式连接测试并展示 reasoning/content。' },
                { name: 'ai.tokens.estimate(input)', description: '估算输入与输出 token。' },
            ],
        },
        {
            title: 'Tools And Discovery',
            items: [
                { name: 'option.tools', description: '本插件内部 per-call 工具定义，不需要 manifest.tools。' },
                { name: 'ai.mcp.listServers()', description: '只读列出 MCP 服务器。' },
                { name: 'ai.mcp.listTools(serverId)', description: '只读列出指定服务器工具。' },
                { name: 'ai.skills.listEnabled()', description: '只读列出已启用技能。' },
                { name: 'ai.skills.preview(input)', description: '预览本次调用会匹配的技能策略。' },
                { name: 'ai.tooling.webSearch.getSettings()', description: '只读查看网络搜索 provider 配置。' },
                { name: 'ai.tooling.pluginTools.getDisabled()', description: '只读查看被禁用的全局插件工具。' },
            ],
        },
        {
            title: 'Attachments And Images',
            items: [
                { name: 'ai.attachments.upload(input)', description: '上传文件或二进制数据供多模态消息引用。' },
                { name: 'ai.attachments.get(attachmentId)', description: '读取附件元信息。' },
                { name: 'ai.attachments.delete(attachmentId)', description: '删除 AI 附件。' },
                { name: 'ai.images.generate(input)', description: '生成图片并返回 base64。' },
                { name: 'ai.images.generateStream(input, onChunk)', description: '流式图片生成，展示进度与预览。' },
                { name: 'ai.images.edit(input)', description: '基于图像附件编辑生成。' },
            ],
        },
    ], [])

    const apiExamples: ApiExample[] = useMemo(() => [
        {
            title: '流式调用与中止',
            code: `const requestIdRef = useRef<string | null>(null)
const abortedRef = useRef(false)

const req = ai.call(option, (chunk: any) => {
  if (chunk.__requestId) {
    requestIdRef.current = chunk.__requestId
    return
  }
  if (abortedRef.current) return
  appendChunk(chunk)
})

abortedRef.current = true
if (requestIdRef.current) {
  await ai.abort(requestIdRef.current)
}

await req`,
        },
        {
            title: '模型、连接与 Token',
            code: `const models = await ai.allModels()
const connection = await ai.testConnection({ model })
const stream = await ai.testConnectionStream({ model }, chunk => {
  console.log(chunk.type, chunk.text)
})
const fetched = await ai.models.fetch({ providerId, baseURL, apiKey })
const tokens = await ai.tokens.estimate({
  model,
  messages: [{ role: 'user', content: prompt }]
})`,
        },
        {
            title: '插件内部工具',
            code: `// main.ts
export const rpc = {
  getShowcaseTime() {
    return { iso: new Date().toISOString() }
  },
  async runAiToolDemo(input) {
    return await mulby.ai.call({
      model: input.model,
      messages: [{ role: 'user', content: input.prompt }],
      tools: [{ type: 'function', function: { name: 'getShowcaseTime', parameters: { type: 'object', properties: {} } } }],
      maxToolSteps: 4
    })
  }
}`,
        },
        {
            title: '附件与图片',
            code: `const attachment = await ai.attachments.upload({
  filePath,
  mimeType: 'image/png',
  purpose: 'vision'
})

const image = await ai.images.generate({ model, prompt, size: '1024x1024', count: 1 })
const edited = await ai.images.edit({
  model,
  imageAttachmentId: attachment.attachmentId,
  prompt: 'Add a red scarf'
})`,
        },
    ], [])

    const rawData = useMemo(() => ({
        models: {
            count: models.length,
            textCount: textModels.length,
            imageCount: imageModels.length,
            selectedModel,
            selectedImageModel: activeImageModel,
            items: models.slice(0, 12).map(summarizeModel),
        },
        call: {
            promptLength: prompt.length,
            result: callResult ? {
                textLength: contentToText(callResult.content).length,
                usage: callResult.usage,
                chunkType: callResult.chunkType,
            } : null,
            stream: {
                requestId: requestIdRef.current,
                textLength: streamText.length,
                chunks: streamChunks.slice(-8),
                finalUsage: streamFinal?.usage,
            },
            tokenEstimate,
        },
        connection: {
            result: connectionResult,
            streamTextLength: connectionStreamText.length,
            lastFetch: {
                input: redactProviderInput({ providerId, baseURL: providerBaseURL, apiKey: providerApiKey }),
                modelCount: fetchedModels.length,
                message: modelsFetchMessage,
            },
        },
        toolsAndDiscovery: {
            toolResult: toolResult ? {
                contentLength: contentToText(toolResult.content).length,
                usage: toolResult.usage,
                hasToolCall: Boolean(toolResult.toolCall),
                hasToolResult: Boolean(toolResult.toolResult),
            } : null,
            mcpServices: mcpServices.map(server => ({
                id: server.id,
                name: server.name,
                type: server.type,
                isActive: server.isActive,
                installSource: server.installSource,
            })),
            mcpTools: mcpTools.slice(0, 20).map(tool => ({
                id: tool.id,
                name: tool.name,
                serverId: tool.serverId,
            })),
            enabledSkills: enabledSkills.map(skill => ({
                id: skill.id,
                name: skill.descriptor.name,
                source: skill.source,
                trustLevel: skill.trustLevel,
            })),
            skillPreview: skillPreview ? {
                selected: skillPreview.selected.map(skill => skill.descriptor.name),
                reasons: skillPreview.reasons,
                mcpImpact: skillPreview.mcpImpact,
            } : null,
            webSearchSettings,
            disabledPluginTools,
        },
        attachmentsAndImages: {
            attachment: summarizeAttachment(attachment),
            attachmentLookup: summarizeAttachment(attachmentLookup),
            imagePromptLength: imagePrompt.length,
            imageSize,
            imageTokens,
            generatedImages: summarizeImages(generatedImages),
            stream: {
                events: imageStreamEvents,
                preview: imageStreamPreview ? summarizeImages([imageStreamPreview])[0] : null,
            },
        },
        operations: operationLog,
    }), [
        activeImageModel,
        attachment,
        attachmentLookup,
        callResult,
        connectionResult,
        connectionStreamText,
        disabledPluginTools,
        enabledSkills,
        fetchedModels,
        generatedImages,
        imageModels,
        imagePrompt,
        imageSize,
        imageStreamEvents,
        imageStreamPreview,
        imageTokens,
        mcpServices,
        mcpTools,
        models,
        modelsFetchMessage,
        operationLog,
        prompt,
        providerApiKey,
        providerBaseURL,
        providerId,
        selectedImageModel,
        selectedModel,
        skillPreview,
        streamChunks,
        streamFinal,
        streamText,
        textModels,
        tokenEstimate,
        toolResult,
        webSearchSettings,
    ])

    return (
        <div className="main-content">
            <PageHeader
                icon={WandSparkles}
                title="AI"
                description="AI 对话、流式中止、模型、Token、内部工具、附件和图片能力"
                actions={(
                    <Button variant="secondary" onClick={() => void loadModels()} loading={loadingAction === 'models'}>
                        <RefreshCw className="inline-icon" aria-hidden="true" size={14} />
                        刷新模型
                    </Button>
                )}
            />

            <div className="page-with-api-panel">
                <div className="page-content">
                    <div style={{ display: 'grid', gap: 'var(--spacing-lg)', minWidth: 0 }}>
                        <Card title="模型与当前状态" icon={BrainCircuit}>
                            <div className="stats-grid" style={{ marginBottom: 'var(--spacing-lg)' }}>
                                <div className="stat-item">
                                    <div className="stat-value">{models.length}</div>
                                    <div className="stat-label">全部模型</div>
                                </div>
                                <div className="stat-item">
                                    <div className="stat-value">{textModels.length}</div>
                                    <div className="stat-label">文本模型</div>
                                </div>
                                <div className="stat-item">
                                    <div className="stat-value">{imageModels.length}</div>
                                    <div className="stat-label">图像模型</div>
                                </div>
                                <div className="stat-item">
                                    <div className="stat-value">
                                        <StatusBadge status={selectedModel ? 'success' : 'warning'}>
                                            {selectedModel ? '已选择' : '未选择'}
                                        </StatusBadge>
                                    </div>
                                    <div className="stat-label">当前模型</div>
                                </div>
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 'var(--spacing-md)' }}>
                                <div className="input-group">
                                    <label className="input-label">文本模型</label>
                                    <select className="select" value={selectedModel} onChange={event => setSelectedModel(event.target.value)}>
                                        <option value="">使用宿主默认模型</option>
                                        {models.map(model => (
                                            <option value={model.id} key={model.id}>
                                                {model.label || model.id}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                <div className="input-group">
                                    <label className="input-label">图像模型</label>
                                    <select className="select" value={selectedImageModel} onChange={event => setSelectedImageModel(event.target.value)}>
                                        <option value="">自动选择或使用文本模型</option>
                                        {models.map(model => (
                                            <option value={model.id} key={model.id}>
                                                {model.label || model.id}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            </div>
                        </Card>

                        <Card
                            title="对话与流式中止"
                            icon={Bot}
                            actions={(
                                <>
                                    <Button onClick={() => void runCall()} loading={loadingAction === 'call'}>
                                        <Send className="inline-icon" aria-hidden="true" size={14} />
                                        调用
                                    </Button>
                                    <Button variant="secondary" onClick={() => void runStream()} loading={loadingAction === 'stream'}>
                                        <Play className="inline-icon" aria-hidden="true" size={14} />
                                        流式
                                    </Button>
                                    <Button variant="secondary" onClick={() => void stopStream()} disabled={loadingAction !== 'stream'}>
                                        <CircleStop className="inline-icon" aria-hidden="true" size={14} />
                                        停止
                                    </Button>
                                    <Button variant="secondary" onClick={() => void estimateTokens()} loading={loadingAction === 'tokens'}>
                                        <Gauge className="inline-icon" aria-hidden="true" size={14} />
                                        估算
                                    </Button>
                                </>
                            )}
                        >
                            <div style={{ display: 'grid', gap: 'var(--spacing-md)' }}>
                                <div className="input-group">
                                    <label className="input-label">系统提示词</label>
                                    <input className="input" value={systemPrompt} onChange={event => setSystemPrompt(event.target.value)} />
                                </div>
                                <div className="input-group">
                                    <label className="input-label">用户提示词</label>
                                    <textarea className="textarea" value={prompt} onChange={event => setPrompt(event.target.value)} rows={4} />
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 'var(--spacing-md)' }}>
                                    <div className="preview-box" style={{ display: 'block', minHeight: 160, whiteSpace: 'pre-wrap' }}>
                                        {callResult ? contentToText(callResult.content) : '非流式结果会显示在这里'}
                                    </div>
                                    <div className="preview-box" style={{ display: 'block', minHeight: 160, whiteSpace: 'pre-wrap' }}>
                                        {streamText || streamChunks.join('\n') || '流式片段会显示在这里'}
                                    </div>
                                </div>
                                <div className="info-grid">
                                    <span className="info-label">Request ID</span>
                                    <span className="info-value">{requestIdRef.current || 'N/A'}</span>
                                    <span className="info-label">实际 Token</span>
                                    <span className="info-value">{formatTokenUsage(callResult?.usage)}</span>
                                    <span className="info-label">流式 Token</span>
                                    <span className="info-value">{formatTokenUsage(streamFinal?.usage)}</span>
                                    <span className="info-label">估算 Token</span>
                                    <span className="info-value">
                                        {formatTokenUsage(tokenEstimate)}
                                    </span>
                                </div>
                            </div>
                        </Card>

                        <Card
                            title="连接与模型发现"
                            icon={PlugZap}
                            actions={(
                                <>
                                    <Button onClick={() => void testConnection()} loading={loadingAction === 'connection'}>
                                        <KeyRound className="inline-icon" aria-hidden="true" size={14} />
                                        测试
                                    </Button>
                                    <Button variant="secondary" onClick={() => void testConnectionStream()} loading={loadingAction === 'connection-stream'}>
                                        <Sparkles className="inline-icon" aria-hidden="true" size={14} />
                                        流式测试
                                    </Button>
                                    <Button variant="secondary" onClick={() => void fetchProviderModels()} loading={loadingAction === 'models-fetch'}>
                                        <Search className="inline-icon" aria-hidden="true" size={14} />
                                        拉取模型
                                    </Button>
                                </>
                            )}
                        >
                            <div style={{ display: 'grid', gap: 'var(--spacing-md)' }}>
                                <div className="info-grid">
                                    <span className="info-label">连接状态</span>
                                    <span className="info-value">
                                        {connectionResult ? (
                                            <StatusBadge status={connectionResult.success ? 'success' : 'warning'}>
                                                {connectionResult.message || (connectionResult.success ? '成功' : '失败')}
                                            </StatusBadge>
                                        ) : '未测试'}
                                    </span>
                                    <span className="info-label">流式输出</span>
                                    <span className="info-value">{connectionStreamText || 'N/A'}</span>
                                </div>

                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 'var(--spacing-md)' }}>
                                    <div className="input-group">
                                        <label className="input-label">Provider ID</label>
                                        <input className="input" value={providerId} onChange={event => setProviderId(event.target.value)} />
                                    </div>
                                    <div className="input-group">
                                        <label className="input-label">Base URL</label>
                                        <input className="input" value={providerBaseURL} onChange={event => setProviderBaseURL(event.target.value)} placeholder="可选" />
                                    </div>
                                    <div className="input-group">
                                        <label className="input-label">API Key</label>
                                        <input className="input" type="password" value={providerApiKey} onChange={event => setProviderApiKey(event.target.value)} placeholder="可选" />
                                    </div>
                                </div>

                                <div className="list-row">
                                    <List className="inline-icon" aria-hidden="true" size={14} />
                                    <span className="list-row-main">拉取结果：{fetchedModels.length} 个模型</span>
                                    <span className="list-row-meta">{modelsFetchMessage || '无附加信息'}</span>
                                </div>
                            </div>
                        </Card>

                        <Card
                            title="内部工具与只读发现"
                            icon={WandSparkles}
                            actions={(
                                <>
                                    <Button onClick={() => void runToolDemo()} loading={loadingAction === 'tools'}>
                                        <Play className="inline-icon" aria-hidden="true" size={14} />
                                        工具调用
                                    </Button>
                                    <Button variant="secondary" onClick={() => void loadDiscovery()} loading={loadingAction === 'discovery'}>
                                        <RefreshCw className="inline-icon" aria-hidden="true" size={14} />
                                        只读发现
                                    </Button>
                                </>
                            )}
                        >
                            <div style={{ display: 'grid', gap: 'var(--spacing-md)' }}>
                                <div className="input-group">
                                    <label className="input-label">工具调用提示词</label>
                                    <input className="input" value={toolPrompt} onChange={event => setToolPrompt(event.target.value)} />
                                </div>
                                <div className="preview-box" style={{ display: 'block', minHeight: 120, whiteSpace: 'pre-wrap' }}>
                                    {toolResult ? contentToText(toolResult.content) : '后端 runAiToolDemo 会通过 option.tools 调用 getShowcaseTime/getShowcaseEcho'}
                                </div>
                                <div className="stats-grid">
                                    <div className="stat-item">
                                        <div className="stat-value">{mcpServices.length}</div>
                                        <div className="stat-label">MCP 服务器</div>
                                    </div>
                                    <div className="stat-item">
                                        <div className="stat-value">{mcpTools.length}</div>
                                        <div className="stat-label">MCP 工具</div>
                                    </div>
                                    <div className="stat-item">
                                        <div className="stat-value">{enabledSkills.length}</div>
                                        <div className="stat-label">已启用技能</div>
                                    </div>
                                    <div className="stat-item">
                                        <div className="stat-value">{disabledPluginTools.length}</div>
                                        <div className="stat-label">禁用插件工具</div>
                                    </div>
                                </div>
                                <div className="info-grid">
                                    <span className="info-label">Web Search</span>
                                    <span className="info-value">{webSearchSettings ? `${webSearchSettings.activeProvider} / ${webSearchSettings.providers.length} providers` : 'N/A'}</span>
                                    <span className="info-label">Skill Preview</span>
                                    <span className="info-value">{skillPreview ? `${skillPreview.selected.length} selected` : 'N/A'}</span>
                                </div>
                            </div>
                        </Card>

                        <Card
                            title="附件与图片"
                            icon={ImageIcon}
                            actions={(
                                <>
                                    <Button onClick={() => void uploadAttachment()} loading={loadingAction === 'attachment-upload'}>
                                        <Paperclip className="inline-icon" aria-hidden="true" size={14} />
                                        上传
                                    </Button>
                                    <Button variant="secondary" onClick={() => void getAttachment()} loading={loadingAction === 'attachment-get'}>
                                        <BadgeInfo className="inline-icon" aria-hidden="true" size={14} />
                                        读取
                                    </Button>
                                    <Button variant="secondary" onClick={() => void deleteAttachment()} loading={loadingAction === 'attachment-delete'}>
                                        <CircleStop className="inline-icon" aria-hidden="true" size={14} />
                                        删除
                                    </Button>
                                </>
                            )}
                        >
                            <div style={{ display: 'grid', gap: 'var(--spacing-md)' }}>
                                <div className="input-row">
                                    <div className="input-group" style={{ flex: 1 }}>
                                        <label className="input-label">附件路径</label>
                                        <input className="input" value={attachmentPath} onChange={event => setAttachmentPath(event.target.value)} placeholder="D:\\path\\image.png" />
                                    </div>
                                    <div className="input-group" style={{ width: 180 }}>
                                        <label className="input-label">MIME</label>
                                        <input className="input" value={attachmentMimeType} onChange={event => setAttachmentMimeType(event.target.value)} />
                                    </div>
                                    <div className="input-group" style={{ alignSelf: 'end' }}>
                                        <Button variant="secondary" onClick={() => void chooseAttachmentFile()}>
                                            <FileImage className="inline-icon" aria-hidden="true" size={14} />
                                            选择
                                        </Button>
                                    </div>
                                </div>

                                <div className="info-grid">
                                    <span className="info-label">Attachment</span>
                                    <span className="info-value">{attachment?.attachmentId || 'N/A'}</span>
                                    <span className="info-label">Lookup</span>
                                    <span className="info-value">{attachmentLookup ? `${attachmentLookup.mimeType} / ${attachmentLookup.size} bytes` : 'N/A'}</span>
                                </div>

                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 'var(--spacing-md)' }}>
                                    <div className="input-group">
                                        <label className="input-label">图片提示词</label>
                                        <textarea className="textarea" value={imagePrompt} onChange={event => setImagePrompt(event.target.value)} rows={3} />
                                    </div>
                                    <div style={{ display: 'grid', gap: 'var(--spacing-md)' }}>
                                        <div className="input-group">
                                            <label className="input-label">尺寸</label>
                                            <select className="select" value={imageSize} onChange={event => setImageSize(event.target.value)}>
                                                {IMAGE_SIZE_OPTIONS.map(size => <option key={size} value={size}>{size}</option>)}
                                            </select>
                                        </div>
                                        <div className="action-bar">
                                            <Button onClick={() => void generateImage()} loading={loadingAction === 'image-generate'} disabled={!activeImageModel}>
                                                <Sparkles className="inline-icon" aria-hidden="true" size={14} />
                                                生成
                                            </Button>
                                            <Button variant="secondary" onClick={() => void generateImageStream()} loading={loadingAction === 'image-stream'} disabled={!activeImageModel}>
                                                <Play className="inline-icon" aria-hidden="true" size={14} />
                                                流式生成
                                            </Button>
                                            <Button variant="secondary" onClick={stopImageStream} disabled={loadingAction !== 'image-stream'}>
                                                <CircleStop className="inline-icon" aria-hidden="true" size={14} />
                                                停止图片流
                                            </Button>
                                            <Button variant="secondary" onClick={() => void editImage()} loading={loadingAction === 'image-edit'} disabled={!activeImageModel || !attachment}>
                                                <ImageIcon className="inline-icon" aria-hidden="true" size={14} />
                                                编辑
                                            </Button>
                                        </div>
                                    </div>
                                </div>

                                <div className="preview-box" style={{ minHeight: 220 }}>
                                    {generatedImages[0] || imageStreamPreview ? (
                                        <img src={imageDataUrl(generatedImages[0] || imageStreamPreview || '')} alt="AI generated preview" />
                                    ) : (
                                        activeImageModel ? '图片结果会显示在这里' : '当前没有识别到图像模型'
                                    )}
                                </div>
                            </div>
                        </Card>

                        <Card title="操作记录" icon={List}>
                            <div style={{ display: 'grid', gap: 'var(--spacing-sm)' }}>
                                {operationLog.length === 0 ? (
                                    <div className="empty-state">暂无操作记录</div>
                                ) : operationLog.map(item => (
                                    <div className="list-row" key={`${item.action}-${item.timestamp}`}>
                                        <StatusBadge status={item.status}>{statusText(item.status)}</StatusBadge>
                                        <span className="list-row-main">{item.action}: {item.message}</span>
                                        <span className="list-row-meta">{formatTime(item.timestamp)}</span>
                                    </div>
                                ))}
                            </div>
                        </Card>
                    </div>
                </div>

                <ApiReferencePanel apiGroups={apiGroups} examples={apiExamples} rawData={rawData} />
            </div>
        </div>
    )
}

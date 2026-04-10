import { useState, useRef, useEffect, useCallback } from 'react'
import {
  Send, Bot, User, Lock, ShoppingCart, Code,
  Sparkles, LayoutGrid, GitBranch, AlignCenter,
  BrainCircuit, ChevronDown, ChevronRight, Wrench, StopCircle,
  Workflow, Database,
} from 'lucide-react'
import { useFlowStore, type ChatMessage, type ToolCallInfo } from '../store/flowStore'
import { useMulby } from '../hooks/useMulby'
import { useAutoLayout } from '../hooks/useAutoLayout'
import { generateFlowchart, editFlowchart, abortGeneration, type StreamCallbacks } from '../services/aiService'
import { parsePartialFlowData } from '../utils/incrementalParser'

const PLUGIN_ID = 'ai-flowchart'

// 快捷短语
const QUICK_PHRASES = [
  { label: '自动排版', icon: AlignCenter },
  { label: '增加分支', icon: GitBranch },
  { label: '简化流程', icon: LayoutGrid },
]

// ============ 推理过程折叠组件 ============
function ReasoningBlock({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false)
  if (!text) return null
  return (
    <div className="reasoning-block">
      <button
        className="reasoning-block__toggle"
        onClick={() => setExpanded(!expanded)}
      >
        <BrainCircuit size={13} />
        <span>推理过程</span>
        {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
      </button>
      {expanded && (
        <div className="reasoning-block__content">{text}</div>
      )}
    </div>
  )
}

// ============ 工具调用展示组件 ============
function ToolCallsBlock({ calls }: { calls: ToolCallInfo[] }) {
  const [expanded, setExpanded] = useState<Record<number, boolean>>({})
  if (!calls.length) return null
  return (
    <div className="tool-calls-block">
      {calls.map((tc, i) => (
        <div key={i} className="tool-call-item">
          <button
            className="tool-call-item__header"
            onClick={() => setExpanded((s) => ({ ...s, [i]: !s[i] }))}
          >
            <Wrench size={12} />
            <span className="tool-call-item__name">{tc.name}</span>
            {expanded[i] ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
          {expanded[i] && (
            <div className="tool-call-item__detail">
              {tc.args && (
                <div className="tool-call-item__section">
                  <span className="tool-call-item__label">参数</span>
                  <pre>{tc.args}</pre>
                </div>
              )}
              {tc.result && (
                <div className="tool-call-item__section">
                  <span className="tool-call-item__label">结果</span>
                  <pre>{tc.result}</pre>
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// ============ 流式输出展示组件 ============
function StreamingBubble() {
  const { streamingText, streamingReasoning, streamingToolCalls } = useFlowStore()
  const hasContent = streamingText || streamingReasoning || streamingToolCalls.length > 0

  if (!hasContent) {
    // 还没收到任何 chunk，显示加载动画
    return (
      <div className="chat-bubble chat-bubble--assistant">
        <div className="chat-bubble__avatar"><Bot size={16} /></div>
        <div className="chat-bubble__content chat-bubble__loading">
          <span className="dot"></span>
          <span className="dot"></span>
          <span className="dot"></span>
        </div>
      </div>
    )
  }

  return (
    <div className="chat-bubble chat-bubble--assistant">
      <div className="chat-bubble__avatar"><Bot size={16} /></div>
      <div className="chat-bubble__content chat-bubble__streaming">
        {streamingReasoning && (
          <div className="streaming-reasoning">
            <BrainCircuit size={13} className="streaming-reasoning__icon" />
            <span className="streaming-reasoning__text">{streamingReasoning}</span>
            <span className="streaming-cursor" />
          </div>
        )}
        <ToolCallsBlock calls={streamingToolCalls} />
        {streamingText && (
          <div className="streaming-text">
            {streamingText}
            <span className="streaming-cursor" />
          </div>
        )}
      </div>
    </div>
  )
}

// ============ 主组件 ============
export default function ChatPanel() {
  const {
    messages, addMessage,
    nodes, edges, metadata, diagramType,
    setNodes, setEdges, setMetadata,
    isGenerating, setIsGenerating,
    sessionId, pushHistory, selectedModel,
    appendStreamingText, appendStreamingReasoning,
    addStreamingToolCall, updateLastToolCallResult,
    resetStreaming,
  } = useFlowStore()

  const { ai } = useMulby(PLUGIN_ID)
  const { performLayout, performQuickLayout } = useAutoLayout()
  const [inputText, setInputText] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // 自动滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // 流式输出变化时也滚动
  const { streamingText, streamingReasoning } = useFlowStore()
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [streamingText, streamingReasoning])

  // ============ 增量绘制：边输出边绘制 ============
  const lastRenderedCountRef = useRef({ nodes: 0, edges: 0 })

  useEffect(() => {
    if (!isGenerating || !streamingText) return

    const partial = parsePartialFlowData(streamingText)
    if (!partial) return

    const { nodes: parsedNodes, edges: parsedEdges } = partial
    const prevCount = lastRenderedCountRef.current

    // 只在有新节点/边时才更新画布
    if (parsedNodes.length <= prevCount.nodes && parsedEdges.length <= prevCount.edges) return

    // 增量阶段使用快速布局（不等待 DOM 测量，避免卡顿）
    performQuickLayout(parsedNodes, parsedEdges, partial.metadata)

    lastRenderedCountRef.current = { nodes: parsedNodes.length, edges: parsedEdges.length }
  }, [streamingText, isGenerating, performQuickLayout])

  // 发送消息
  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || isGenerating) return

    const userMsg: ChatMessage = {
      id: `msg_${Date.now()}`,
      role: 'user',
      content: text.trim(),
      timestamp: Date.now(),
    }
    addMessage(userMsg)
    setInputText('')
    setIsGenerating(true)
    resetStreaming()
    lastRenderedCountRef.current = { nodes: 0, edges: 0 }

    // 构建流式回调
    const callbacks: StreamCallbacks = {
      onText: (t) => appendStreamingText(t),
      onReasoning: (t) => appendStreamingReasoning(t),
      onToolCall: (name, args) => addStreamingToolCall({ name, args }),
      onToolResult: (result) => updateLastToolCallResult(result),
    }

    try {
      // 直接在前端流式调用 mulby.ai
      const result = nodes.length === 0
        ? await generateFlowchart(ai, sessionId, text.trim(), selectedModel, callbacks, diagramType)
        : await editFlowchart(ai, sessionId, text.trim(), { nodes, edges, metadata }, selectedModel, callbacks, diagramType)

      // 获取最终的推理和工具调用数据
      const finalReasoning = useFlowStore.getState().streamingReasoning
      const finalToolCalls = [...useFlowStore.getState().streamingToolCalls]

      // 添加完整的 AI 回复消息
      const aiMsg: ChatMessage = {
        id: `msg_${Date.now()}_ai`,
        role: 'assistant',
        content: result.message || 'AI 处理完成',
        reasoning: finalReasoning || undefined,
        toolCalls: finalToolCalls.length > 0 ? finalToolCalls : undefined,
        timestamp: Date.now(),
      }
      addMessage(aiMsg)

      // AI 完成后：用两阶段精确布局（覆盖增量结果）
      if (result.flowData) {
        pushHistory()
        const fd = result.flowData
        if (fd.nodes) {
          await performLayout(fd.nodes, fd.edges || [], fd.metadata)
        } else if (fd.metadata) {
          setMetadata(fd.metadata)
        }
      }
    } catch (err: any) {
      const errorMsg: ChatMessage = {
        id: `msg_${Date.now()}_err`,
        role: 'assistant',
        content: `错误: ${err?.message || '请求失败，请重试'}`,
        timestamp: Date.now(),
      }
      addMessage(errorMsg)
    } finally {
      setIsGenerating(false)
      resetStreaming()
    }
  }, [
    isGenerating, nodes, edges, metadata, diagramType, sessionId, ai, selectedModel,
    addMessage, setIsGenerating, setNodes, setEdges, setMetadata, pushHistory,
    appendStreamingText, appendStreamingReasoning, addStreamingToolCall,
    updateLastToolCallResult, resetStreaming, performLayout, performQuickLayout,
  ])

  // 键盘事件
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage(inputText)
    }
  }

  return (
    <div className="chat-panel">
      {/* 消息列表 */}
      <div className="chat-panel__messages">
        {messages.length === 0 && (
          <div className="chat-panel__welcome">
            <Sparkles className="chat-panel__welcome-icon" size={48} />
            <h3>
              {diagramType === 'swimlane' ? 'AI 泳道图' : diagramType === 'er' ? 'AI ER 图' : 'AI 流程图'}
            </h3>
            <p>
              {diagramType === 'swimlane'
                ? '描述你的跨部门/角色协作流程，AI 帮你生成泳道图'
                : diagramType === 'er'
                ? '描述你的业务场景，AI 帮你设计数据库 ER 图'
                : '描述你想要的流程图，AI 帮你生成'}
            </p>
            <div className="chat-panel__examples">
              {diagramType === 'flowchart' && (
                <>
                  <button onClick={() => setInputText('画一个用户登录注册流程')}>
                    <Lock size={14} /> 用户登录注册流程
                  </button>
                  <button onClick={() => setInputText('画一个电商下单支付流程')}>
                    <ShoppingCart size={14} /> 电商下单支付流程
                  </button>
                  <button onClick={() => setInputText('画一个代码review审核流程')}>
                    <Code size={14} /> 代码 Review 流程
                  </button>
                </>
              )}
              {diagramType === 'swimlane' && (
                <>
                  <button onClick={() => setInputText('画一个跨部门请假审批泳道图，包含员工、主管、HR、财务')}>
                    <Workflow size={14} /> 请假审批流程
                  </button>
                  <button onClick={() => setInputText('画一个售后服务泳道图，包含客户、客服、技术、仓储')}>
                    <Workflow size={14} /> 售后服务流程
                  </button>
                  <button onClick={() => setInputText('画一个前后端分离的登录认证泳道图')}>
                    <Workflow size={14} /> 登录认证交互
                  </button>
                </>
              )}
              {diagramType === 'er' && (
                <>
                  <button onClick={() => setInputText('设计一个电商系统的 ER 图，包含用户、商品、订单、订单项、收货地址')}>
                    <Database size={14} /> 电商系统 ER 图
                  </button>
                  <button onClick={() => setInputText('设计一个博客系统的 ER 图，包含用户、文章、评论、标签')}>
                    <Database size={14} /> 博客系统 ER 图
                  </button>
                  <button onClick={() => setInputText('设计一个在线教育系统的 ER 图')}>
                    <Database size={14} /> 在线教育 ER 图
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id} className={`chat-bubble chat-bubble--${msg.role}`}>
            <div className="chat-bubble__avatar">
              {msg.role === 'user' ? <User size={16} /> : <Bot size={16} />}
            </div>
            <div className="chat-bubble__content">
              {/* 推理过程（已完成的历史消息） */}
              {msg.reasoning && <ReasoningBlock text={msg.reasoning} />}
              {/* 工具调用 */}
              {msg.toolCalls && <ToolCallsBlock calls={msg.toolCalls} />}
              {/* 正文 */}
              {msg.content}
            </div>
          </div>
        ))}

        {/* 流式输出中的实时气泡 */}
        {isGenerating && <StreamingBubble />}

        <div ref={messagesEndRef} />
      </div>

      {/* 快捷短语 */}
      {nodes.length > 0 && (
        <div className="chat-panel__quick">
          {QUICK_PHRASES.map(({ label, icon: Icon }) => (
            <button
              key={label}
              className="chat-panel__quick-btn"
              onClick={() => sendMessage(label)}
              disabled={isGenerating}
            >
              <Icon size={12} /> {label}
            </button>
          ))}
        </div>
      )}

      {/* 输入区域 */}
      <div className="chat-panel__input-area">
        <textarea
          className="chat-panel__textarea"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            nodes.length === 0
              ? (diagramType === 'swimlane' ? '描述你的跨部门协作流程...'
                : diagramType === 'er' ? '描述你要设计的数据库...'
                : '描述你想要的流程图...')
              : '输入修改指令...'
          }
          disabled={isGenerating}
          rows={2}
        />
        <button
          className="chat-panel__send-btn"
          onClick={() => {
            if (isGenerating) {
              abortGeneration()
              setIsGenerating(false)
              resetStreaming()
              addMessage({
                id: `msg_${Date.now()}_stop`,
                role: 'assistant',
                content: '⬛ 已停止生成',
                timestamp: Date.now(),
              })
            } else {
              sendMessage(inputText)
            }
          }}
          disabled={!isGenerating && !inputText.trim()}
        >
          {isGenerating ? <StopCircle size={16} /> : <Send size={16} />}
        </button>
      </div>
    </div>
  )
}

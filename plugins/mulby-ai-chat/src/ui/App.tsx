import React, { useState, useRef, useEffect, useCallback } from 'react';
import './styles.css';

import { Theme, AiModel, AiSkillRecord, ChatMessage, Session, AiAttachmentRef, WebSearchProvider } from './types';
import {
  genId, getDefaultTitle,
  ai, storage,
  STORAGE_NS, STORAGE_KEY_MODEL, STORAGE_KEY_WEB_SEARCH_REQUEST,
  fileToBase64,
} from './utils';
import {
  loadSessionsFromStorage,
  persistSessionsToStorage,
  subscribeChatStorage,
} from './store/chatStorage';
import { Sidebar } from './components/Sidebar';
import { MessageBubble } from './components/MessageBubble';
import { ChatInput } from './components/ChatInput';
import { Icons } from './Icons';

// ── 主应用 ───────────────────────────────────────────────
export default function App() {
  // ── 主题 ──
  const [theme, setTheme] = useState<Theme>('light');

  useEffect(() => {
    // 1) 从 URL 参数获取初始主题并立即应用
    const params = new URLSearchParams(window.location.search);
    const urlTheme = (params.get('theme') as Theme) || 'light';
    setTheme(urlTheme);

    // 2) 尝试通过 mulby API 获取真实主题
    const mulby = (window as any).mulby;
    if (mulby?.theme?.getActual) {
      mulby.theme.getActual().then((t: Theme) => setTheme(t)).catch(() => { });
    }

    // 3) 监听主题变化
    mulby?.onThemeChange?.((t: Theme) => setTheme(t));
  }, []);

  // 应用主题到 document
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  // ── 模型（全局列表 + 最后用模型记忆）──
  const [models, setModels] = useState<AiModel[]>([]);
  const [lastModel, setLastModel] = useState<string>('');

  useEffect(() => {
    const mulby = (window as any).mulby;
    if (!mulby?.ai) return;

    // 加载模型列表
    mulby.ai.allModels().then((list: AiModel[]) => {
      const textModels = list.filter((m: any) => {
        const caps = m.capabilities || [];
        const hasImage = caps.some((c: any) => c.type === 'image-generation' || c.type === 'embedding' || c.type === 'rerank');
        return !hasImage;
      });
      setModels(textModels.length ? textModels : list);
    }).catch(() => { });

    // 恢复上次使用的模型
    mulby.storage?.get(STORAGE_KEY_MODEL, STORAGE_NS).then((saved: string) => {
      if (saved) setLastModel(saved);
    }).catch(() => { });
  }, []);

  // 模型列表加载后，检查 lastModel 是否仍在列表中，否则回退到第一个
  useEffect(() => {
    if (models.length === 0) return;
    const exists = models.some(m => m.id === lastModel);
    if (!exists) {
      setLastModel(models[0].id);
    }
  }, [models, lastModel]);

  const handleSessionModelChange = (id: string) => {
    setLastModel(id);
    storage()?.set(STORAGE_KEY_MODEL, id, STORAGE_NS).catch(() => { });
    if (!activeId) return;
    setSessions(prev => {
      const next = prev.map(s => s.id === activeId ? { ...s, model: id } : s);
      saveSessions(next);
      return next;
    });
  };

  // ── 会话 ──
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeId, setActiveId] = useState<string>('');
  // 始终镜像 activeId state 的 ref，供异步流式回调读取当前活跃会话
  const activeIdRef = useRef<string>('');
  useEffect(() => { activeIdRef.current = activeId; }, [activeId]);

  // 从 storage 加载会话
  useEffect(() => {
    loadSessionsFromStorage().then((saved: Session[]) => {
      if (saved.length > 0) {
        setSessions(saved);
        setActiveId(saved[0].id);
        return;
      }
      createNewSession(true);
    }).catch(() => {
      createNewSession(true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 跨窗口同步：当其它窗口更新 chat:* 键时，刷新本地会话缓存
  useEffect(() => {
    let disposed = false;
    const unsubscribe = subscribeChatStorage(() => {
      if (disposed || isStreamingRef.current) return;
      if (Date.now() < muteWatchUntilRef.current) return;
      loadSessionsFromStorage().then((next) => {
        if (disposed || next.length === 0) return;
        setSessions(next);
        setActiveId((prev) => (next.some((session) => session.id === prev) ? prev : next[0].id));
      }).catch(() => { });
    });
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);

  const saveSessions = useCallback((list: Session[]) => {
    muteWatchUntilRef.current = Date.now() + 800;
    persistSessionsToStorage(list).catch(() => { });
  }, []);

  const createNewSession = useCallback((_isInitial = false) => {
    const model = lastModel || models[0]?.id || '';
    const sess: Session = {
      id: genId(),
      title: '新对话',
      messages: [],
      model,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    setSessions(prev => {
      const next = [sess, ...prev];
      saveSessions(next);
      return next;
    });
    setActiveId(sess.id);
    return sess;
  }, [lastModel, models, saveSessions]);

  const deleteSession = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSessions(prev => {
      const next = prev.filter(s => s.id !== id);
      saveSessions(next);
      if (activeId === id) {
        if (next.length > 0) setActiveId(next[0].id);
        else {
          const s = createNewSession();
          setActiveId(s.id);
        }
      }
      return next;
    });
  }, [activeId, createNewSession, saveSessions]);

  const activeSession = sessions.find(s => s.id === activeId);

  // ── 输入 ──
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const abortRef = useRef<(() => void) | null>(null);
  const abortedRef = useRef(false);
  const requestIdRef = useRef<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 滚动容器引用
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  // 各会话保存的滚动状态（Key: sessionId）
  const scrollPositionMap = useRef<Map<string, { top: number; atBottom: boolean }>>(new Map());
  const rafPendingRef = useRef(false);
  const isStreamingRef = useRef(false);
  const muteWatchUntilRef = useRef(0);

  // 待上传附件
  const [pendingAttachments, setPendingAttachments] = useState<Array<{
    file: File;
    preview?: string;
    ref?: AiAttachmentRef;
  }>>([]);

  // AI Skills
  const [skills, setSkills] = useState<AiSkillRecord[]>([]);
  const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>([]);
  const [showSkills, setShowSkills] = useState(false);
  const [showWebSearch, setShowWebSearch] = useState(false);
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
  const [webSearchProviders, setWebSearchProviders] = useState<WebSearchProvider[]>([]);
  const [activeWebSearchProvider, setActiveWebSearchProvider] = useState('');
  const [webCapabilityDenied, setWebCapabilityDenied] = useState(false);
  const [webCapabilityReason, setWebCapabilityReason] = useState('');

  const refreshWebSearchSettings = useCallback(() => {
    const ws = ai()?.tooling?.webSearch;
    if (!ws) return;
    ws.getSettings?.().then((settings: any) => {
      setWebSearchProviders(settings?.providers || []);
      setActiveWebSearchProvider(settings?.activeProvider || '');
    }).catch(() => { });
  }, []);

  useEffect(() => {
    ai()?.skills?.listEnabled?.().then((list: AiSkillRecord[]) => {
      setSkills(list || []);
    }).catch(() => { });
  }, []);

  useEffect(() => { refreshWebSearchSettings(); }, [refreshWebSearchSettings]);

  useEffect(() => {
    storage()?.get(STORAGE_KEY_WEB_SEARCH_REQUEST, STORAGE_NS).then((saved: unknown) => {
      if (typeof saved === 'boolean') setWebSearchEnabled(saved);
    }).catch(() => { });
  }, []);

  // 模型弹窗
  const [showModelPicker, setShowModelPicker] = useState(false);

  // ── 滚动控制 ──
  const scrollToBottomInstant = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, []);

  const scheduleScrollIfAtBottom = useCallback((sessId: string, wasAtBottom: boolean) => {
    if (sessId !== activeIdRef.current) return;
    if (rafPendingRef.current) return;
    rafPendingRef.current = true;
    requestAnimationFrame(() => {
      rafPendingRef.current = false;
      const el = scrollContainerRef.current;
      if (!el) return;
      if (wasAtBottom) {
        el.scrollTop = el.scrollHeight;
      } else {
        const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
        if (dist < 120) el.scrollTop = el.scrollHeight;
      }
    });
  }, []);

  // 监听滚动，保存各会话的滚动状态
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el || !activeId) return;
    const onScroll = () => {
      const atBottom = (el.scrollHeight - el.scrollTop - el.clientHeight) < 120;
      scrollPositionMap.current.set(activeId, { top: el.scrollTop, atBottom });
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [activeId]);

  // 切换会话时恢复保存的滚动位置
  useEffect(() => {
    if (!activeId) return;
    requestAnimationFrame(() => {
      const el = scrollContainerRef.current;
      if (!el) return;
      const saved = scrollPositionMap.current.get(activeId);
      if (saved && !saved.atBottom) {
        el.scrollTop = saved.top;
      } else {
        el.scrollTop = el.scrollHeight;
      }
    });
  }, [activeId]);

  // ── 文本框自适应高度 ──
  const adjustTextarea = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, []);

  const handleInputChange = (value: string) => {
    setInput(value);
    adjustTextarea();
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // ── 附件上传 ──
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    for (const file of files) {
      const preview = file.type.startsWith('image/') ? await fileToBase64(file) : undefined;
      setPendingAttachments(prev => [...prev, { file, preview }]);

      try {
        const buffer = await file.arrayBuffer();
        const ref = await ai()?.attachments?.upload?.({
          buffer,
          mimeType: file.type,
          purpose: file.type.startsWith('image/') ? 'vision' : 'file',
        });
        if (ref) {
          setPendingAttachments(prev =>
            prev.map(p => p.file === file ? { ...p, ref } : p)
          );
        }
      } catch (err) {
        console.error('附件上传失败:', err);
      }
    }
    if (e.target) e.target.value = '';
  };

  const removePendingAttachment = (idx: number) => {
    setPendingAttachments(prev => prev.filter((_, i) => i !== idx));
  };

  // ── 剪贴板粘贴上传 ──
  const handlePaste = useCallback(async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.clipboardData?.files || []);
    if (files.length === 0) return;
    e.preventDefault();
    for (const file of files) {
      const preview = file.type.startsWith('image/') ? await fileToBase64(file) : undefined;
      setPendingAttachments(prev => [...prev, { file, preview }]);
      try {
        const buffer = await file.arrayBuffer();
        const ref = await ai()?.attachments?.upload?.({
          buffer,
          mimeType: file.type || 'application/octet-stream',
          purpose: file.type.startsWith('image/') ? 'vision' : 'file',
        });
        if (ref) {
          setPendingAttachments(prev =>
            prev.map(p => p.file === file ? { ...p, ref } : p)
          );
        }
      } catch (err) {
        console.error('粘贴附件上传失败:', err);
      }
    }
  }, []);

  const inspectCapabilityBlock = useCallback((chunk: any) => {
    const deniedByCapabilityDebug: string[] = Array.isArray(chunk?.capability_debug?.denied)
      ? chunk.capability_debug.denied
      : [];
    const reasons: string[] = Array.isArray(chunk?.capability_debug?.reasons)
      ? chunk.capability_debug.reasons
      : [];
    const deniedWeb = deniedByCapabilityDebug.includes('web.search') || deniedByCapabilityDebug.includes('web.fetch');

    const policyCaps = chunk?.policy_debug?.capabilities;
    const requested: string[] = Array.isArray(policyCaps?.requested) ? policyCaps.requested : [];
    const resolved: string[] = Array.isArray(policyCaps?.resolved) ? policyCaps.resolved : [];
    const requestedWeb = requested.includes('web.search') || requested.includes('web.fetch');
    const resolvedWeb = resolved.includes('web.search') || resolved.includes('web.fetch');

    if (deniedWeb || (requestedWeb && !resolvedWeb)) {
      setWebCapabilityDenied(true);
      const reason = reasons.find((r) => r.includes('web.search') || r.includes('web.fetch'))
        || '宿主策略拦截了网络能力，请在设置中心开启网络搜索与网页抓取能力。';
      setWebCapabilityReason(reason);
    }
  }, []);

  // ── 发送消息 ──
  const handleSend = useCallback(async () => {
    const text = input.trim();
    if ((!text && pendingAttachments.length === 0) || isStreaming) return;

    let session = activeSession;
    let sessId = activeId;
    if (!session) {
      const s = createNewSession();
      session = s;
      sessId = s.id;
    }
    const model = session.model || lastModel || models[0]?.id || '';
    if (!model || !ai()) return;

    // 等待所有尚在上传中的附件完成（最多候 10s）
    const hasPending = pendingAttachments.some(p => !p.ref);
    if (hasPending) {
      const deadline = Date.now() + 10_000;
      await new Promise<void>(resolve => {
        const check = () => {
          const stillPending = pendingAttachments.some(p => !p.ref);
          if (!stillPending || Date.now() > deadline) return resolve();
          setTimeout(check, 200);
        };
        check();
      });
    }

    const attachedRefs = pendingAttachments.filter(p => p.ref).map(p => p.ref!);
    const attachedPreviews = pendingAttachments
      .filter(p => p.ref)
      .map(p => p.preview || '');

    const failedCount = pendingAttachments.filter(p => !p.ref).length;
    if (failedCount > 0 && !text) return;

    const userMsg: ChatMessage = {
      id: genId(),
      role: 'user',
      content: text,
      attachments: attachedRefs,
      attachmentPreviews: attachedPreviews,
      createdAt: Date.now(),
    };

    const assistantMsg: ChatMessage = {
      id: genId(),
      role: 'assistant',
      content: '',
      isStreaming: true,
      createdAt: Date.now(),
    };

    setInput('');
    setPendingAttachments([]);
    if (textareaRef.current) { textareaRef.current.style.height = 'auto'; }

    const updateSession = (updater: (msgs: ChatMessage[]) => ChatMessage[]) => {
      setSessions(prev => {
        const next = prev.map(s =>
          s.id === sessId
            ? {
              ...s, messages: updater(s.messages), updatedAt: Date.now(),
              title: s.messages.length === 0 ? getDefaultTitle([userMsg]) : s.title
            }
            : s
        );
        saveSessions(next);
        return next;
      });
    };

    updateSession(msgs => [...msgs, userMsg, assistantMsg]);
    setIsStreaming(true);
    isStreamingRef.current = true;
    requestAnimationFrame(() => scrollToBottomInstant());

    // 构建 AI message 历史
    const history = session.messages.filter(m => !m.isStreaming);
    const aiMessages = history.map(m => {
      if (m.role === 'user' && m.attachments && m.attachments.length > 0) {
        const content: any[] = [];
        if (m.content) content.push({ type: 'text', text: m.content });
        for (const att of m.attachments) {
          if (att.mimeType.startsWith('image/')) {
            content.push({ type: 'image', attachmentId: att.attachmentId, mimeType: att.mimeType });
          } else {
            content.push({ type: 'file', attachmentId: att.attachmentId, mimeType: att.mimeType, filename: att.filename });
          }
        }
        return { role: m.role as any, content };
      }
      return { role: m.role as any, content: m.content };
    });

    // 加入当前用户消息
    if (attachedRefs.length > 0) {
      const content: any[] = [];
      if (text) content.push({ type: 'text', text });
      for (const att of attachedRefs) {
        if (att.mimeType.startsWith('image/')) {
          content.push({ type: 'image', attachmentId: att.attachmentId, mimeType: att.mimeType });
        } else {
          content.push({ type: 'file', attachmentId: att.attachmentId, mimeType: att.mimeType, filename: att.filename });
        }
      }
      aiMessages.push({ role: 'user', content });
    } else {
      aiMessages.push({ role: 'user', content: text });
    }

    const skillsOption = selectedSkillIds.length > 0
      ? { mode: 'manual' as const, skillIds: selectedSkillIds }
      : undefined;

    let accContent = '';
    let accReasoning = '';
    let accToolCalls: import('./types').ToolCallEvent[] = [];
    let streamPhase: 'init' | 'reasoning' | 'text' = 'init'; // 追踪流阶段用于工具调用分类
    abortedRef.current = false;
    requestIdRef.current = null;
    if (webSearchEnabled) {
      setWebCapabilityDenied(false);
      setWebCapabilityReason('');
    }

    try {
      const req = ai().call(
        {
          model,
          messages: aiMessages,
          ...(skillsOption ? { skills: skillsOption } : {}),
          ...(webSearchEnabled
            ? {
              capabilities: ['web.search', 'web.fetch'],
              toolingPolicy: {
                capabilityAllowList: ['web.search', 'web.fetch'],
              },
            }
            : {}),
          maxToolSteps: 200,
        },
        (chunk: any) => {
          if (chunk.__requestId) {
            requestIdRef.current = chunk.__requestId;
            return;
          }
          if (abortedRef.current) return;
          if (webSearchEnabled) inspectCapabilityBlock(chunk);
          switch (chunk.chunkType) {
            case 'reasoning': {
              streamPhase = 'reasoning';
              const reasoning = chunk.reasoning_content || '';
              if (reasoning) {
                accReasoning += reasoning;
                const el = scrollContainerRef.current;
                const wasAtBottom = el ? (el.scrollHeight - el.scrollTop - el.clientHeight) < 120 : true;
                if (sessId !== activeIdRef.current) {
                  scrollPositionMap.current.set(sessId, { top: 0, atBottom: true });
                }
                setSessions(prev => {
                  const next = prev.map(s => {
                    if (s.id !== sessId) return s;
                    const msgs = s.messages.map(m =>
                      m.id === assistantMsg.id
                        ? { ...m, reasoning_content: accReasoning, isReasoning: true, isStreaming: true }
                        : m
                    );
                    return { ...s, messages: msgs };
                  });
                  return next;
                });
                scheduleScrollIfAtBottom(sessId, wasAtBottom);
              }
              break;
            }
            case 'text': {
              streamPhase = 'text';
              const t = typeof chunk.content === 'string' ? chunk.content : '';
              if (t) {
                accContent += t;
                const el = scrollContainerRef.current;
                const wasAtBottom = el ? (el.scrollHeight - el.scrollTop - el.clientHeight) < 120 : true;
                if (sessId !== activeIdRef.current) {
                  scrollPositionMap.current.set(sessId, { top: 0, atBottom: true });
                }
                setSessions(prev => {
                  const next = prev.map(s => {
                    if (s.id !== sessId) return s;
                    const msgs = s.messages.map(m =>
                      m.id === assistantMsg.id
                        ? { ...m, content: accContent, isReasoning: false, isStreaming: true }
                        : m
                    );
                    return { ...s, messages: msgs };
                  });
                  return next;
                });
                scheduleScrollIfAtBottom(sessId, wasAtBottom);
              }
              break;
            }
            case 'tool-call': {
              const tc = chunk.tool_call;
              if (tc) {
                const isInReasoning = streamPhase === 'reasoning';
                accToolCalls = [...accToolCalls, {
                  id: tc.id, name: tc.name, args: tc.args, status: 'calling' as const,
                  inReasoning: isInReasoning,
                  ...(isInReasoning
                    ? { reasoningBefore: accReasoning }
                    : { textBefore: accContent }),
                }];
                const snapshot = [...accToolCalls];
                const el = scrollContainerRef.current;
                const wasAtBottom = el ? (el.scrollHeight - el.scrollTop - el.clientHeight) < 120 : true;
                setSessions(prev => prev.map(s =>
                  s.id !== sessId ? s : {
                    ...s, messages: s.messages.map(m =>
                      m.id === assistantMsg.id ? { ...m, toolCalls: snapshot } : m
                    )
                  }
                ));
                scheduleScrollIfAtBottom(sessId, wasAtBottom);
              }
              break;
            }
            case 'tool-result': {
              const tr = chunk.tool_result;
              if (tr) {
                accToolCalls = accToolCalls.map(tc =>
                  tc.id === tr.id ? { ...tc, result: tr.result, status: 'done' as const } : tc
                );
                const snapshot = [...accToolCalls];
                const el = scrollContainerRef.current;
                const wasAtBottom = el ? (el.scrollHeight - el.scrollTop - el.clientHeight) < 120 : true;
                setSessions(prev => prev.map(s =>
                  s.id !== sessId ? s : {
                    ...s, messages: s.messages.map(m =>
                      m.id === assistantMsg.id ? { ...m, toolCalls: snapshot } : m
                    )
                  }
                ));
                scheduleScrollIfAtBottom(sessId, wasAtBottom);
              }
              break;
            }
            case 'error': {
              // 工具报错或请求错误：把所有仍在 calling 的工具调用标记为 error
              if (accToolCalls.some(tc => tc.status === 'calling')) {
                const errResult = chunk.error?.message || '工具调用失败';
                accToolCalls = accToolCalls.map(tc =>
                  tc.status === 'calling'
                    ? { ...tc, result: errResult, status: 'error' as const }
                    : tc
                );
                setSessions(prev => prev.map(s =>
                  s.id !== sessId ? s : {
                    ...s, messages: s.messages.map(m =>
                      m.id === assistantMsg.id ? { ...m, toolCalls: [...accToolCalls] } : m
                    )
                  }
                ));
              }
              break;
            }
            case 'end': {
              // end chunk 携带完整 usage，提前写入（比 finalMsg 更可靠）
              // 同时：若有工具调用仍在 calling（Mulby 没有发 tool-result），标记为 error
              const pendingTools = accToolCalls.filter(tc => tc.status === 'calling');
              if (pendingTools.length > 0) {
                accToolCalls = accToolCalls.map(tc =>
                  tc.status === 'calling'
                    ? { ...tc, result: '工具执行失败（宿主未返回结果）', status: 'error' as const }
                    : tc
                );
              }
              setSessions(prev => prev.map(s =>
                s.id !== sessId ? s : {
                  ...s, messages: s.messages.map(m =>
                    m.id === assistantMsg.id
                      ? {
                        ...m,
                        ...(chunk.usage ? { usage: chunk.usage } : {}),
                        ...(pendingTools.length > 0 ? { toolCalls: [...accToolCalls] } : {}),
                      }
                      : m
                  )
                }
              ));
              break;
            }

          }
        }
      );

      abortRef.current = req.abort;
      const finalMsg = await req;

      if (abortedRef.current) return;

      const finalContent = finalMsg.content
        ? (typeof finalMsg.content === 'string' ? finalMsg.content : accContent)
        : accContent;
      const finalReasoning = typeof finalMsg.reasoning_content === 'string'
        ? finalMsg.reasoning_content
        : accReasoning;
      // finalMsg.usage 使用 Mulby AiTokenBreakdown 格式：inputTokens / outputTokens
      const finalUsage = finalMsg.usage as { inputTokens?: number; outputTokens?: number } | undefined;

      setSessions(prev => {
        const next = prev.map(s => {
          if (s.id !== sessId) return s;
          const msgs = s.messages.map(m =>
            m.id === assistantMsg.id
              ? {
                ...m,
                content: finalContent,
                reasoning_content: finalReasoning || undefined,
                isStreaming: false,
                isReasoning: false,
                usage: finalUsage ?? m.usage, // 优先 finalMsg，fallback 到 end chunk 已写入的
              }
              : m
          );
          return { ...s, messages: msgs };
        });
        saveSessions(next);
        return next;
      });
    } catch (err: any) {
      const isAbort = abortedRef.current
        || err?.name === 'AbortError'
        || String(err?.message).toLowerCase().includes('aborted');
      if (isAbort) {
        setSessions(prev => {
          const next = prev.map(s =>
            s.id !== sessId ? s :
              {
                ...s, messages: s.messages.map(m =>
                  m.id !== assistantMsg.id ? m :
                    {
                      ...m,
                      content: accContent,
                      reasoning_content: accReasoning || undefined,
                      isStreaming: false,
                      isReasoning: false,
                      // Fix 3: 把所有仍在 calling 的工具调用标记为 cancelled
                      toolCalls: m.toolCalls?.map(tc => tc.status === 'calling' ? { ...tc, status: 'cancelled' as const } : tc),
                    }
                )
              }
          );
          saveSessions(next);
          return next;
        });
        return;
      }
      const errMsg = err?.message || '请求失败，请重试';
      setSessions(prev => {
        const next = prev.map(s => {
          if (s.id !== sessId) return s;
          const msgs = s.messages.map(m => {
            if (m.id !== assistantMsg.id) return m;
            return {
              ...m,
              content: accContent,
              reasoning_content: accReasoning || undefined,
              error: errMsg,
              isStreaming: false,
              isReasoning: false,
              // Fix 3: 把所有仍在 calling 的工具调用标记为 error
              toolCalls: m.toolCalls?.map(tc => tc.status === 'calling' ? { ...tc, status: 'error' as const } : tc),
            };
          });
          return { ...s, messages: msgs };
        });
        saveSessions(next);
        return next;
      });
    } finally {
      setIsStreaming(false);
      isStreamingRef.current = false;
      abortRef.current = null;
    }
  }, [
    input, pendingAttachments, isStreaming, lastModel, models,
    activeSession, activeId, createNewSession, saveSessions, selectedSkillIds, webSearchEnabled, inspectCapabilityBlock,
  ]);

  const handleStop = () => {
    abortedRef.current = true;
    if (requestIdRef.current) {
      ai()?.abort?.(requestIdRef.current);
    } else {
      abortRef.current?.();
    }
    setIsStreaming(false);
    setSessions(prev => {
      const next = prev.map(s => ({
        ...s,
        messages: s.messages.map(m => m.isStreaming ? { ...m, isStreaming: false } : m),
      }));
      saveSessions(next);
      return next;
    });
  };

  const handleSkillToggle = (id: string, checked: boolean) => {
    setSelectedSkillIds(prev =>
      checked ? [...prev, id] : prev.filter(sid => sid !== id)
    );
  };

  const handleSetWebSearchProvider = useCallback((providerId: string) => {
    const ws = ai()?.tooling?.webSearch;
    if (!ws) return;

    // 先更新 UI，避免宿主响应慢导致“点击没反应”
    setActiveWebSearchProvider(providerId);
    ws.setActiveProvider?.(providerId).then((res: { success: boolean; activeProvider: string }) => {
      if (!res?.success) {
        (window as any).mulby?.notification?.show?.('切换搜索源失败，请检查宿主配置', 'warning');
        return;
      }
      setActiveWebSearchProvider(res.activeProvider || providerId);
      refreshWebSearchSettings();
    }).catch(() => {
      (window as any).mulby?.notification?.show?.('切换搜索源失败，请检查宿主配置', 'warning');
    });
  }, [refreshWebSearchSettings]);

  const handleToggleWebSearchEnabled = useCallback((enabled: boolean) => {
    setWebSearchEnabled(enabled);
    if (!enabled) {
      setWebCapabilityDenied(false);
      setWebCapabilityReason('');
    }
    storage()?.set(STORAGE_KEY_WEB_SEARCH_REQUEST, enabled, STORAGE_NS).catch(() => { });
  }, []);

  // ── 消息操作 ──────────────────────────────────────────────

  // 复制消息内容到剪贴板（先检查 API 可用性，防止沙箱 webview 中抛出同步错误）
  const handleCopyMessage = useCallback((msgId: string) => {
    const sess = sessions.find(s => s.id === activeId);
    const msg = sess?.messages.find(m => m.id === msgId);
    if (!msg) return;
    const text = msg.content || '';
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
    } else {
      fallbackCopy(text);
    }
  }, [sessions, activeId]);

  function fallbackCopy(text: string) {
    const el = document.createElement('textarea');
    el.value = text;
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
  }

  // 删除单条消息（用户消息同时删除紧随的 AI 消息；流式进行中先中止再删除）
  const handleDeleteMessage = useCallback((msgId: string) => {
    // 如果正在流式输出，先中止，避免孤儿请求持续消耗 token
    if (isStreaming) {
      abortedRef.current = true;
      if (requestIdRef.current) {
        ai()?.abort?.(requestIdRef.current);
      } else {
        abortRef.current?.();
      }
      setIsStreaming(false);
      isStreamingRef.current = false;
    }
    setSessions(prev => {
      const next = prev.map(s => {
        if (s.id !== activeId) return s;
        const idx = s.messages.findIndex(m => m.id === msgId);
        if (idx === -1) return s;
        const toRemove = new Set<number>([idx]);
        const msg = s.messages[idx];
        if (msg.role === 'user' && s.messages[idx + 1]?.role === 'assistant') {
          toRemove.add(idx + 1);
        }
        // 删除 AI 消息时仅删自身，不连带用户消息
        const messages = s.messages.filter((_, i) => !toRemove.has(i));
        return { ...s, messages, updatedAt: Date.now() };
      });
      saveSessions(next);
      return next;
    });
  }, [activeId, isStreaming, saveSessions]);

  // 核心：对指定 sessId 的消息列表 + 指定 model 发起流式请求，并将结果写入 targetMsgId
  const sendStream = useCallback(async (
    sessId: string,
    historyMsgs: ChatMessage[],
    model: string,
    targetMsgId: string,
  ) => {
    const aiMessages = historyMsgs.map(m => {
      if (m.role === 'user' && m.attachments && m.attachments.length > 0) {
        const content: any[] = [];
        if (m.content) content.push({ type: 'text', text: m.content });
        for (const att of m.attachments) {
          if (att.mimeType.startsWith('image/')) {
            content.push({ type: 'image', attachmentId: att.attachmentId, mimeType: att.mimeType });
          } else {
            content.push({ type: 'file', attachmentId: att.attachmentId, mimeType: att.mimeType, filename: att.filename });
          }
        }
        return { role: m.role as any, content };
      }
      return { role: m.role as any, content: m.content };
    });

    const skillsOption = selectedSkillIds.length > 0
      ? { mode: 'manual' as const, skillIds: selectedSkillIds }
      : undefined;

    let accContent = '';
    let accReasoning = '';
    let accToolCalls: import('./types').ToolCallEvent[] = [];
    let streamPhase: 'init' | 'reasoning' | 'text' = 'init'; // 追踪流阶段
    abortedRef.current = false;
    requestIdRef.current = null;
    if (webSearchEnabled) {
      setWebCapabilityDenied(false);
      setWebCapabilityReason('');
    }

    setIsStreaming(true);
    isStreamingRef.current = true;
    requestAnimationFrame(() => scrollToBottomInstant());

    try {
      const req = ai().call(
        {
          model,
          messages: aiMessages,
          ...(skillsOption ? { skills: skillsOption } : {}),
          ...(webSearchEnabled
            ? {
              capabilities: ['web.search', 'web.fetch'],
              toolingPolicy: {
                capabilityAllowList: ['web.search', 'web.fetch'],
              },
            }
            : {}),
          maxToolSteps: 200,
        },
        (chunk: any) => {
          if (chunk.__requestId) { requestIdRef.current = chunk.__requestId; return; }
          if (abortedRef.current) return;
          if (webSearchEnabled) inspectCapabilityBlock(chunk);

          switch (chunk.chunkType) {
            case 'reasoning': {
              streamPhase = 'reasoning';
              const reasoning = chunk.reasoning_content || '';
              if (reasoning) {
                accReasoning += reasoning;
                const el = scrollContainerRef.current;
                const wasAtBottom = el ? (el.scrollHeight - el.scrollTop - el.clientHeight) < 120 : true;
                if (sessId !== activeIdRef.current) scrollPositionMap.current.set(sessId, { top: 0, atBottom: true });
                setSessions(prev => {
                  const next = prev.map(s => {
                    if (s.id !== sessId) return s;
                    const msgs = s.messages.map(m =>
                      m.id === targetMsgId ? { ...m, reasoning_content: accReasoning, isReasoning: true, isStreaming: true } : m
                    );
                    return { ...s, messages: msgs };
                  });
                  return next;
                });
                scheduleScrollIfAtBottom(sessId, wasAtBottom);
              }
              break;
            }
            case 'text': {
              streamPhase = 'text';
              const t = typeof chunk.content === 'string' ? chunk.content : '';
              if (t) {
                accContent += t;
                const el = scrollContainerRef.current;
                const wasAtBottom = el ? (el.scrollHeight - el.scrollTop - el.clientHeight) < 120 : true;
                if (sessId !== activeIdRef.current) scrollPositionMap.current.set(sessId, { top: 0, atBottom: true });
                setSessions(prev => {
                  const next = prev.map(s => {
                    if (s.id !== sessId) return s;
                    const msgs = s.messages.map(m =>
                      m.id === targetMsgId ? { ...m, content: accContent, isReasoning: false, isStreaming: true } : m
                    );
                    return { ...s, messages: msgs };
                  });
                  return next;
                });
                scheduleScrollIfAtBottom(sessId, wasAtBottom);
              }
              break;
            }
            case 'tool-call': {
              const tc = chunk.tool_call;
              if (tc) {
                const isInReasoning = streamPhase === 'reasoning';
                accToolCalls = [...accToolCalls, {
                  id: tc.id, name: tc.name, args: tc.args, status: 'calling' as const,
                  inReasoning: isInReasoning,
                  ...(isInReasoning
                    ? { reasoningBefore: accReasoning }
                    : { textBefore: accContent }),
                }];
                const snapshot = [...accToolCalls];
                const el = scrollContainerRef.current;
                const wasAtBottom = el ? (el.scrollHeight - el.scrollTop - el.clientHeight) < 120 : true;
                setSessions(prev => prev.map(s =>
                  s.id !== sessId ? s : {
                    ...s, messages: s.messages.map(m =>
                      m.id === targetMsgId ? { ...m, toolCalls: snapshot } : m
                    )
                  }
                ));
                scheduleScrollIfAtBottom(sessId, wasAtBottom);
              }
              break;
            }
            case 'tool-result': {
              const tr = chunk.tool_result;
              if (tr) {
                accToolCalls = accToolCalls.map(tc =>
                  tc.id === tr.id ? { ...tc, result: tr.result, status: 'done' as const } : tc
                );
                const snapshot = [...accToolCalls];
                const el = scrollContainerRef.current;
                const wasAtBottom = el ? (el.scrollHeight - el.scrollTop - el.clientHeight) < 120 : true;
                setSessions(prev => prev.map(s =>
                  s.id !== sessId ? s : {
                    ...s, messages: s.messages.map(m =>
                      m.id === targetMsgId ? { ...m, toolCalls: snapshot } : m
                    )
                  }
                ));
                scheduleScrollIfAtBottom(sessId, wasAtBottom);
              }
              break;
            }
            case 'error': {
              // 工具报错或请求错误：把所有仍在 calling 的工具调用标记为 error
              if (accToolCalls.some(tc => tc.status === 'calling')) {
                const errResult = chunk.error?.message || '工具调用失败';
                accToolCalls = accToolCalls.map(tc =>
                  tc.status === 'calling'
                    ? { ...tc, result: errResult, status: 'error' as const }
                    : tc
                );
                setSessions(prev => prev.map(s =>
                  s.id !== sessId ? s : {
                    ...s, messages: s.messages.map(m =>
                      m.id === targetMsgId ? { ...m, toolCalls: [...accToolCalls] } : m
                    )
                  }
                ));
              }
              break;
            }
            case 'end': {
              // end chunk 携带完整 usage，提前写入
              // 同时：若有工具调用仍在 calling（Mulby 没有发 tool-result），标记为 error
              const pendingTools = accToolCalls.filter(tc => tc.status === 'calling');
              if (pendingTools.length > 0) {
                accToolCalls = accToolCalls.map(tc =>
                  tc.status === 'calling'
                    ? { ...tc, result: '工具执行失败（宿主未返回结果）', status: 'error' as const }
                    : tc
                );
              }
              setSessions(prev => prev.map(s =>
                s.id !== sessId ? s : {
                  ...s, messages: s.messages.map(m =>
                    m.id === targetMsgId
                      ? {
                        ...m,
                        ...(chunk.usage ? { usage: chunk.usage } : {}),
                        ...(pendingTools.length > 0 ? { toolCalls: [...accToolCalls] } : {}),
                      }
                      : m
                  )
                }
              ));
              break;
            }
          }
        }
      );

      abortRef.current = req.abort;
      const finalMsg = await req;
      if (abortedRef.current) return;

      const finalContent = finalMsg.content
        ? (typeof finalMsg.content === 'string' ? finalMsg.content : accContent)
        : accContent;
      const finalReasoning = typeof finalMsg.reasoning_content === 'string'
        ? finalMsg.reasoning_content : accReasoning;
      const finalUsage = finalMsg.usage as { inputTokens?: number; outputTokens?: number } | undefined;

      setSessions(prev => {
        const next = prev.map(s => {
          if (s.id !== sessId) return s;
          const msgs = s.messages.map(m =>
            m.id === targetMsgId
              ? {
                ...m,
                content: finalContent,
                reasoning_content: finalReasoning || undefined,
                isStreaming: false,
                isReasoning: false,
                error: undefined,
                usage: finalUsage ?? m.usage, // 优先 finalMsg，fallback 到 end chunk 已写入的
              }
              : m
          );
          return { ...s, messages: msgs };
        });
        saveSessions(next);
        return next;
      });
    } catch (err: any) {
      const isAbort = abortedRef.current || err?.name === 'AbortError' || String(err?.message).toLowerCase().includes('aborted');
      if (isAbort) {
        setSessions(prev => {
          const next = prev.map(s =>
            s.id !== sessId ? s :
              {
                ...s, messages: s.messages.map(m =>
                  m.id !== targetMsgId ? m :
                    {
                      ...m,
                      content: accContent,
                      reasoning_content: accReasoning || undefined,
                      isStreaming: false,
                      isReasoning: false,
                      toolCalls: m.toolCalls?.map(tc => tc.status === 'calling' ? { ...tc, status: 'cancelled' as const } : tc),
                    }
                )
              }
          );
          saveSessions(next);
          return next;
        });
        return;
      }
      const errMsg = err?.message || '请求失败，请重试';
      setSessions(prev => {
        const next = prev.map(s => {
          if (s.id !== sessId) return s;
          const msgs = s.messages.map(m => {
            if (m.id !== targetMsgId) return m;
            return {
              ...m,
              content: accContent,
              reasoning_content: accReasoning || undefined,
              error: errMsg,
              isStreaming: false,
              isReasoning: false,
              toolCalls: m.toolCalls?.map(tc => tc.status === 'calling' ? { ...tc, status: 'error' as const } : tc),
            };
          });
          return { ...s, messages: msgs };
        });
        saveSessions(next);
        return next;
      });
    } finally {
      setIsStreaming(false);
      isStreamingRef.current = false;
      abortRef.current = null;
    }
  }, [selectedSkillIds, saveSessions, scrollToBottomInstant, scheduleScrollIfAtBottom, webSearchEnabled, inspectCapabilityBlock]);

  // 重新生成：清空指定 AI 消息，用截断到该消息之前的历史重新发请求
  const handleRegenerate = useCallback(async (msgId: string, overrideModel?: string) => {
    if (isStreaming) return;
    const sess = sessions.find(s => s.id === activeId);
    if (!sess) return;
    const idx = sess.messages.findIndex(m => m.id === msgId);
    if (idx === -1) return;
    const msg = sess.messages[idx];
    const model = overrideModel || sess.model || lastModel || models[0]?.id || '';
    if (!model || !ai()) return;

    let targetMsg: ChatMessage;
    let historyEndIdx: number;

    if (msg.role === 'user') {
      const nextMsg = sess.messages[idx + 1];
      if (nextMsg && nextMsg.role === 'assistant') {
        // 已有 AI 回复：复用，重置内容
        targetMsg = nextMsg;
        historyEndIdx = idx + 1;
      } else {
        // 孤立用户消息（AI 回复已被删除）：新建 AI 占位
        targetMsg = { id: genId(), role: 'assistant', content: '', isStreaming: true, createdAt: Date.now() };
        historyEndIdx = idx + 1; // history = [0..idx]
        setSessions(prev => {
          const next = prev.map(s => {
            if (s.id !== activeId) return s;
            const msgs = [
              ...s.messages.slice(0, idx + 1),
              targetMsg,
              ...s.messages.slice(idx + 1),
            ];
            return { ...s, messages: msgs, model: overrideModel || s.model };
          });
          saveSessions(next);
          return next;
        });
        const history = sess.messages.slice(0, idx + 1).filter(m => !m.isStreaming);
        await sendStream(activeId, history, model, targetMsg.id);
        return;
      }
    } else {
      targetMsg = msg;
      historyEndIdx = idx;
    }

    const history = sess.messages.slice(0, historyEndIdx).filter(m => !m.isStreaming);

    // 重置 target 消息为空流式状态
    setSessions(prev => {
      const next = prev.map(s => {
        if (s.id !== activeId) return s;
        const msgs = s.messages.map(m =>
          m.id === targetMsg.id
            ? { ...m, content: '', reasoning_content: undefined, isStreaming: true, isReasoning: false, error: undefined, translation: undefined, toolCalls: undefined }
            : m
        );
        return { ...s, messages: msgs, model: overrideModel || s.model };
      });
      return next;
    });

    await sendStream(activeId, history, model, targetMsg.id);
  }, [isStreaming, sessions, activeId, lastModel, models, sendStream, saveSessions]);

  // 编辑用户消息并重发：替换内容 -> 截断之后所有消息 -> 追加新 AI 消息 -> 立即持久化 -> 发流
  const handleEditMessage = useCallback(async (msgId: string, newContent: string) => {
    if (isStreaming) return;
    const sess = sessions.find(s => s.id === activeId);
    if (!sess) return;
    const idx = sess.messages.findIndex(m => m.id === msgId);
    if (idx === -1) return;
    const model = sess.model || lastModel || models[0]?.id || '';
    if (!model || !ai()) return;

    const newAssistantMsg: ChatMessage = {
      id: genId(),
      role: 'assistant',
      content: '',
      isStreaming: true,
      createdAt: Date.now(),
    };

    const history = [
      ...sess.messages.slice(0, idx).filter(m => !m.isStreaming),
      { ...sess.messages[idx], content: newContent },
    ];

    // P3: 乐观更新后立即持久化，防止 webview 崩溃/重载后数据丢失
    setSessions(prev => {
      const next = prev.map(s => {
        if (s.id !== activeId) return s;
        const msgs = [
          ...s.messages.slice(0, idx),
          { ...s.messages[idx], content: newContent },
          newAssistantMsg,
        ];
        return { ...s, messages: msgs, updatedAt: Date.now() };
      });
      saveSessions(next); // 立即持久化
      return next;
    });

    await sendStream(activeId, history, model, newAssistantMsg.id);
  }, [isStreaming, sessions, activeId, lastModel, models, sendStream, saveSessions]);

  // 翻译：调用 AI 对该消息内容做一次翻译，结果写入 translation 字段
  const handleTranslate = useCallback(async (msgId: string) => {
    if (isStreaming) return;
    const sess = sessions.find(s => s.id === activeId);
    if (!sess) return;
    const msg = sess.messages.find(m => m.id === msgId);
    if (!msg || !msg.content) return;
    const model = sess.model || lastModel || models[0]?.id || '';
    if (!model || !ai()) return;

    // 检测中文比例来决定翻译方向
    const chineseRatio = (msg.content.match(/[\u4e00-\u9fff]/g) || []).length / Math.max(msg.content.length, 1);
    const targetLang = chineseRatio > 0.1 ? '英文' : '中文';

    // 标记翻译中
    setSessions(prev => prev.map(s =>
      s.id !== activeId ? s :
        { ...s, messages: s.messages.map(m => m.id === msgId ? { ...m, translating: true, translation: undefined } : m) }
    ));

    try {
      const req = ai().call(
        {
          model,
          messages: [
            { role: 'user', content: `请将以下内容翻译为${targetLang}，只输出翻译结果，不要解释：\n\n${msg.content}` },
          ],
        },
        () => { }
      );
      const result = await req;
      const translationText = typeof result.content === 'string' ? result.content : msg.content;
      setSessions(prev => {
        const next = prev.map(s =>
          s.id !== activeId ? s :
            { ...s, messages: s.messages.map(m => m.id === msgId ? { ...m, translating: false, translation: translationText } : m) }
        );
        saveSessions(next);
        return next;
      });
    } catch {
      setSessions(prev => prev.map(s =>
        s.id !== activeId ? s :
          { ...s, messages: s.messages.map(m => m.id === msgId ? { ...m, translating: false } : m) }
      ));
    }
  }, [isStreaming, sessions, activeId, lastModel, models, saveSessions]);

  // ── 渲染 ──────────────────────────────────────────────
  const msgs = activeSession?.messages || [];
  const currentModel = activeSession?.model || lastModel;
  const canSend = (input.trim().length > 0 || pendingAttachments.length > 0) && !isStreaming && !!currentModel;

  return (
    <div className="app-root">
      <div className="main-layout">
        {/* 侧边栏：会话列表 */}
        <Sidebar
          sessions={sessions}
          activeId={activeId}
          onSelectSession={setActiveId}
          onNewSession={() => createNewSession()}
          onDeleteSession={deleteSession}
        />

        {/* 对话区 */}
        <div className="chat-area">
          {webSearchEnabled && webCapabilityDenied && (
            <div
              style={{
                margin: '8px 12px 0',
                padding: '8px 10px',
                borderRadius: 10,
                border: '1px solid rgba(245, 158, 11, 0.45)',
                background: 'rgba(245, 158, 11, 0.08)',
                color: 'var(--text-secondary)',
                fontSize: 12,
                lineHeight: 1.5,
              }}
            >
              联网能力已被宿主策略拦截：{webCapabilityReason}
            </div>
          )}
          {/* 消息列表 */}
          <div className="messages-container" ref={scrollContainerRef}>
            {msgs.length === 0 ? (
              <div className="empty-state">
                <div className="hero-icon"><Icons.ai /></div>
                <h2>AI 助手</h2>
                <p>选择模型，开始多轮对话。支持图片、文件上传和 AI Skills。</p>
              </div>
            ) : (
              msgs.map(msg => (
                <MessageBubble
                  key={msg.id}
                  msg={msg}
                  theme={theme}
                  models={models}
                  currentModel={currentModel}
                  isGlobalStreaming={isStreaming}
                  onCopy={handleCopyMessage}
                  onDelete={handleDeleteMessage}
                  onEdit={handleEditMessage}
                  onRegenerate={handleRegenerate}
                  onRegenerateWithModel={(msgId, modelId) => handleRegenerate(msgId, modelId)}
                  onTranslate={handleTranslate}
                />
              ))
            )}
          </div>

          {/* 输入区 */}
          <ChatInput
            input={input}
            isStreaming={isStreaming}
            canSend={canSend}
            pendingAttachments={pendingAttachments}
            skills={skills}
            selectedSkillIds={selectedSkillIds}
            showSkills={showSkills}
            showWebSearch={showWebSearch}
            webSearchEnabled={webSearchEnabled}
            webSearchProviders={webSearchProviders}
            activeWebSearchProvider={activeWebSearchProvider}
            models={models}
            currentModel={currentModel}
            showModelPicker={showModelPicker}
            onInputChange={handleInputChange}
            onKeyDown={handleInputKeyDown}
            onPaste={handlePaste}
            onSend={handleSend}
            onStop={handleStop}
            onFileSelect={handleFileSelect}
            onRemoveAttachment={removePendingAttachment}
            onToggleSkills={() => {
              setShowSkills(s => !s);
              setShowWebSearch(false);
            }}
            onSkillToggle={handleSkillToggle}
            onToggleWebSearch={() => {
              refreshWebSearchSettings();
              setShowWebSearch(s => !s);
              setShowSkills(false);
            }}
            onToggleWebSearchEnabled={handleToggleWebSearchEnabled}
            onSetWebSearchProvider={handleSetWebSearchProvider}
            onClosePopovers={() => {
              setShowSkills(false);
              setShowWebSearch(false);
            }}
            onModelChange={handleSessionModelChange}
            onModelPickerToggle={() => setShowModelPicker(v => !v)}
            onModelPickerClose={() => setShowModelPicker(false)}
            textareaRef={textareaRef}
          />
        </div>
      </div>

    </div>
  );
}

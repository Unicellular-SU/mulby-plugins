// ================= 会话持久化 hook（方案 7.4 收尾，从 App.tsx 机械搬移） =================
// 偏差记录：方案 7.4 原文只列状态机/队列/计价器/promptBuilder 四条轴（起草时 App 为 743 行）；
// 第 3/5 章落地后 App 增重 ~550 行，其中持久化接线（启动读回 / config 写回 / 快照防抖 /
// 三通道兜底 flush / 恢复与放弃）自成一轴，按同一"只挪不改"纪律一并收敛于此。
// 存储 schema 与读写工具仍在 services/persistenceService.ts（7.1 包边界：persistence 留插件）。

import { useState, useRef, useEffect, useCallback } from 'react';
import {
  SCHEMA_VERSION,
  PersistedSession,
  stripSheetImages,
  attIdForPage,
  attIdForChar,
  attIdForProp,
  putImageAttachment,
  getImageAttachment,
  clearSessionAttachments,
  saveSessionDebounced,
  flushSession,
  discardPersistedSession,
  isRestorableSession,
  loadConfigFromStorage,
  loadSessionFromStorage,
  saveConfigToStorage,
} from '../services/persistenceService';
import { sanitizePersistedUsage } from './useUsageTracker';
import {
  AppConfig,
  CharacterSheetItem,
  ComicPageData,
  ComicResponse,
  PropSheetItem,
  TokenUsage,
  WorkflowStep,
} from '../types';

type StateSetter<T> = (value: T | ((prev: T) => T)) => void;

interface UseSessionPersistenceDeps {
  mulbyReady: boolean;
  config: AppConfig;
  setConfig: StateSetter<AppConfig>;
  workflowStep: WorkflowStep;
  setWorkflowStep: StateSetter<WorkflowStep>;
  storyboardTab: 'SCRIPT' | 'CHARACTERS';
  setStoryboardTab: StateSetter<'SCRIPT' | 'CHARACTERS'>;
  comicScript: ComicResponse | null;
  setComicScript: StateSetter<ComicResponse | null>;
  characterSheet: CharacterSheetItem[];
  setCharacterSheet: StateSetter<CharacterSheetItem[]>;
  propSheet: PropSheetItem[];
  setPropSheet: StateSetter<PropSheetItem[]>;
  pages: ComicPageData[];
  setPages: StateSetter<ComicPageData[]>;
  tokenUsage: TokenUsage;
  setTokenUsage: StateSetter<TokenUsage>;
  setGlobalError: StateSetter<string | null>;
}

export const useSessionPersistence = ({
  mulbyReady,
  config,
  setConfig,
  workflowStep,
  setWorkflowStep,
  storyboardTab,
  setStoryboardTab,
  comicScript,
  setComicScript,
  characterSheet,
  setCharacterSheet,
  propSheet,
  setPropSheet,
  pages,
  setPages,
  tokenUsage,
  setTokenUsage,
  setGlobalError,
}: UseSessionPersistenceDeps) => {
  // 会话持久化（方案 3.1）：启动探测到的可恢复会话与恢复进行中标记
  const [pendingSession, setPendingSession] = useState<PersistedSession | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);
  // config 读回完成前不允许写回，避免 INITIAL_CONFIG 默认值抢写（方案 3.2）
  const configHydratedRef = useRef(false);
  // 快照 effect 用于识别 workflowStep 迁移（迁移点 delay=0 立即写盘）
  const lastSnapshotStepRef = useRef<WorkflowStep | null>(null);
  // 已落盘的参考图（attachmentId → dataUrl），避免描述逐键编辑时重复 put 附件
  const persistedRefImagesRef = useRef<Map<string, string>>(new Map());

  // 启动恢复（方案 3.1 步骤 5 + 3.2 步骤 1）：并行读回 config 与 session；
  // session 可恢复则显示「恢复上次创作」条幅（不自动跳转）；不可恢复/缺失则做清理。
  useEffect(() => {
    if (!mulbyReady) return;
    let cancelled = false;
    void (async () => {
      try {
        const [savedConfig, savedSession] = await Promise.all([
          loadConfigFromStorage(),
          loadSessionFromStorage(),
        ]);
        if (cancelled) return;

        // config 读回：sourceText 属会话内容，明确不随 config 恢复
        const cfg = savedConfig as ({ v?: number; savedAt?: number } & Partial<AppConfig>) | null;
        if (cfg && cfg.v === SCHEMA_VERSION) {
          const { v, savedAt, ...rest } = cfg;
          setConfig(prev => ({ ...prev, ...rest, sourceText: prev.sourceText }));
        }

        if (isRestorableSession(savedSession)) {
          setPendingSession(savedSession);
        } else if (savedSession != null) {
          // 版本不匹配 / 结构不完整：视为不可恢复，静默丢弃（宁可丢弃不可崩溃）
          void discardPersistedSession();
        } else {
          // 孤儿清理：session 不存在但 page-/char-/prop- 附件残留（上次放弃中途崩溃等）
          void clearSessionAttachments();
        }
      } catch (e) {
        console.warn('[persist] startup hydrate failed:', e);
      } finally {
        configHydratedRef.current = true;
      }
    })();
    return () => { cancelled = true; };
  }, [mulbyReady]);

  // config 变化写回（方案 3.2）：排除 sourceText，debounce 500ms；读回完成前不写
  useEffect(() => {
    if (!mulbyReady || !configHydratedRef.current) return;
    const { sourceText, ...persistable } = config;
    const t = setTimeout(() => {
      void saveConfigToStorage({ v: SCHEMA_VERSION, savedAt: Date.now(), ...persistable });
    }, 500);
    return () => clearTimeout(t);
  }, [mulbyReady, config]);

  // 会话快照（方案 3.1 步骤 2）：任一会话状态变化即防抖落盘（base64 全部剥离）。
  // CONFIG 未开始创作不写；SCRIPT_GENERATION 是过渡态（comicScript 仍是上一轮、pages 已清空），
  // 写入会用残缺快照覆盖最后一份完整会话，同样跳过（偏差记录见方案 1.5）。
  useEffect(() => {
    if (!mulbyReady) return;
    if (workflowStep === WorkflowStep.CONFIG || workflowStep === WorkflowStep.SCRIPT_GENERATION) {
      lastSnapshotStepRef.current = workflowStep;
      return;
    }
    const stepChanged = lastSnapshotStepRef.current !== workflowStep;
    lastSnapshotStepRef.current = workflowStep;
    saveSessionDebounced({
      v: SCHEMA_VERSION,
      savedAt: Date.now(),
      workflowStep,
      storyboardTab,
      sourceText: config.sourceText,
      comicScript: stripSheetImages(comicScript), // 剥离 sheet 内 referenceImage
      characterSheet: characterSheet.map(({ referenceImage, ...rest }) =>
        ({ ...rest, hasReference: !!referenceImage })),
      propSheet: propSheet.map(({ referenceImage, ...rest }) =>
        ({ ...rest, hasReference: !!referenceImage })),
      pages: pages.map(({ imageData, isGenerating, progress, ...rest }) =>
        ({ ...rest, hasImage: !!imageData })),
      tokenUsage: { ...tokenUsage, history: tokenUsage.history.slice(-200) },
    }, stepChanged ? 0 : undefined); // 工作流迁移属关键节点：立即写盘
  }, [mulbyReady, workflowStep, storyboardTab, comicScript,
      characterSheet, propSheet, pages, tokenUsage, config.sourceText]);

  // 兜底保存（方案 3.1 步骤 4）：onPluginOut 覆盖 Esc/outPlugin 路径；
  // pagehide 覆盖独立窗口 X 关闭（该路径宿主不发 plugin:out）；beforeunload 覆盖 Reload。
  useEffect(() => {
    // 返回值按宿主实际行为是取消订阅函数；项目未装 @types/react 且 @types/node 的全局
    // Disposable 覆盖了 mulby.d.ts 的同名别名，这里显式断言为函数类型
    const unsub = (window as Window).mulby?.onPluginOut?.(() => { void flushSession(); }) as unknown as (() => void) | undefined;
    const onTeardown = () => { void flushSession(); }; // fire-and-forget IPC，尽力而为
    window.addEventListener('pagehide', onTeardown);
    window.addEventListener('beforeunload', onTeardown);
    return () => {
      unsub?.();
      window.removeEventListener('pagehide', onTeardown);
      window.removeEventListener('beforeunload', onTeardown);
    };
  }, []);

  // 设定图增量落盘（方案 3.1 步骤 3）：仅在拿到新图时写附件；
  // 描述逐键编辑也会带着旧 referenceImage 走同一回调，用 ref 去重避免重复 put。
  const persistReferenceImage = useCallback((attachmentId: string, image?: string) => {
     if (!image) return;
     if (persistedRefImagesRef.current.get(attachmentId) === image) return;
     persistedRefImagesRef.current.set(attachmentId, image);
     void putImageAttachment(attachmentId, image);
  }, []);

  /** 新剧本生成成功 = 唯一确立"新会话"的时刻（方案 3.1 步骤 6）：清旧会话标记、
   *  参考图去重表与旧会话附件；session 键由快照 effect 在迁移到 STORYBOARDING 时立即覆盖写入。 */
  const beginNewSession = useCallback(() => {
    setPendingSession(null);
    persistedRefImagesRef.current.clear();
    void clearSessionAttachments();
  }, []);

  /** 确认丢弃当前创作：清持久化会话（session 键 + 附件；config 保留）与参考图去重表——
   *  第 2 章把 Start Over 改成了「确认 + 真正重置」，保留持久化会跟"不可恢复"的确认语义冲突 */
  const discardSessionData = useCallback(() => {
    setPendingSession(null);
    persistedRefImagesRef.current.clear();
    void discardPersistedSession();
  }, []);

  // 恢复上次创作（方案 3.1 步骤 5.3/5.4）：按 hasReference/hasImage 标记读回附件并转 dataURL，
  // 同时把设定图重新注入 comicScript，维持 characterSheet ↔ comicScript 双向同步不变量。
  const handleRestoreSession = async () => {
    const saved: PersistedSession | null = pendingSession;
    if (!saved || isRestoring) return;
    setIsRestoring(true);
    try {
      const restoredChars: CharacterSheetItem[] = await Promise.all(
        saved.characterSheet.map(async ({ hasReference, ...rest }) => {
          if (!hasReference) return { ...rest };
          const img = await getImageAttachment(attIdForChar(rest.name));
          return img ? { ...rest, referenceImage: img } : { ...rest };
        })
      );
      const restoredProps: PropSheetItem[] = await Promise.all(
        saved.propSheet.map(async ({ hasReference, ...rest }) => {
          if (!hasReference) return { ...rest };
          const img = await getImageAttachment(attIdForProp(rest.name));
          return img ? { ...rest, referenceImage: img } : { ...rest };
        })
      );
      const restoredPages: ComicPageData[] = await Promise.all(
        saved.pages.map(async ({ hasImage, ...rest }) => {
          const base: ComicPageData = { ...rest, isGenerating: false }; // 上次中断的未完成页保留其 error 态
          if (!hasImage) return base;
          const img = await getImageAttachment(attIdForPage(base.page_number));
          return img
            ? { ...base, imageData: img, error: undefined }
            : { ...base, error: '图像附件丢失，可单独重绘' }; // 标记有图但附件读不回（命中失效）
        })
      );

      // 设定图重新注入 comicScript.character_sheet / prop_sheet（双向同步不变量）
      let script = saved.comicScript;
      if (script) {
        script = {
          ...script,
          character_sheet: (script.character_sheet || []).map(item => {
            const m = restoredChars.find(c => c.name === item.name);
            return m?.referenceImage ? { ...item, referenceImage: m.referenceImage } : item;
          }),
          prop_sheet: (script.prop_sheet || []).map(item => {
            const m = restoredProps.find(p => p.name === item.name);
            return m?.referenceImage ? { ...item, referenceImage: m.referenceImage } : item;
          }),
        };
      }

      // 已在盘上的图登记进去重表，避免恢复后的编辑回调重复 put 附件
      persistedRefImagesRef.current.clear();
      restoredChars.forEach(c => { if (c.referenceImage) persistedRefImagesRef.current.set(attIdForChar(c.name), c.referenceImage); });
      restoredProps.forEach(p => { if (p.referenceImage) persistedRefImagesRef.current.set(attIdForProp(p.name), p.referenceImage); });

      setConfig(prev => ({ ...prev, sourceText: saved.sourceText })); // 源文本随会话回填
      setComicScript(script);
      setCharacterSheet(restoredChars);
      setPropSheet(restoredProps);
      setPages(restoredPages);
      // 方案 5.2：TokenUsage 形状已改（Record breakdown + modelId history），
      // 旧快照的 usage 部分单独校验降级，不牵连整个会话的可恢复性
      setTokenUsage(sanitizePersistedUsage(saved.tokenUsage));
      setStoryboardTab(saved.storyboardTab === 'SCRIPT' ? 'SCRIPT' : 'CHARACTERS');
      setGlobalError(null);
      setWorkflowStep(saved.workflowStep);
      setPendingSession(null);
    } catch (e: any) {
      console.warn('[persist] restore failed:', e);
      setGlobalError('恢复上次创作失败，可重试或选择放弃。');
    } finally {
      setIsRestoring(false);
    }
  };

  // 放弃恢复（方案 3.1 步骤 5.5）：清 session 键与全部会话附件；config 保留
  const handleDiscardSession = () => {
    if (isRestoring) return;
    discardSessionData();
  };

  return {
    pendingSession,
    isRestoring,
    persistReferenceImage,
    beginNewSession,
    discardSessionData,
    handleRestoreSession,
    handleDiscardSession,
  };
};

// ================= 多工程持久化 hook（多工程管理改造，泛化自原 useSessionPersistence） =================
// 职责：启动读回（全局 config + v1→v2 迁移 + 工程索引）/ config 防抖写回（无激活工程时）/
// 工程快照防抖落盘（含 config 快照）/ 三通道兜底 flush / 打开-新建-重命名-删除工程。
// 存储 schema 与读写工具在 services/persistenceService.ts；工程数量不设上限；
// 切换工程前先 flush 当前工程（flushProject 同时收敛防抖尾巴）再按 id 加载恢复。

import { useState, useRef, useEffect, useCallback } from 'react';
import {
  SCHEMA_VERSION,
  PersistedProject,
  ProjectIndexEntry,
  stripSheetImages,
  attIdForPage,
  attIdForChar,
  attIdForProp,
  attIdForScene,
  putImageAttachment,
  getImageAttachment,
  saveProjectDebounced,
  flushProject,
  cancelPendingProjectSave,
  isRestorableProject,
  loadConfigFromStorage,
  saveConfigToStorage,
  loadProjectIndex,
  loadProject,
  createProjectEntry,
  renameProject as renameProjectInStore,
  deleteProject as deleteProjectInStore,
  migrateLegacySession,
  setActiveProjectId,
  getActiveProjectId,
} from '../services/persistenceService';
import { sanitizePersistedUsage } from './useUsageTracker';
import { getTheme } from '../theme/registry';
import {
  AppConfig,
  CharacterSheetItem,
  ComicPageData,
  ComicResponse,
  PropSheetItem,
  SceneSheetItem,
  TokenUsage,
  WorkflowStep,
} from '../engine-types';

type StateSetter<T> = (value: T | ((prev: T) => T)) => void;

interface UseProjectPersistenceDeps {
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
  sceneSheet: SceneSheetItem[];
  setSceneSheet: StateSetter<SceneSheetItem[]>;
  pages: ComicPageData[];
  setPages: StateSetter<ComicPageData[]>;
  tokenUsage: TokenUsage;
  setTokenUsage: StateSetter<TokenUsage>;
  setGlobalError: StateSetter<string | null>;
}

export const useProjectPersistence = ({
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
  sceneSheet,
  setSceneSheet,
  pages,
  setPages,
  tokenUsage,
  setTokenUsage,
  setGlobalError,
}: UseProjectPersistenceDeps) => {
  // 工程索引与当前激活工程 id（与 service 层命名空间同步）
  const [projects, setProjects] = useState<ProjectIndexEntry[]>([]);
  const [activeProjectIdState, setActiveProjectIdState] = useState<string | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);
  // config 读回完成前不允许写回，避免 INITIAL_CONFIG 默认值抢写（方案 3.2）
  const configHydratedRef = useRef(false);
  // 快照 effect 用于识别 workflowStep 迁移（迁移点 delay=0 立即写盘）
  const lastSnapshotStepRef = useRef<WorkflowStep | null>(null);
  // 已落盘的参考图（attachmentId → dataUrl），避免描述逐键编辑时重复 put 附件
  const persistedRefImagesRef = useRef<Map<string, string>>(new Map());

  /** 设置激活工程：hook state + service 命名空间同步切换 */
  const activateProject = useCallback((id: string | null) => {
    setActiveProjectId(id);
    setActiveProjectIdState(id);
  }, []);

  // 启动（方案 3.1 步骤 5 + 3.2 步骤 1 的多工程版）：并行读回全局 config 与工程索引，
  // 并做 v1→v2 迁移（含旧前缀附件搬移/孤儿清理）。不自动恢复任何工程——
  // 由「继续上次创作」快捷卡或工程画廊发起打开。
  useEffect(() => {
    if (!mulbyReady) return;
    let cancelled = false;
    void (async () => {
      try {
        const [savedConfig] = await Promise.all([loadConfigFromStorage()]);
        if (cancelled) return;

        // config 读回：sourceText 属工程会话内容，明确不随全局 config 恢复。
        // v1/v2 全局 config 形状一致（仅版本号不同），均接受
        const cfg = savedConfig as ({ v?: number; savedAt?: number } & Partial<AppConfig>) | null;
        if (cfg && (cfg.v === SCHEMA_VERSION || cfg.v === 1)) {
          const { v, savedAt, ...rest } = cfg;
          setConfig(prev => ({ ...prev, ...rest, sourceText: prev.sourceText }));
        }

        await migrateLegacySession(); // v1→v2（含旧前缀清理）
        const index = await loadProjectIndex();
        if (!cancelled) setProjects(index);
      } catch (e) {
        console.warn('[persist] startup hydrate failed:', e);
      } finally {
        configHydratedRef.current = true;
      }
    })();
    return () => { cancelled = true; };
  }, [mulbyReady]);

  // config 变化写回全局默认值（方案 3.2）：仅在没有激活工程时写——
  // 工程打开期间 config 归工程快照管，不污染新建工程的默认值
  useEffect(() => {
    if (!mulbyReady || !configHydratedRef.current) return;
    if (activeProjectIdState) return;
    const { sourceText, ...persistable } = config;
    const t = setTimeout(() => {
      void saveConfigToStorage({ v: SCHEMA_VERSION, savedAt: Date.now(), ...persistable });
    }, 500);
    return () => clearTimeout(t);
  }, [mulbyReady, config, activeProjectIdState]);

  // 工程快照（方案 3.1 步骤 2 的多工程版）：任一会话状态变化即防抖落盘（base64 全部剥离，
  // 附该工程自己的 config 快照）。CONFIG 未开始创作不写；SCRIPT_GENERATION 是过渡态
  // （comicScript 仍是上一轮、pages 已清空），写入会用残缺快照覆盖最后一份完整会话，同样跳过。
  useEffect(() => {
    if (!mulbyReady || !activeProjectIdState) return;
    if (workflowStep === WorkflowStep.CONFIG || workflowStep === WorkflowStep.SCRIPT_GENERATION) {
      lastSnapshotStepRef.current = workflowStep;
      return;
    }
    const stepChanged = lastSnapshotStepRef.current !== workflowStep;
    lastSnapshotStepRef.current = workflowStep;
    const { sourceText, ...persistableConfig } = config;
    const savedAt = Date.now();
    saveProjectDebounced(activeProjectIdState, {
      v: SCHEMA_VERSION,
      savedAt,
      workflowStep,
      storyboardTab,
      sourceText: config.sourceText,
      config: persistableConfig,
      comicScript: stripSheetImages(comicScript), // 剥离 sheet 内 referenceImage
      characterSheet: characterSheet.map(({ referenceImage, ...rest }) =>
        ({ ...rest, hasReference: !!referenceImage })),
      propSheet: propSheet.map(({ referenceImage, ...rest }) =>
        ({ ...rest, hasReference: !!referenceImage })),
      sceneSheet: sceneSheet.map(({ referenceImage, ...rest }) =>
        ({ ...rest, hasReference: !!referenceImage })),
      pages: pages.map(({ imageData, isGenerating, progress, ...rest }) =>
        ({ ...rest, hasImage: !!imageData })),
      tokenUsage: { ...tokenUsage, history: tokenUsage.history.slice(-200) },
    }, stepChanged ? 0 : undefined); // 工作流迁移属关键节点：立即写盘

    // 本地索引同步（与 flushProject 的索引更新同口径；title/createdAt 保留）
    setProjects(prev => {
      const entry = prev.find(e => e.id === activeProjectIdState);
      if (!entry) return prev;
      const updated: ProjectIndexEntry = {
        ...entry,
        updatedAt: savedAt,
        workflowStep,
        pageCount: pages.length,
        donePages: pages.filter(p => !!p.imageData).length,
        coverAttId: pages.some(p => p.page_number === 0 && !!p.imageData)
          ? `p-${activeProjectIdState}-page-0`
          : undefined,
      };
      return prev.map(e => (e.id === activeProjectIdState ? updated : e));
    });
  }, [mulbyReady, activeProjectIdState, workflowStep, storyboardTab, comicScript,
      characterSheet, propSheet, sceneSheet, pages, tokenUsage, config]);

  // 兜底保存（方案 3.1 步骤 4）：onPluginOut 覆盖 Esc/outPlugin 路径；
  // pagehide 覆盖独立窗口 X 关闭（该路径宿主不发 plugin:out）；beforeunload 覆盖 Reload。
  useEffect(() => {
    // 返回值按宿主实际行为是取消订阅函数；项目未装 @types/react 且 @types/node 的全局
    // Disposable 覆盖了 mulby.d.ts 的同名别名，这里显式断言为函数类型
    const unsub = (window as Window).mulby?.onPluginOut?.(() => { void flushProject(); }) as unknown as (() => void) | undefined;
    const onTeardown = () => { void flushProject(); }; // fire-and-forget IPC，尽力而为
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

  /** 新剧本生成成功 = 唯一确立"新工程"的时刻：建档并切换命名空间；
   *  快照由快照 effect 在迁移到 STORYBOARDING 时立即写入。不再清任何旧数据。 */
  const beginNewProject = useCallback(async (title: string): Promise<ProjectIndexEntry> => {
    persistedRefImagesRef.current.clear();
    const entry = await createProjectEntry(title);
    activateProject(entry.id);
    setProjects(prev => [entry, ...prev.filter(e => e.id !== entry.id)]);
    return entry;
  }, [activateProject]);

  /** 确认丢弃当前创作（Start Over / 载入新素材）：删除当前工程（KV + 附件 + 索引）并脱离激活态 */
  const discardActiveProject = useCallback(async (): Promise<void> => {
    cancelPendingProjectSave();
    persistedRefImagesRef.current.clear();
    const id = getActiveProjectId();
    if (id) {
      await deleteProjectInStore(id);
      setProjects(prev => prev.filter(e => e.id !== id));
    }
    activateProject(null);
  }, [activateProject]);

  /** 打开工程：先 flush 当前工程落盘，再按 id 加载恢复（含该工程 config 快照回填）。 */
  const openProject = useCallback(async (id: string): Promise<boolean> => {
    if (isRestoring) return false;
    setIsRestoring(true);
    try {
      await flushProject(); // 切换工程前先 flush 当前工程（含防抖尾巴）
      const saved = await loadProject(id);
      if (!isRestorableProject(saved)) {
        setGlobalError(getTheme().strings.projectOpenFailed);
        return false;
      }

      // 先切命名空间，再按 hasReference/hasImage 标记读回附件并转 dataURL
      activateProject(id);

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
      // 场景为后加字段：旧快照无 sceneSheet，按 [] 恢复（比照 prop 全链路）
      const restoredScenes: SceneSheetItem[] = await Promise.all(
        (saved.sceneSheet || []).map(async ({ hasReference, ...rest }) => {
          if (!hasReference) return { ...rest };
          const img = await getImageAttachment(attIdForScene(rest.name));
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

      // 设定图重新注入 comicScript.character_sheet / prop_sheet / scene_sheet（双向同步不变量）
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
          scene_sheet: (script.scene_sheet || []).map(item => {
            const m = restoredScenes.find(s => s.name === item.name);
            return m?.referenceImage ? { ...item, referenceImage: m.referenceImage } : item;
          }),
        };
      }

      // 已在盘上的图登记进去重表，避免恢复后的编辑回调重复 put 附件
      persistedRefImagesRef.current.clear();
      restoredChars.forEach(c => { if (c.referenceImage) persistedRefImagesRef.current.set(attIdForChar(c.name), c.referenceImage); });
      restoredProps.forEach(p => { if (p.referenceImage) persistedRefImagesRef.current.set(attIdForProp(p.name), p.referenceImage); });
      restoredScenes.forEach(s => { if (s.referenceImage) persistedRefImagesRef.current.set(attIdForScene(s.name), s.referenceImage); });

      // config 一并恢复为该工程快照（v1 迁移来的工程无 config 快照，回退保留当前值）
      setConfig(prev => ({ ...prev, ...(saved.config || {}), sourceText: saved.sourceText }));
      setComicScript(script);
      setCharacterSheet(restoredChars);
      setPropSheet(restoredProps);
      setSceneSheet(restoredScenes);
      setPages(restoredPages);
      // 方案 5.2：TokenUsage 形状已改（Record breakdown + modelId history），
      // 旧快照的 usage 部分单独校验降级，不牵连整个会话的可恢复性
      setTokenUsage(sanitizePersistedUsage(saved.tokenUsage));
      setStoryboardTab(saved.storyboardTab === 'SCRIPT' ? 'SCRIPT' : 'CHARACTERS');
      setGlobalError(null);
      setWorkflowStep(saved.workflowStep);
      return true;
    } catch (e: any) {
      console.warn('[persist] open project failed:', e);
      setGlobalError(getTheme().strings.projectOpenRetry);
      return false;
    } finally {
      setIsRestoring(false);
    }
  }, [isRestoring, activateProject, setConfig, setComicScript, setCharacterSheet,
      setPropSheet, setPages, setTokenUsage, setStoryboardTab, setGlobalError, setWorkflowStep]);

  /** 重命名工程（索引标题） */
  const renameProject = useCallback(async (id: string, title: string): Promise<void> => {
    await renameProjectInStore(id, title);
    setProjects(prev => prev.map(e => (e.id === id ? { ...e, title: title.trim() || e.title } : e)));
  }, []);

  /** 删除工程；返回被删的是否为当前激活工程（调用方据此重置工作台） */
  const deleteProject = useCallback(async (id: string): Promise<boolean> => {
    const wasActive = getActiveProjectId() === id;
    if (wasActive) {
      cancelPendingProjectSave();
      persistedRefImagesRef.current.clear();
      activateProject(null);
    }
    await deleteProjectInStore(id);
    setProjects(prev => prev.filter(e => e.id !== id));
    return wasActive;
  }, [activateProject]);

  return {
    projects,
    activeProjectId: activeProjectIdState,
    isRestoring,
    persistReferenceImage,
    beginNewProject,
    discardActiveProject,
    openProject,
    renameProject,
    deleteProject,
    flushProject,
  };
};

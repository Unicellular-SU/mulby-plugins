
import React, { useState, useCallback, useEffect, useRef } from 'react';
import ConfigPanel from './components/ConfigPanel';
import PanelCard from './components/PanelCard';
import LogPanel from './components/LogPanel';
import CharacterGenerator from './components/CharacterGenerator';
import ScriptEditor from './components/ScriptEditor';
import TokenMonitor from './components/TokenMonitor';
import { generateComicScript, reviseScriptWithFeedback, setActiveModels, getAbortEpoch, isStale, clearReferenceAttachmentCache } from './services/mulbyAiService';
import { useUsageTracker, INITIAL_USAGE } from './hooks/useUsageTracker';
import { useImageQueue } from './hooks/useImageQueue';
import { useComicWorkflow } from './hooks/useComicWorkflow';
import { saveBinary, buildZipArchive, buildPdfDocument, buildLongImages, revealInFolder } from './services/exportService';
import ReaderOverlay from './components/ReaderOverlay';
import ProjectGallery from './components/ProjectGallery';
import { attIdForChar, attIdForProp, attIdForScene, loadProject, isRestorableProject, getImageAttachment } from './services/persistenceService';
import { useProjectPersistence } from './hooks/useProjectPersistence';
import { getCharacterReference, buildCoverPage, prepareScenePages, resolvePageRefs } from './utils/promptBuilder';
import { AppConfig, ComicPageData, WorkflowStep, CharacterSheetItem, PropSheetItem, SceneSheetItem, ComicResponse, WatermarkSettings } from './engine-types';
import { ASPECT_RATIOS, PAGE_LENGTH_OPTIONS } from './constants';
import { getTheme } from './theme/registry';
import type { MangaTheme } from './theme/types';
import { trimErr } from './utils/text';
import { applyWatermark } from './utils/watermarkUtils';

// Initial Config State（默认值取自主题数据首项/default 标记：与题材数据 1:1 对应）
const buildInitialConfig = (theme: MangaTheme): AppConfig => {
  const config: AppConfig = {
    sourceText: '',
    style: theme.artStyles[0]?.value || '',
    character: theme.characterPresets[0] || { name: '', description: '' },
    storyMode: ((theme.storyModes.find(m => m.default) ?? theme.storyModes[0])?.value ?? '') as AppConfig['storyMode'],
    customStoryPrompt: '',
    panelCount: 0,
    aspectRatio: ASPECT_RATIOS[0].value,
    totalPages: PAGE_LENGTH_OPTIONS[0].value, // Default to short
    autoReview: true, // 默认开启剧本自动审校
  };
  // Phase 2 可选维度：仅对应 features 开关开启时写入初始值（关闭时 config 保持 Phase 1 形状）
  if (theme.features.endings && theme.endings?.length) {
    config.endingType = (theme.endings.find(e => e.default) ?? theme.endings[0]).value;
  }
  if (theme.features.watermark && theme.watermark) {
    config.watermark = { ...theme.watermark.defaults };
  }
  if (theme.colorModes?.length) {
    config.colorMode = (theme.colorModes.find(c => c.default) ?? theme.colorModes[0]).value;
  }
  return config;
};

// 方案 5.7：onPluginInit 缓冲重放 / React StrictMode 双挂载去重表——
// 必须放模块级（组件外），effect 内闭包在重挂载时重置，挡不住缓冲重放
const lastInitNonce = { v: -1 as number | string };

const MangaApp: React.FC = () => {
  // 当前题材主题（插件入口 setTheme 注入；生命周期内不可变）
  const theme = getTheme();
  const S = theme.strings;
  const [config, setConfig] = useState<AppConfig>(() => buildInitialConfig(theme));

  // 色彩模式提示词（theme.colorModes）：追加到风格字符串，参与角色/道具/页面全部图像 prompt
  const colorHint = theme.colorModes?.find(c => c.value === config.colorMode)?.promptHint;
  const effectiveStyle = colorHint ? `${config.style}. ${colorHint}` : config.style;
  // Data State
  const [comicScript, setComicScript] = useState<ComicResponse | null>(null);
  const [characterSheet, setCharacterSheet] = useState<CharacterSheetItem[]>([]);
  const [propSheet, setPropSheet] = useState<PropSheetItem[]>([]);
  const [sceneSheet, setSceneSheet] = useState<SceneSheetItem[]>([]);
  const [pages, setPages] = useState<ComicPageData[]>([]);
  
  // Storyboarding Phase State
  const [storyboardTab, setStoryboardTab] = useState<'SCRIPT' | 'CHARACTERS'>('CHARACTERS');

  // Log States
  const [inputLog, setInputLog] = useState<string>('');
  const [outputLog, setOutputLog] = useState<string>('');
  const [reasoningLog, setReasoningLog] = useState<string>(''); // 推理模型思考流（右侧终端「思考」块）
  const [streamPhase, setStreamPhase] = useState<string>('');   // 流式相位徽标（生成剧本 / 自动审校）

  // 统一处理服务层流式回调（生成/审校/意见迭代共用）：PHASE 切相位并清空上一 pass 的思考与输出
  const handleLogUpdate = useCallback((type: 'INPUT' | 'OUTPUT' | 'REASONING' | 'PHASE', text: string) => {
    if (type === 'INPUT') setInputLog(text);
    else if (type === 'OUTPUT') setOutputLog(text);
    else if (type === 'REASONING') setReasoningLog(text);
    else if (type === 'PHASE') { setStreamPhase(text); setReasoningLog(''); setOutputLog(''); }
  }, []);

  // Token Usage State（方案 7.4 步骤 4：计价器收敛进 hooks/useUsageTracker）
  const { tokenUsage, setTokenUsage, trackUsage } = useUsageTracker();

  // Mulby AI 可用性检查（替代原 AI Studio API Key 检查）
  const [mulbyReady, setMulbyReady] = useState(false);
  const [checkingMulby, setCheckingMulby] = useState(true);

  // 方案 5.1：批次通知一次性标志（active）+ 运行代际（epoch）双保险防噪；
  // App 持有并同时传给 useImageQueue（批次消费）与 handleCancelAll（中止关标志）
  const batchRef = useRef<{ active: boolean; epoch: number }>({ active: false, epoch: 0 });

  // 工作流状态机（方案 7.4 步骤 1：step/isProcessing/globalError + 统一中止入口收敛进 hook）
  const {
    workflowStep, setWorkflowStep,
    isProcessing, setIsProcessing,
    globalError, setGlobalError,
    handleCancelAll,
    abortInFlightTasks,
    handlePermissionError,
  } = useComicWorkflow({ setPages, batchRef });

  // 方案 5.7：onPluginInit 回调闭包只建一次，经 ref 读取当前工作流位置
  const workflowStepRef = useRef(workflowStep);
  useEffect(() => { workflowStepRef.current = workflowStep; }, [workflowStep]);

  // 多工程持久化：启动读回（全局 config + v1→v2 迁移 + 工程索引）+ config 防抖写回 +
  // 工程快照防抖落盘 + 三通道兜底 flush + 打开/新建/重命名/删除工程
  const {
    projects,
    isRestoring,
    persistReferenceImage,
    beginNewProject,
    discardActiveProject,
    openProject,
    renameProject,
    deleteProject,
  } = useProjectPersistence({
    mulbyReady,
    config, setConfig,
    workflowStep, setWorkflowStep,
    storyboardTab, setStoryboardTab,
    comicScript, setComicScript,
    characterSheet, setCharacterSheet,
    propSheet, setPropSheet,
    sceneSheet, setSceneSheet,
    pages, setPages,
    tokenUsage, setTokenUsage,
    setGlobalError,
  });

  // 方案 5.6：全屏阅读模式（当前阅读页在"有图页序列"中的下标；null = 关闭）
  const [readerIndex, setReaderIndex] = useState<number | null>(null);

  // 方案 5.5/5.6：导出菜单与结果条幅
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportedPath, setExportedPath] = useState<string | null>(null);

  /** 系统通知（方案 5.1）：老宿主 / 未声明权限静默降级 */
  const notify = useCallback((message: string, type?: 'error') => {
    try {
      void (window as Window).mulby?.notification?.show?.(message, type)?.catch?.(() => { /* ignore */ });
    } catch { /* 老宿主：静默降级 */ }
  }, []);

  useEffect(() => {
    // window.mulby 由宿主 preload 注入，通常同步可用；轮询兜底注入时序
    let attempts = 0;
    const check = () => {
      if ((window as any).mulby?.ai) {
        setMulbyReady(true);
        setCheckingMulby(false);
        return;
      }
      attempts += 1;
      if (attempts >= 10) {
        setCheckingMulby(false);
        return;
      }
      setTimeout(check, 200);
    };
    check();
  }, []);

  // 把配置面板选择的模型注入 AI 服务（避免逐层透传 props）
  useEffect(() => {
    setActiveModels({ textModel: config.textModel, imageModel: config.imageModel });
  }, [config.textModel, config.imageModel]);

  // 丢弃当前创作并回到配置页：Start Over 与 5.7「载入新素材」共用（确认后调用）
  const discardCurrentWork = useCallback(() => {
    handleCancelAll();      // bump epoch（连带停掉 CharacterGenerator 循环与 asyncPool 排队）
    clearReferenceAttachmentCache(); // D3：确认丢弃即删除已上传参考图附件并清缓存（方案 4.1）
    setComicScript(null);
    setCharacterSheet([]);
    setPropSheet([]);
    setSceneSheet([]);
    setPages([]);
    setInputLog('');
    setOutputLog('');
    setReasoningLog('');
    setStreamPhase('');
    setGlobalError(null);
    setExportedPath(null);
    setReaderIndex(null);
    setWorkflowStep(WorkflowStep.CONFIG);
    // 确认丢弃即删除当前工程（KV + 附件 + 索引；config 默认值保留）——
    // 第 2 章把 Start Over 改成了「确认 + 真正重置」，保留持久化会跟"不可恢复"的确认语义冲突
    void discardActiveProject();
  }, [handleCancelAll, discardActiveProject]);

  // 方案 5.7：启动器入口——选中文本（over）/ 文件（files）payload 一键预填源素材。
  // 宿主 onPluginInit 自带缓冲重放（专治 React 晚注册）；nonce 去重表在模块级。
  const applyIncomingSource = useCallback(async (text: string) => {
    if (workflowStepRef.current !== WorkflowStep.CONFIG) {
      // single 窗口复用时已在创作中：确认后按 D2 统一清场再预填，取消则忽略 payload
      const dlg = (window as Window).mulby?.dialog;
      const ok = dlg?.showMessageBox
        ? (await dlg.showMessageBox({
            type: 'warning',
            message: '载入新素材将中止当前任务，并丢弃当前剧本与已生成页面',
            buttons: ['取消', '丢弃并载入新素材'],
            defaultId: 0,
            cancelId: 0,
          })).response === 1
        : window.confirm('载入新素材将丢弃当前漫画，确定继续？'); // 老宿主降级
      if (!ok) return;
      discardCurrentWork();
    }
    setConfig(prev => ({ ...prev, sourceText: text }));
    setGlobalError(null);
  }, [discardCurrentWork]);

  useEffect(() => {
    const off = (window as Window).mulby?.onPluginInit?.(async (data) => {
      try {
        if (data?.nonce != null && data.nonce === lastInitNonce.v) return; // 缓冲重放/StrictMode 去重
        lastInitNonce.v = data?.nonce ?? -1;
        let text = data?.input || '';
        const filePath = data?.attachments?.[0]?.path;
        if (!text && filePath) {
          try {
            const content = await (window as Window).mulby?.filesystem?.readFile?.(filePath, 'utf-8');
            text = typeof content === 'string' ? content : '';
          } catch {
            setGlobalError('无法读取选中的文件，请确认文件为 UTF-8 文本。');
            return;
          }
        }
        if (text) void applyIncomingSource(text);
      } catch (e) {
        console.warn('[init] onPluginInit handling failed:', e);
      }
    }) as unknown as (() => void) | undefined;
    return () => { off?.(); };
  }, [applyIncomingSource]);

  // Start Over：确认后中止在途任务并真正重置（方案 2.1 步骤 5）
  const handleStartOver = async () => {
    const done = pages.filter(p => p.imageData).length;
    const dlg = (window as any).mulby?.dialog;
    const ok = dlg?.showMessageBox
      ? (await dlg.showMessageBox({
          type: 'warning',
          message: '重新开始将中止所有在途任务，并丢弃当前剧本与已生成页面',
          detail: done > 0 ? `已生成 ${done} 页图像，此操作不可恢复。` : undefined,
          buttons: ['取消', '丢弃并重新开始'],
          defaultId: 0,
          cancelId: 0,
        })).response === 1
      : window.confirm('将丢弃当前剧本与已生成页面，确定重新开始？'); // 老宿主降级
    if (!ok) return;
    discardCurrentWork();
  };

  // Phase 2 水印（features.watermark）：全局设置变化时，对未做逐页覆盖的有图页重加水印
  useEffect(() => {
    if (!theme.features.watermark || !config.watermark) return;
    if (!pages.some(p => p.rawImageData)) return;
    void (async () => {
      const updated = await Promise.all(pages.map(async (page) => {
        if (page.rawImageData && !page.watermarkOverrides) {
          const watermarked = await applyWatermark(page.rawImageData, config.watermark!, theme.watermark?.fallbackText);
          return { ...page, imageData: watermarked };
        }
        return page;
      }));
      setPages(updated);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.watermark]);

  // Phase 2 水印：逐页覆盖/清除覆盖（覆盖应用经 useImageQueue 在重绘时生效）
  const handlePageWatermarkUpdate = useCallback(async (pageNumber: number, settings?: WatermarkSettings) => {
    if (!theme.features.watermark) return;
    const updated = await Promise.all(pages.map(async (page) => {
      if (page.page_number !== pageNumber) return page;
      const effective = settings || config.watermark;
      let newImageData = page.imageData;
      if (page.rawImageData && effective) {
        newImageData = await applyWatermark(page.rawImageData, effective, theme.watermark?.fallbackText);
      }
      return { ...page, watermarkOverrides: settings, imageData: newImageData };
    }));
    setPages(updated);
  }, [theme, pages, config.watermark]);

  // 图像生成队列（方案 7.4 步骤 2：triggerImageGeneration / 批量调度收敛进 hooks/useImageQueue）
  const { triggerImageGeneration, runBatch } = useImageQueue({
    pages,
    setPages,
    batchRef,
    trackUsage,
    handlePermissionError,
    notify,
    // Phase 2 水印：该页生效设置（逐页覆盖 || 全局）；开关关闭时恒 undefined，生成链路不变
    getEffectiveWatermark: (page) => (theme.features.watermark && config.watermark
      ? (page.watermarkOverrides || config.watermark)
      : undefined),
  });

  // STEP 1: Generate Script
  const handleGenerateScript = async () => {
    handleCancelAll();                  // D2：终止上一轮（bump epoch + 清定时器 + 关 isProcessing）
    const runEpoch = getAbortEpoch();   // D1：捕获本轮代际，迟到回调据此丢弃

    setGlobalError(null);
    setIsProcessing(true);
    setInputLog('');
    setOutputLog('');
    setReasoningLog('');
    setStreamPhase('');
    setPages([]);

    setTokenUsage(INITIAL_USAGE);

    try {
      setWorkflowStep(WorkflowStep.SCRIPT_GENERATION);
      const comicData = await generateComicScript(
        config.sourceText,
        config.style,
        config.character,
        config.storyMode,
        config.customStoryPrompt,
        config.panelCount,
        config.totalPages,
        handleLogUpdate,
        (stat) => trackUsage('Generate Script', stat),
        // Phase 2 可选维度（结局 / 副模式）；tech 主题开关全关时为 undefined，prompt 不变
        { secondaryStoryMode: config.secondaryStoryMode, endingType: config.endingType, colorMode: config.colorMode, autoReview: config.autoReview }
      );
      if (isStale(runEpoch)) return;    // 本轮已被中止/替代：不写回任何状态

      // 新剧本生成成功 = 唯一确立"新工程"的时刻（多工程管理）：
      // 建档并切换附件命名空间；快照由快照 effect 在迁移到 STORYBOARDING 时立即写入。不清任何旧数据。
      await beginNewProject(comicData.title || S.projectUntitled(new Date().toLocaleString()));
      clearReferenceAttachmentCache(); // D3：旧剧本的参考图上传缓存与 AI 附件一并清理（方案 4.1）

      setComicScript(comicData);
      setCharacterSheet(comicData.character_sheet || []);
      setPropSheet(comicData.prop_sheet || []);
      setSceneSheet(comicData.scene_sheet || []);
      setWorkflowStep(WorkflowStep.STORYBOARDING);
      setStoryboardTab('CHARACTERS');

      // 方案 5.1：剧本完成仅在用户切走时提醒（正盯着窗口不弹）
      if (document.hidden) notify(S.notifyScriptDone(comicData.title || S.untitled));

    } catch (error: any) {
      if (isStale(runEpoch)) return;    // 迟到的失败/中止：丢弃，不打扰新一轮
      if (error?.name === 'AbortError') {
         // 防御性保留；正常中止路径由 handleCancelAll 统一切回配置页
         setWorkflowStep(WorkflowStep.CONFIG);
      } else if (!handlePermissionError(error)) {
         setGlobalError(error.message || "剧本生成失败，请重试。");
         setWorkflowStep(WorkflowStep.CONFIG);
      }
    } finally {
      if (!isStale(runEpoch)) setIsProcessing(false);  // 过期回调不许关新一轮的 processing
    }
  };

  // D：剧本意见迭代（STORYBOARDING）：现剧本 + 用户意见 → 修订版，经 handleScriptUpdate 回写
  // （角色表按名字匹配合并，已定妆的 referenceImage 由 merge 逻辑保留）。
  // 修订不触碰 pages：已进入过 COMIC_GENERATION（有图页）时提示不自动重绘，可逐页重绘。
  const handleReviseScript = async (feedback: string): Promise<boolean> => {
    if (!comicScript || !feedback.trim() || isProcessing) return false;
    handleCancelAll();                  // D2：停在途（STORYBOARDING 一般无在途任务，防御性复用）
    const runEpoch = getAbortEpoch();

    setGlobalError(null);
    setIsProcessing(true);

    try {
      const revised = await reviseScriptWithFeedback(comicScript, feedback, {
        onLogUpdate: handleLogUpdate,
        onUsage: (stat) => trackUsage('Revise Script', stat),
      });
      if (isStale(runEpoch)) return false;

      handleScriptUpdate(revised);

      // 已进入过绘制阶段：只提示，不自动清 pages
      if (pages.some(p => p.imageData)) notify(S.reviseRedrawHint);
      return true;
    } catch (error: any) {
      if (isStale(runEpoch)) return false;
      if (error?.name === 'AbortError') return false; // 用户中止：静默收敛
      if (!handlePermissionError(error)) {
        setGlobalError(error.message || S.reviseFailed);
      }
      return false;
    } finally {
      if (!isStale(runEpoch)) setIsProcessing(false);
    }
  };
  const handleScriptUpdate = (updatedScript: ComicResponse) => {
    setComicScript(updatedScript);
    // Sync character sheet
    if (updatedScript.character_sheet) {
        const mergedSheet = updatedScript.character_sheet.map(newItem => {
            const existing = characterSheet.find(c => c.name === newItem.name);
            return existing ? { ...newItem, referenceImage: existing.referenceImage } : newItem;
        });
        setCharacterSheet(mergedSheet);
    }
    // Sync prop sheet
    if (updatedScript.prop_sheet) {
        const mergedProps = updatedScript.prop_sheet.map(newItem => {
            const existing = propSheet.find(p => p.name === newItem.name);
            return existing ? { ...newItem, referenceImage: existing.referenceImage } : newItem;
        });
        setPropSheet(mergedProps);
    }
    // Sync scene sheet（第三类资产：按名字匹配合并，保留已生成参考图）
    if (updatedScript.scene_sheet) {
        const mergedScenes = updatedScript.scene_sheet.map(newItem => {
            const existing = sceneSheet.find(s => s.name === newItem.name);
            return existing ? { ...newItem, referenceImage: existing.referenceImage } : newItem;
        });
        setSceneSheet(mergedScenes);
    }
  };

  // Handle updates from CharacterGenerator (Assets)
  const handleCharacterUpdate = useCallback((index: number, updatedChar: CharacterSheetItem) => {
     persistReferenceImage(attIdForChar(updatedChar.name), updatedChar.referenceImage);
     setCharacterSheet(prevSheet => {
        const newSheet = [...prevSheet];
        newSheet[index] = updatedChar;
        return newSheet;
     });
     setComicScript(prevScript => {
        if (!prevScript) return null;
        const prevSheet = prevScript.character_sheet || [];
        const newSheet = prevSheet.map((item, i) => i === index ? updatedChar : item);
        return { ...prevScript, character_sheet: newSheet };
     });
  }, [persistReferenceImage]);

  const handlePropUpdate = useCallback((index: number, updatedProp: PropSheetItem) => {
    persistReferenceImage(attIdForProp(updatedProp.name), updatedProp.referenceImage);
    setPropSheet(prevSheet => {
       const newSheet = [...prevSheet];
       newSheet[index] = updatedProp;
       return newSheet;
    });
    setComicScript(prevScript => {
       if (!prevScript) return null;
       const prevSheet = prevScript.prop_sheet || [];
       const newSheet = prevSheet.map((item, i) => i === index ? updatedProp : item);
       return { ...prevScript, prop_sheet: newSheet };
    });
 }, [persistReferenceImage]);

  const handleSceneUpdate = useCallback((index: number, updatedScene: SceneSheetItem) => {
    persistReferenceImage(attIdForScene(updatedScene.name), updatedScene.referenceImage);
    setSceneSheet(prevSheet => {
       const newSheet = [...prevSheet];
       newSheet[index] = updatedScene;
       return newSheet;
    });
    setComicScript(prevScript => {
       if (!prevScript) return null;
       const prevSheet = prevScript.scene_sheet || [];
       const newSheet = prevSheet.map((item, i) => i === index ? updatedScene : item);
       return { ...prevScript, scene_sheet: newSheet };
    });
 }, [persistReferenceImage]);

  // 剧本页面名单里未建档的角色名（B 层归一化保留原名不补建，交给用户决定）；
  // 与 characterSheet 精确比对，补建/吸附后自动消失
  const unmatchedCharNames = comicScript
    ? [...new Set((comicScript.pages || []).flatMap(p => p.characters_in_scene || []))]
        .filter(n => !characterSheet.some(c => c.name === n))
    : [];

  // C：补建角色（无参考图，用户在资产工坊随后生成定妆）
  const handleAddCharacter = (name: string) => {
    const item: CharacterSheetItem = { name, description: name };
    setCharacterSheet(prev => [...prev, item]);
    setComicScript(prev => prev ? { ...prev, character_sheet: [...(prev.character_sheet || []), item] } : prev);
  };

  // STEP 3: Start Comic Generation (Images)
  const handleStartComicGeneration = async () => {
      if (!comicScript) return;

      setWorkflowStep(WorkflowStep.COMIC_GENERATION);

      // Cover Page + PRE-CALCULATE PAGES（方案 7.4 步骤 3：拼装逻辑移至 utils/promptBuilder，逐字节等价）
      const mainCharRef = getCharacterReference(config.character.name, characterSheet);
      const coverCharacters = mainCharRef ? [config.character.name] : [];
      const coverPage = buildCoverPage(comicScript, effectiveStyle, coverCharacters);
      const preparedPages = prepareScenePages(comicScript, effectiveStyle, characterSheet, propSheet, sceneSheet);

      // 返回上一步后重进（或恢复工程后重进）：按 page_number 匹配现有页——
      // 已有 imageData 的页直接沿用（保留重绘后的 prompt / 图像 / 水印覆盖，不再入队）；
      // 无图 / 失败 / 新增页用新拼装的 prompt 与 refs 正常入队。封面页 page_number = 0（现有约定）。
      const rebuilt = [coverPage, ...preparedPages.map(p => p.pageData)];
      const jobs: Array<{ page: ComicPageData; refs?: string[] }> = [];
      const mergedPages = rebuilt.map((fresh, idx) => {
        const existing = pages.find(p => p.page_number === fresh.page_number);
        if (existing?.imageData) {
          return { ...existing, isGenerating: false, error: undefined };
        }
        const refs = idx === 0
          ? (mainCharRef ? [mainCharRef] : undefined)
          : (preparedPages[idx - 1].resolvedRefs as string[] | undefined);
        jobs.push({ page: fresh, refs });
        return { ...fresh, isGenerating: true, error: undefined };
      });
      setPages(mergedPages);

      // 方案 4.2（D4）：asyncPool(limit=2)——任意时刻在途图像请求 ≤2；
      // 全部页面已有图时 jobs 为空：不入队、不开批次，直接展示
      if (jobs.length === 0) return;

      // 方案 5.1：批次收尾通知挂在池全部 settle 之后（runBatch 内一次性标志 + epoch 双保险防噪）
      await runBatch(jobs, config.aspectRatio, comicScript.title);
  };

  // 返回上一步（仅 STORYBOARDING / COMIC_GENERATION 两步显示入口；SCRIPT_GENERATION 用取消按钮回 CONFIG）
  const handleGoBack = async () => {
    if (workflowStep === WorkflowStep.STORYBOARDING) {
      // 纯视图回退：comicScript/characterSheet/propSheet/pages 全部保留在 state
      // （改完配置重新生成剧本时按现有逻辑新工程建档，旧工程留在画廊）
      setWorkflowStep(WorkflowStep.CONFIG);
      return;
    }
    if (workflowStep !== WorkflowStep.COMIC_GENERATION) return;
    if (pages.some(p => p.isGenerating)) {
      // 有在途页面：确认后按纪元语义中止在途生成，已完成页保留
      const done = pages.filter(p => p.imageData).length;
      const dlg = (window as any).mulby?.dialog;
      const ok = dlg?.showMessageBox
        ? (await dlg.showMessageBox({
            type: 'warning',
            message: S.backAbortMessage,
            detail: done > 0 ? S.backAbortDetail(done) : undefined,
            buttons: [S.cancelBtn, S.backAbortConfirm],
            defaultId: 0,
            cancelId: 0,
          })).response === 1
        : window.confirm(S.backAbortMessage); // 老宿主降级
      if (!ok) return;
      abortInFlightTasks(); // 中止在途生成但不切回 CONFIG、不清 pages
    }
    setWorkflowStep(WorkflowStep.STORYBOARDING);
  };

  const handleRegeneratePage = useCallback((pageNumber: number, newPrompt: string, newCharactersInScene?: string[], newPropsInScene?: string[], newScenesInScene?: string[]) => {
      const page = pages.find(p => p.page_number === pageNumber);
      if (!page) return;

      const activeCharacterNames = newCharactersInScene || page.characters_in_scene || [];
      const activePropNames = newPropsInScene || page.props_in_scene || [];
      const activeSceneNames = newScenesInScene || page.scenes_in_scene || [];

      const { refs: sceneRefs, finalPrompt: finalPromptToUse } =
          resolvePageRefs(newPrompt, activeCharacterNames, activePropNames, characterSheet, propSheet, activeSceneNames, sceneSheet);

      setPages(prev => prev.map(p =>
        p.page_number === pageNumber
        ? {
            ...p,
            image_prompt: finalPromptToUse,
            characters_in_scene: activeCharacterNames,
            props_in_scene: activePropNames,
            scenes_in_scene: activeSceneNames,
            isGenerating: true,
            error: undefined
          }
        : p
      ));

      triggerImageGeneration(
          { ...page, image_prompt: finalPromptToUse, characters_in_scene: activeCharacterNames, props_in_scene: activePropNames, scenes_in_scene: activeSceneNames },
          config.aspectRatio,
          sceneRefs
      );

  }, [config.aspectRatio, pages, characterSheet, propSheet, sceneSheet, triggerImageGeneration]);

  // 方案 4.4：续绘全部未完成页（失败/中止页批量重发，走并发池，自然获得重试与中止响应）。
  // 与第 3 章恢复路径衔接：恢复到 COMIC_GENERATION 后未完成页带 error 态，可在此一键续绘。
  const unfinishedPages = pages.filter(p => !p.imageData && !p.isGenerating);

  const handleResumeAll = async () => {
      const targets = pages.filter(p => !p.imageData && !p.isGenerating);
      if (targets.length === 0) return;

      // 参考图按当前 sheet 重新解析（恢复会话后 D3 缓存为空，重绘自然重传）；
      // 页面 prompt 保持现状不重建——首轮生成已含 context 块，封面 prompt 无标记也不受影响。
      const prepared = targets.map(p => ({
          page: p,
          refs: resolvePageRefs(p.image_prompt, p.characters_in_scene || [], p.props_in_scene || [], characterSheet, propSheet, p.scenes_in_scene || [], sceneSheet).refs,
      }));

      setPages(prev => prev.map(p =>
          targets.some(t => t.page_number === p.page_number)
              ? { ...p, isGenerating: true, error: undefined }
              : p
      ));

      // 方案 5.1：续绘同为批量操作，收尾通知同批次口径（单页重绘不在此列）
      await runBatch(prepared, config.aspectRatio, comicScript?.title);
  };

  // \u65b9\u6848 5.5/5.6\uff1a\u5bfc\u51fa\u7edf\u4e00\u8d70\u539f\u751f\u4fdd\u5b58\u6d41\uff08saveBinary\uff09\uff0c\u683c\u5f0f\u4e09\u9009\u4e00\uff1aZIP \u6563\u56fe / PDF / \u7ad6\u5411\u957f\u56fe\u3002
  // \u6210\u529f\u540e\u663e\u793a\u5e26\u300c\u5728\u6587\u4ef6\u5939\u4e2d\u663e\u793a\u300d\u7684\u6761\u5e45\u5e76 notify\uff08\u590d\u7528 5.1\uff09\uff1b\u8001\u5bbf\u4e3b\u964d\u7ea7 <a download>\u3002
  const handleExport = async (kind: 'zip' | 'pdf' | 'long') => {
    const pagesWithImages = pages.filter(p => p.imageData);
    if (pagesWithImages.length === 0 || isExporting) return;
    setExportMenuOpen(false);
    setIsExporting(true);
    setExportedPath(null);

    const comicTitle = pages[0]?.title || S.defaultComicFileName;
    const safeTitle = comicTitle.replace(/[^a-z0-9\u4e00-\u9fa5]/gi, '_').substring(0, 50);

    try {
        const saved: string[] = [];
        if (kind === 'zip') {
            const buf = await buildZipArchive(pagesWithImages, safeTitle);
            const res = await saveBinary(`${safeTitle}.zip`, buf, [{ name: 'ZIP \u538b\u7f29\u5305', extensions: ['zip'] }]);
            if (res.status === 'saved') saved.push(res.path);
            if (res.status === 'cancelled') return;
        } else if (kind === 'pdf') {
            const buf = await buildPdfDocument(pagesWithImages);
            const res = await saveBinary(`${safeTitle}.pdf`, buf, [{ name: 'PDF \u6587\u6863', extensions: ['pdf'] }]);
            if (res.status === 'saved') saved.push(res.path);
            if (res.status === 'cancelled') return;
        } else {
            // \u957f\u56fe\uff1a\u6b63\u5e38\u5355\u6bb5\uff1b\u8d85 canvas \u4e0a\u9650\u81ea\u52a8\u5206\u6bb5\uff0c\u9010\u6bb5\u4fdd\u5b58
            const bufs = await buildLongImages(pagesWithImages);
            for (let i = 0; i < bufs.length; i++) {
                const name = bufs.length === 1 ? `${safeTitle}_\u957f\u56fe.jpg` : `${safeTitle}_\u957f\u56fe_${i + 1}.jpg`;
                const res = await saveBinary(name, bufs[i], [{ name: 'JPEG \u56fe\u50cf', extensions: ['jpg'] }]);
                if (res.status === 'saved') saved.push(res.path);
                if (res.status === 'cancelled') break; // \u53d6\u6d88\u5373\u505c\u6b62\u540e\u7eed\u6bb5
            }
        }
        if (saved.length > 0) {
            setExportedPath(saved[saved.length - 1]);
            notify(S.exportedTo(saved[saved.length - 1]));
        }
    } catch (error: any) {
        console.error("Export failed:", error);
        setGlobalError(S.exportFailed(trimErr(error?.message))); // \u5199\u76d8\u5931\u8d25\u4e0d\u518d\u9759\u9ed8
    } finally {
        setIsExporting(false);
    }
  };

  // --- RENDERING ---

  // 多工程管理：画廊开关、导出中标记；索引中 updatedAt 最新工程用于「继续上次创作」快捷卡
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [galleryExporting, setGalleryExporting] = useState(false);
  const latestProject = projects.length > 0
    ? [...projects].sort((a, b) => b.updatedAt - a.updatedAt)[0]
    : null;

  /** 打开工程（画廊卡片 / 继续上次创作）：hook 内会先 flush 当前工程再按 id 恢复 */
  const handleOpenProject = useCallback(async (id: string) => {
    setGalleryOpen(false);
    handleCancelAll();               // 停在途任务（旧工程状态由快照落盘保留）
    clearReferenceAttachmentCache(); // AI 参考图附件缓存属旧工程语境
    const ok = await openProject(id);
    if (!ok) return;
    setInputLog('');
    setOutputLog('');
    setReasoningLog('');
    setStreamPhase('');
    setExportedPath(null);
    setReaderIndex(null);
  }, [handleCancelAll, openProject]);

  /** 删除工程；若删的是当前激活工程，工作台一并重置到空 CONFIG（数据已随删除清除） */
  const handleDeleteProject = useCallback(async (id: string) => {
    const wasActive = await deleteProject(id);
    if (!wasActive) return;
    handleCancelAll();
    clearReferenceAttachmentCache();
    setComicScript(null);
    setCharacterSheet([]);
    setPropSheet([]);
    setSceneSheet([]);
    setPages([]);
    setInputLog('');
    setOutputLog('');
    setReasoningLog('');
    setStreamPhase('');
    setGlobalError(null);
    setExportedPath(null);
    setReaderIndex(null);
    setWorkflowStep(WorkflowStep.CONFIG);
    setGalleryOpen(false);
  }, [deleteProject, handleCancelAll]);

  /** 画廊内导出 ZIP：按 id 直接读快照与附件（不切换激活工程），走 exportService 现有 zip 导出 */
  const handleExportProject = useCallback(async (id: string) => {
    if (galleryExporting) return;
    setGalleryExporting(true);
    try {
      const saved = await loadProject(id);
      if (!isRestorableProject(saved)) {
        setGlobalError(S.projectOpenFailed);
        return;
      }
      const withImages = saved.pages.filter(p => p.hasImage);
      if (withImages.length === 0) {
        setGlobalError(S.galleryExportNoPages);
        return;
      }
      const pagesData: ComicPageData[] = [];
      for (const p of withImages) {
        // 附件 id 按工程前缀直接拼接（不切换命名空间）
        const img = await getImageAttachment(`p-${id}-page-${p.page_number}`);
        if (img) pagesData.push({ ...p, imageData: img, isGenerating: false } as ComicPageData);
      }
      if (pagesData.length === 0) {
        setGlobalError(S.galleryExportNoPages);
        return;
      }
      const entry = projects.find(e => e.id === id);
      const title = (entry?.title || saved.comicScript?.title || S.defaultComicFileName)
        .replace(/[^a-z0-9一-龥]/gi, '_').substring(0, 50);
      const buf = await buildZipArchive(pagesData, title);
      const res = await saveBinary(`${title}.zip`, buf, [{ name: 'ZIP 压缩包', extensions: ['zip'] }]);
      if (res.status === 'saved') {
        setExportedPath(res.path);
        notify(S.exportedTo(res.path));
      }
    } catch (error: any) {
      setGlobalError(S.exportFailed(trimErr(error?.message)));
    } finally {
      setGalleryExporting(false);
    }
  }, [galleryExporting, projects, notify, S]);

  // 视觉 token → 根节点 CSS 变量（theme.ui）；组件内品牌色经 var(--manga-*) 消费
  const themeCssVars = {
    '--manga-font-family': theme.ui.fontFamily,
    '--manga-heading-font': theme.ui.headingFontFamily ?? theme.ui.fontFamily,
    '--manga-accent': theme.ui.accent,
    '--manga-accent-secondary': theme.ui.accentSecondary,
    '--manga-cta-from': theme.ui.ctaFrom ?? theme.ui.accent,
    '--manga-cta-to': theme.ui.ctaTo ?? theme.ui.accentSecondary,
    '--manga-cta-hover-from': theme.ui.ctaHoverFrom ?? theme.ui.ctaFrom ?? theme.ui.accent,
    '--manga-cta-hover-to': theme.ui.ctaHoverTo ?? theme.ui.ctaTo ?? theme.ui.accentSecondary,
    '--manga-bg': theme.ui.background,
    '--manga-text': theme.ui.text,
    fontFamily: theme.ui.fontFamily,
    backgroundColor: theme.ui.background,
    color: theme.ui.text,
  } as React.CSSProperties;

  if (checkingMulby) {
     return (
        <div className="min-h-screen bg-[#0f172a] flex items-center justify-center" style={themeCssVars}>
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--manga-accent)]"></div>
        </div>
     );
  }

  if (!mulbyReady) {
     return (
      <div className="min-h-screen bg-[#0f172a] flex flex-col items-center justify-center p-6 text-center" style={themeCssVars}>
        <div className="max-w-md w-full bg-slate-800 p-8 rounded-2xl border border-slate-700 shadow-2xl space-y-6">
          <div className="w-16 h-16 bg-gradient-to-br from-[var(--manga-accent)] to-[var(--manga-accent-secondary)] rounded-2xl mx-auto flex items-center justify-center text-2xl font-bold text-white shadow-xl shadow-indigo-500/20">
            {S.brandMark}
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white mb-2 font-[var(--manga-heading-font)]">{S.appTitleSetup}</h1>
            <p className="text-slate-400 text-sm">
              未检测到 Mulby AI 接口。请通过 <b>Mulby</b> 启动本插件，并在 Mulby 设置 → AI 中配置至少一个文本模型和一个图像生成模型。
            </p>
          </div>
        </div>
      </div>
     );
  }

  return (
    <div className="min-h-screen bg-[#0f172a] text-slate-100 flex flex-col font-sans selection:bg-[var(--manga-accent)] selection:text-white" style={themeCssVars}>

      <header className="sticky top-0 z-50 bg-[#0f172a]/90 backdrop-blur border-b border-slate-800">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-3">
             {/* 返回上一步（仅分镜 / 绘制两步显示；剧本流式生成用右侧取消按钮回 CONFIG） */}
             {(workflowStep === WorkflowStep.STORYBOARDING || workflowStep === WorkflowStep.COMIC_GENERATION) && (
                 <button
                    onClick={handleGoBack}
                    className="flex items-center space-x-1 text-xs text-slate-400 hover:text-white transition-colors -ml-1 mr-1"
                    title={S.backButton}
                 >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7"/></svg>
                    <span>{S.backButton}</span>
                 </button>
             )}
             <div className="w-8 h-8 bg-gradient-to-br from-[var(--manga-accent)] to-[var(--manga-accent-secondary)] rounded-lg flex items-center justify-center font-bold text-white shadow-lg shadow-indigo-500/20">
               {S.brandMark}
             </div>
             <h1 className="text-xl font-bold tracking-tight text-white font-[var(--manga-heading-font)]">
               {S.brandTitleLead}<span className="text-indigo-400">{S.brandTitleAccent}</span>
             </h1>
          </div>
          
          <div className="flex items-center space-x-4">
             {/* 费用统计：页头内嵌紧凑胶囊，悬停展开明细（原 fixed 悬浮卡片会遮挡内容区按钮） */}
             <TokenMonitor usage={tokenUsage} />
             {workflowStep !== WorkflowStep.CONFIG && (
                 <button
                    onClick={handleStartOver}
                    className="text-xs text-slate-400 hover:text-white underline"
                 >
                    {S.startOver}
                 </button>
             )}
             {(isProcessing || workflowStep === WorkflowStep.STORYBOARDING || pages.some(p => p.isGenerating)) && (
                 <button
                    onClick={handleCancelAll}
                    className="flex items-center space-x-1.5 text-xs bg-red-900/60 hover:bg-red-800 text-red-200 px-3 py-1.5 rounded-full border border-red-700/60 transition-colors font-bold"
                    title={S.cancelAllTitle}
                 >
                    <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
                    <span>{S.cancelAll}</span>
                 </button>
             )}
          </div>
        </div>
      </header>

      <main className="flex-grow max-w-7xl mx-auto px-4 py-8 w-full space-y-8">
        
        {globalError && (
          <div className="mb-6 p-4 bg-red-900/50 border border-red-700 rounded-lg flex items-start space-x-3">
             <svg className="w-5 h-5 text-red-400 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
             <p className="text-red-200">{globalError}</p>
          </div>
        )}

        {/* 导出成功条幅（方案 5.5）：显示落盘路径 + 一键定位文件 */}
        {exportedPath && (
          <div className="mb-6 p-3 bg-emerald-900/40 border border-emerald-700/60 rounded-lg flex items-center justify-between gap-3">
             <p className="text-emerald-200 text-sm truncate min-w-0">{S.exportedTo(exportedPath)}</p>
             <div className="flex items-center space-x-2 shrink-0">
                <button
                   onClick={() => revealInFolder(exportedPath)}
                   className="text-xs bg-emerald-700/70 hover:bg-emerald-600 text-white px-3 py-1.5 rounded font-bold"
                >
                   {S.revealInFolder}
                </button>
                <button
                   onClick={() => setExportedPath(null)}
                   className="text-xs text-emerald-300/70 hover:text-white px-1"
                   title="关闭"
                >
                   ✕
                </button>
             </div>
          </div>
        )}

        {/* 多工程入口（CONFIG）：「我的工程」画廊 + 「继续上次创作」快捷卡（updatedAt 最新工程） */}
        {workflowStep === WorkflowStep.CONFIG && (
            <div className="flex flex-col md:flex-row gap-3 animate-fade-in">
                <button
                    onClick={() => setGalleryOpen(true)}
                    className="flex items-center justify-center space-x-2 bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-200 px-5 py-3 rounded-xl text-sm font-bold transition-colors shrink-0"
                >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"></path></svg>
                    <span>{S.myProjects}（{projects.length}）</span>
                </button>
                {latestProject && (
                    <button
                        onClick={() => void handleOpenProject(latestProject.id)}
                        disabled={isRestoring}
                        className="flex-grow p-4 bg-indigo-900/40 border border-indigo-600/50 rounded-xl flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-left hover:bg-indigo-900/60 disabled:opacity-60 transition-colors"
                    >
                        <span className="text-sm font-bold text-indigo-200 truncate">
                            {S.continueLastProject}：《{latestProject.title}》
                        </span>
                        <span className="text-xs text-indigo-300/80 shrink-0">
                            {S.galleryUpdatedAt(new Date(latestProject.updatedAt).toLocaleString())}
                            {` · ${S.projectPages(latestProject.donePages, latestProject.pageCount)}`}
                        </span>
                    </button>
                )}
            </div>
        )}

        {/* WORKFLOW STEP 1: CONFIG & SCRIPT */}
        {(workflowStep === WorkflowStep.CONFIG || workflowStep === WorkflowStep.SCRIPT_GENERATION) && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
            <div className="lg:col-span-4 sticky top-24">
                <ConfigPanel 
                    config={config} 
                    onChange={setConfig} 
                    onGenerate={handleGenerateScript} 
                    isLoading={isProcessing} 
                />
            </div>
            <div className="lg:col-span-8">
                <div className="h-[600px] sticky top-24">
                    <LogPanel inputLog={inputLog} outputLog={outputLog} reasoningLog={reasoningLog} phase={streamPhase} textModel={config.textModel} />
                </div>
            </div>
            </div>
        )}

        {/* WORKFLOW STEP 2: ASSET STUDIO (SCRIPT + ASSETS) */}
        {workflowStep === WorkflowStep.STORYBOARDING && comicScript && (
            <div className="flex flex-col h-[calc(100vh-8rem)] animate-fade-in-up">
                {/* Studio Tabs */}
                <div className="flex border-b border-slate-700 mb-6">
                    <button
                       onClick={() => setStoryboardTab('CHARACTERS')}
                       className={`px-6 py-3 text-sm font-bold border-b-2 transition-colors ${storyboardTab === 'CHARACTERS' ? 'border-indigo-500 text-white' : 'border-transparent text-slate-400 hover:text-slate-200'}`}
                    >
                       {S.studioTabAssets}
                    </button>
                    <button
                       onClick={() => setStoryboardTab('SCRIPT')}
                       className={`px-6 py-3 text-sm font-bold border-b-2 transition-colors ${storyboardTab === 'SCRIPT' ? 'border-indigo-500 text-white' : 'border-transparent text-slate-400 hover:text-slate-200'}`}
                    >
                       {S.studioTabScript}
                    </button>
                </div>

                <div className="flex-grow overflow-hidden relative">
                    {storyboardTab === 'CHARACTERS' && (
                         <div className="h-full overflow-y-auto pr-2 pb-12">
                            <CharacterGenerator
                                characters={characterSheet}
                                props={propSheet}
                                scenes={sceneSheet}
                                unmatchedCharacters={unmatchedCharNames}
                                onAddCharacter={handleAddCharacter}
                                style={effectiveStyle}
                                mainCharacterName={config.character.name}
                                storyMode={config.storyMode}
                                onUpdateCharacter={handleCharacterUpdate}
                                onUpdateProp={handlePropUpdate}
                                onUpdateScene={handleSceneUpdate}
                                onConfirm={() => setStoryboardTab('SCRIPT')}
                                onUsageCallback={(stat) => trackUsage('Asset Gen', stat)}
                            />
                        </div>
                    )}
                    {storyboardTab === 'SCRIPT' && (
                        <ScriptEditor
                            script={comicScript}
                            characterSheet={characterSheet}
                            propSheet={propSheet}
                            sceneSheet={sceneSheet}
                            onUpdate={handleScriptUpdate}
                            onContinue={handleStartComicGeneration}
                            onUsage={trackUsage}
                            onRevise={handleReviseScript}
                            isRevising={isProcessing}
                        />
                    )}
                </div>
            </div>
        )}

        {/* WORKFLOW STEP 3: COMIC PAGES */}
        {workflowStep === WorkflowStep.COMIC_GENERATION && (
            <div className="pt-8 border-t border-slate-800 min-h-[400px]">
             
                <div className="flex items-center justify-between mb-8">
                    <div className="flex items-center space-x-3">
                    <h2 className="text-2xl font-bold text-white font-[var(--manga-heading-font)]">{S.comicPagesTitle}</h2>
                    {pages.length > 0 && (
                        <span className="text-xs text-indigo-300 bg-indigo-900/30 px-2 py-1 rounded border border-indigo-500/30">
                            {S.pagesBadge(config.aspectRatio, pages.length)}
                        </span>
                    )}
                    {/* 方案 5.3：总进度实时推进 */}
                    {pages.length > 0 && (
                        <span className="text-xs text-emerald-300 bg-emerald-900/30 px-2 py-1 rounded border border-emerald-500/30">
                            {S.progressBadge(pages.filter(p => !!p.imageData).length, pages.length)}
                        </span>
                    )}
                    </div>

                    <div className="flex items-center space-x-3">
                    {unfinishedPages.length > 0 && (
                    <button
                        onClick={handleResumeAll}
                        className="flex items-center space-x-2 bg-amber-700/80 hover:bg-amber-600 text-white px-5 py-2.5 rounded-lg border border-amber-500/40 transition-all text-sm font-bold shadow-lg shadow-amber-500/10"
                        title={S.resumeAllTitle}
                    >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>
                        <span>{S.resumeAll(unfinishedPages.length)}</span>
                    </button>
                    )}
                    {/* 方案 5.6：导出入口改下拉——ZIP 散图 / PDF / 竖向长图 */}
                    {pages.some(p => p.imageData) && (
                    <div className="relative">
                        <button
                            onClick={() => setExportMenuOpen(v => !v)}
                            disabled={isExporting}
                            className="flex items-center space-x-2 bg-gradient-to-r from-[var(--manga-cta-from)] to-[var(--manga-cta-to)] hover:from-[var(--manga-cta-hover-from)] hover:to-[var(--manga-cta-hover-to)] disabled:from-slate-700 disabled:to-slate-700 disabled:text-slate-400 text-white px-5 py-2.5 rounded-lg border border-white/10 transition-all text-sm font-bold shadow-lg shadow-indigo-500/20"
                        >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
                            <span>{isExporting ? S.exporting : S.exportBtn}</span>
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                        </button>
                        {exportMenuOpen && !isExporting && (
                            <div className="absolute right-0 mt-2 w-44 bg-slate-800 border border-slate-600 rounded-lg shadow-2xl z-30 overflow-hidden">
                                <button onClick={() => handleExport('zip')} className="w-full text-left px-4 py-2.5 text-sm text-slate-200 hover:bg-indigo-600 hover:text-white transition-colors">{S.exportZip}</button>
                                <button onClick={() => handleExport('pdf')} className="w-full text-left px-4 py-2.5 text-sm text-slate-200 hover:bg-indigo-600 hover:text-white transition-colors">{S.exportPdf}</button>
                                <button onClick={() => handleExport('long')} className="w-full text-left px-4 py-2.5 text-sm text-slate-200 hover:bg-indigo-600 hover:text-white transition-colors">{S.exportLong}</button>
                            </div>
                        )}
                    </div>
                    )}
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-12 animate-fade-in-up pb-12">
                    {pages.map((page, idx) => (
                        <PanelCard
                        key={page.page_number}
                        index={idx}
                        page={page}
                        config={config}
                        characterSheet={characterSheet}
                        propSheet={propSheet}
                        sceneSheet={sceneSheet}
                        onRegenerate={handleRegeneratePage}
                        onUsage={trackUsage}
                        onUpdateWatermark={theme.features.watermark ? handlePageWatermarkUpdate : undefined}
                        onOpenReader={(pageNumber) => {
                            const readable = pages.filter(p => p.imageData);
                            const i = readable.findIndex(p => p.page_number === pageNumber);
                            if (i >= 0) setReaderIndex(i);
                        }}
                        />
                    ))}
                </div>
            </div>
        )}
      </main>

      {/* 全屏阅读模式（方案 5.6） */}
      {readerIndex != null && (
        <ReaderOverlay
            pages={pages.filter(p => p.imageData)}
            index={readerIndex}
            onNavigate={setReaderIndex}
            onClose={() => setReaderIndex(null)}
        />
      )}

      {/* 工程画廊（多工程管理） */}
      {galleryOpen && (
        <ProjectGallery
            projects={projects}
            busy={isRestoring}
            exporting={galleryExporting}
            onOpen={(id) => void handleOpenProject(id)}
            onRename={(id, title) => void renameProject(id, title)}
            onDelete={(id) => void handleDeleteProject(id)}
            onExport={(id) => void handleExportProject(id)}
            onClose={() => setGalleryOpen(false)}
        />
      )}
      
      <style>{`
        @keyframes loading-bar {
          0% { width: 0%; margin-left: 0; }
          50% { width: 100%; margin-left: 0; }
          100% { width: 0%; margin-left: 100%; }
        }
        .animate-loading-bar {
          animation: loading-bar 1.5s infinite ease-in-out;
        }
        .animate-fade-in {
            animation: fadeIn 0.5s ease-out forwards;
        }
        .animate-fade-in-up {
          animation: fadeInUp 0.5s ease-out forwards;
        }
        @keyframes fadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
        }
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .scrollbar-thin::-webkit-scrollbar {
          width: 6px;
        }
        .scrollbar-thin::-webkit-scrollbar-track {
          background: transparent; 
        }
        .scrollbar-thin::-webkit-scrollbar-thumb {
          background: #334155; 
          border-radius: 3px;
        }
        .scrollbar-thin::-webkit-scrollbar-thumb:hover {
          background: #475569; 
        }
      `}</style>
    </div>
  );
};

export default MangaApp;

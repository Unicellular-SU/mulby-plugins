
import React, { useState, useCallback, useEffect, useRef } from 'react';
import ConfigPanel from './components/ConfigPanel';
import PanelCard from './components/PanelCard';
import LogPanel from './components/LogPanel';
import CharacterGenerator from './components/CharacterGenerator';
import ScriptEditor from './components/ScriptEditor';
import TokenMonitor from './components/TokenMonitor';
import { generateComicScript, setActiveModels, getAbortEpoch, isStale, clearReferenceAttachmentCache } from './services/mulbyAiService';
import { useUsageTracker, INITIAL_USAGE } from './hooks/useUsageTracker';
import { useImageQueue } from './hooks/useImageQueue';
import { useComicWorkflow } from './hooks/useComicWorkflow';
import { saveBinary, buildZipArchive, buildPdfDocument, buildLongImages, revealInFolder } from './services/exportService';
import ReaderOverlay from './components/ReaderOverlay';
import { attIdForChar, attIdForProp } from './services/persistenceService';
import { useSessionPersistence } from './hooks/useSessionPersistence';
import { getCharacterReference, buildCoverPage, prepareScenePages, resolvePageRefs } from './utils/promptBuilder';
import { AppConfig, ComicPageData, ComicStyle, AspectRatio, StoryMode, WorkflowStep, CharacterSheetItem, PropSheetItem, ComicResponse } from './types';
import { PRESET_CHARACTERS } from './constants';
import { S, trimErr } from './strings';

// Initial Config State
const INITIAL_CONFIG: AppConfig = {
  sourceText: '',
  style: ComicStyle.MANGA_BW,
  character: PRESET_CHARACTERS[0],
  storyMode: StoryMode.CONFLICT,
  customStoryPrompt: '',
  panelCount: 0,
  aspectRatio: AspectRatio.MANGA_PAGE,
  totalPages: 'Short', // Default to short
};

// 方案 5.7：onPluginInit 缓冲重放 / React StrictMode 双挂载去重表——
// 必须放模块级（组件外），effect 内闭包在重挂载时重置，挡不住缓冲重放
const lastInitNonce = { v: -1 as number | string };

const App: React.FC = () => {
  const [config, setConfig] = useState<AppConfig>(INITIAL_CONFIG);
  // Data State
  const [comicScript, setComicScript] = useState<ComicResponse | null>(null);
  const [characterSheet, setCharacterSheet] = useState<CharacterSheetItem[]>([]);
  const [propSheet, setPropSheet] = useState<PropSheetItem[]>([]);
  const [pages, setPages] = useState<ComicPageData[]>([]);
  
  // Storyboarding Phase State
  const [storyboardTab, setStoryboardTab] = useState<'SCRIPT' | 'CHARACTERS'>('CHARACTERS');

  // Log States
  const [inputLog, setInputLog] = useState<string>('');
  const [outputLog, setOutputLog] = useState<string>('');

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
    handlePermissionError,
  } = useComicWorkflow({ setPages, batchRef });

  // 方案 5.7：onPluginInit 回调闭包只建一次，经 ref 读取当前工作流位置
  const workflowStepRef = useRef(workflowStep);
  useEffect(() => { workflowStepRef.current = workflowStep; }, [workflowStep]);

  // 会话持久化（方案 3.1/3.2 接线收敛进 hooks/useSessionPersistence，7.4 收尾）：
  // 启动读回 + config 防抖写回 + 快照防抖落盘 + 三通道兜底 flush + 恢复/放弃
  const {
    pendingSession,
    isRestoring,
    persistReferenceImage,
    beginNewSession,
    discardSessionData,
    handleRestoreSession,
    handleDiscardSession,
  } = useSessionPersistence({
    mulbyReady,
    config, setConfig,
    workflowStep, setWorkflowStep,
    storyboardTab, setStoryboardTab,
    comicScript, setComicScript,
    characterSheet, setCharacterSheet,
    propSheet, setPropSheet,
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
    setPages([]);
    setInputLog('');
    setOutputLog('');
    setGlobalError(null);
    setExportedPath(null);
    setReaderIndex(null);
    setWorkflowStep(WorkflowStep.CONFIG);
    // 确认丢弃即同步清理持久化会话（session 键 + 附件；config 保留）——
    // 第 2 章把 Start Over 改成了「确认 + 真正重置」，保留持久化会跟"不可恢复"的确认语义冲突
    discardSessionData();
  }, [handleCancelAll, discardSessionData]);

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

  // 图像生成队列（方案 7.4 步骤 2：triggerImageGeneration / 批量调度收敛进 hooks/useImageQueue）
  const { triggerImageGeneration, runBatch } = useImageQueue({
    pages,
    setPages,
    batchRef,
    trackUsage,
    handlePermissionError,
    notify,
  });

  // STEP 1: Generate Script
  const handleGenerateScript = async () => {
    handleCancelAll();                  // D2：终止上一轮（bump epoch + 清定时器 + 关 isProcessing）
    const runEpoch = getAbortEpoch();   // D1：捕获本轮代际，迟到回调据此丢弃

    setGlobalError(null);
    setIsProcessing(true);
    setInputLog('');
    setOutputLog('');
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
        (type, text) => {
             if (type === 'INPUT') setInputLog(text);
             if (type === 'OUTPUT') setOutputLog(text);
        },
        (stat) => trackUsage('Generate Script', stat)
      );
      if (isStale(runEpoch)) return;    // 本轮已被中止/替代：不写回任何状态

      // 新剧本生成成功 = 唯一确立"新会话"的时刻（方案 3.1 步骤 6）：
      // 清旧会话附件；session 键由快照 effect 在迁移到 STORYBOARDING 时立即覆盖写入。
      beginNewSession();
      clearReferenceAttachmentCache(); // D3：旧剧本的参考图上传缓存与 AI 附件一并清理（方案 4.1）

      setComicScript(comicData);
      setCharacterSheet(comicData.character_sheet || []);
      setPropSheet(comicData.prop_sheet || []);
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
  
  // Handle updates from ScriptEditor
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

  // STEP 3: Start Comic Generation (Images)
  const handleStartComicGeneration = async () => {
      if (!comicScript) return;
      
      setWorkflowStep(WorkflowStep.COMIC_GENERATION);

      // Cover Page + PRE-CALCULATE PAGES（方案 7.4 步骤 3：拼装逻辑移至 utils/promptBuilder，逐字节等价）
      const mainCharRef = getCharacterReference(config.character.name, characterSheet);
      const coverCharacters = mainCharRef ? [config.character.name] : [];
      const coverPage = buildCoverPage(comicScript, config.style, coverCharacters);
      const preparedPages = prepareScenePages(comicScript, config.style, characterSheet, propSheet);

      const allPages = [coverPage, ...preparedPages.map(p => p.pageData)];
      setPages(allPages);

      // 方案 4.2（D4）：asyncPool(limit=2) 替代 setTimeout 错峰——任意时刻在途图像请求 ≤2，
      // 中止时池在取下一个任务前发现纪元已变即停止；未启动页保持 isGenerating: true，
      // 由 handleCancelAll 的"已被用户中止"标记统一覆盖。
      const coverRefs = mainCharRef ? [mainCharRef] : undefined;
      const jobs = [
        { page: coverPage, refs: coverRefs },
        ...preparedPages.map((p) => ({ page: p.pageData, refs: p.resolvedRefs as string[] | undefined })),
      ];

      // 方案 5.1：批次收尾通知挂在池全部 settle 之后（runBatch 内一次性标志 + epoch 双保险防噪）
      await runBatch(jobs, config.aspectRatio, comicScript.title);
  };

  const handleRegeneratePage = useCallback((pageNumber: number, newPrompt: string, newCharactersInScene?: string[], newPropsInScene?: string[]) => {
      const page = pages.find(p => p.page_number === pageNumber);
      if (!page) return;

      const activeCharacterNames = newCharactersInScene || page.characters_in_scene || [];
      const activePropNames = newPropsInScene || page.props_in_scene || [];

      const { refs: sceneRefs, finalPrompt: finalPromptToUse } =
          resolvePageRefs(newPrompt, activeCharacterNames, activePropNames, characterSheet, propSheet);

      setPages(prev => prev.map(p =>
        p.page_number === pageNumber
        ? {
            ...p,
            image_prompt: finalPromptToUse,
            characters_in_scene: activeCharacterNames,
            props_in_scene: activePropNames,
            isGenerating: true,
            error: undefined
          }
        : p
      ));

      triggerImageGeneration(
          { ...page, image_prompt: finalPromptToUse, characters_in_scene: activeCharacterNames, props_in_scene: activePropNames },
          config.aspectRatio,
          sceneRefs
      );

  }, [config.aspectRatio, pages, characterSheet, propSheet, triggerImageGeneration]);

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
          refs: resolvePageRefs(p.image_prompt, p.characters_in_scene || [], p.props_in_scene || [], characterSheet, propSheet).refs,
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

    const comicTitle = pages[0]?.title || "TechManga_Comic";
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

  if (checkingMulby) {
     return (
        <div className="min-h-screen bg-[#0f172a] flex items-center justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500"></div>
        </div>
     );
  }

  if (!mulbyReady) {
     return (
      <div className="min-h-screen bg-[#0f172a] flex flex-col items-center justify-center p-6 text-center">
        <div className="max-w-md w-full bg-slate-800 p-8 rounded-2xl border border-slate-700 shadow-2xl space-y-6">
          <div className="w-16 h-16 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl mx-auto flex items-center justify-center text-2xl font-bold text-white shadow-xl shadow-indigo-500/20">
            TM
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white mb-2">{S.appTitleSetup}</h1>
            <p className="text-slate-400 text-sm">
              未检测到 Mulby AI 接口。请通过 <b>Mulby</b> 启动本插件，并在 Mulby 设置 → AI 中配置至少一个文本模型和一个图像生成模型。
            </p>
          </div>
        </div>
      </div>
     );
  }

  return (
    <div className="min-h-screen bg-[#0f172a] text-slate-100 flex flex-col font-sans selection:bg-indigo-500 selection:text-white">
      
      <TokenMonitor usage={tokenUsage} />

      <header className="sticky top-0 z-50 bg-[#0f172a]/90 backdrop-blur border-b border-slate-800">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-3">
             <div className="w-8 h-8 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-lg flex items-center justify-center font-bold text-white shadow-lg shadow-indigo-500/20">
               TM
             </div>
             <h1 className="text-xl font-bold tracking-tight text-white">
               Tech<span className="text-indigo-400">Manga</span>
             </h1>
          </div>
          
          <div className="flex items-center space-x-4">
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

        {/* 恢复上次创作条幅（方案 3.1 步骤 5.2）：不自动跳转，由用户决定恢复或放弃 */}
        {workflowStep === WorkflowStep.CONFIG && pendingSession && (
            <div className="p-4 bg-indigo-900/40 border border-indigo-600/50 rounded-lg flex flex-col md:flex-row md:items-center md:justify-between gap-3 animate-fade-in">
                <div className="min-w-0">
                    <p className="text-sm font-bold text-indigo-200 truncate">
                        检测到未完成的创作：《{pendingSession.comicScript?.title || '未命名'}》
                    </p>
                    <p className="text-xs text-indigo-300/80 mt-1">
                        保存于 {new Date(pendingSession.savedAt).toLocaleString()}
                        {pendingSession.pages.length > 0
                            ? ` · 已完成 ${pendingSession.pages.filter(p => p.hasImage).length}/${pendingSession.pages.length} 页`
                            : ' · 尚未开始绘制页面'}
                    </p>
                </div>
                <div className="flex items-center space-x-2 shrink-0">
                    <button
                        onClick={handleRestoreSession}
                        disabled={isRestoring}
                        className="text-xs bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 disabled:text-slate-400 text-white px-4 py-2 rounded-lg font-bold transition-colors"
                    >
                        {isRestoring ? '正在恢复…' : '恢复上次创作'}
                    </button>
                    <button
                        onClick={handleDiscardSession}
                        disabled={isRestoring}
                        className="text-xs bg-slate-700/60 hover:bg-slate-700 disabled:opacity-50 text-slate-300 px-4 py-2 rounded-lg font-bold transition-colors"
                    >
                        放弃
                    </button>
                </div>
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
                    <LogPanel inputLog={inputLog} outputLog={outputLog} textModel={config.textModel} />
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
                       1. 资产工作室（角色与道具）
                    </button>
                    <button
                       onClick={() => setStoryboardTab('SCRIPT')}
                       className={`px-6 py-3 text-sm font-bold border-b-2 transition-colors ${storyboardTab === 'SCRIPT' ? 'border-indigo-500 text-white' : 'border-transparent text-slate-400 hover:text-slate-200'}`}
                    >
                       2. 剧本与分镜
                    </button>
                </div>

                <div className="flex-grow overflow-hidden relative">
                    {storyboardTab === 'CHARACTERS' && (
                         <div className="h-full overflow-y-auto pr-2 pb-12">
                            <CharacterGenerator 
                                characters={characterSheet}
                                props={propSheet}
                                style={config.style}
                                mainCharacterName={config.character.name}
                                storyMode={config.storyMode}
                                onUpdateCharacter={handleCharacterUpdate}
                                onUpdateProp={handlePropUpdate}
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
                            onUpdate={handleScriptUpdate}
                            onContinue={handleStartComicGeneration}
                            onUsage={trackUsage}
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
                    <h2 className="text-2xl font-bold text-white">{S.comicPagesTitle}</h2>
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
                            className="flex items-center space-x-2 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 disabled:from-slate-700 disabled:to-slate-700 disabled:text-slate-400 text-white px-5 py-2.5 rounded-lg border border-white/10 transition-all text-sm font-bold shadow-lg shadow-indigo-500/20"
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
                        onRegenerate={handleRegeneratePage}
                        onUsage={trackUsage}
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

export default App;

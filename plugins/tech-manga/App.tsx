
import React, { useState, useCallback, useEffect, useRef } from 'react';
import ConfigPanel from './components/ConfigPanel';
import PanelCard from './components/PanelCard';
import LogPanel from './components/LogPanel';
import CharacterGenerator from './components/CharacterGenerator';
import ScriptEditor from './components/ScriptEditor';
import TokenMonitor from './components/TokenMonitor';
import { generateComicScript, generatePanelImage, refineImagePrompt, refineText, setActiveModels, abortAllAiTasks } from './services/mulbyAiService';
import { AppConfig, ComicPageData, ComicStyle, AspectRatio, StoryMode, WorkflowStep, CharacterSheetItem, PropSheetItem, ComicResponse, TokenUsage, UsageStat } from './types';
import { PRESET_CHARACTERS } from './constants';
import JSZip from 'jszip';

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

const INITIAL_USAGE: TokenUsage = {
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalImages: 0,
    estimatedCost: 0,
    breakdown: {
      gemini3ProCost: 0,
      gemini3ProImageCost: 0,
      gemini25FlashImageCost: 0
    },
    history: []
};

const App: React.FC = () => {
  const [config, setConfig] = useState<AppConfig>(INITIAL_CONFIG);
  const [workflowStep, setWorkflowStep] = useState<WorkflowStep>(WorkflowStep.CONFIG);
  
  // Data State
  const [comicScript, setComicScript] = useState<ComicResponse | null>(null);
  const [characterSheet, setCharacterSheet] = useState<CharacterSheetItem[]>([]);
  const [propSheet, setPropSheet] = useState<PropSheetItem[]>([]);
  const [pages, setPages] = useState<ComicPageData[]>([]);
  
  // Storyboarding Phase State
  const [storyboardTab, setStoryboardTab] = useState<'SCRIPT' | 'CHARACTERS'>('CHARACTERS');

  const [isProcessing, setIsProcessing] = useState(false);
  
  // Log States
  const [inputLog, setInputLog] = useState<string>('');
  const [outputLog, setOutputLog] = useState<string>('');
  
  const [globalError, setGlobalError] = useState<string | null>(null);

  // Token Usage State
  const [tokenUsage, setTokenUsage] = useState<TokenUsage>(INITIAL_USAGE);

  // Mulby AI 可用性检查（替代原 AI Studio API Key 检查）
  const [mulbyReady, setMulbyReady] = useState(false);
  const [checkingMulby, setCheckingMulby] = useState(true);

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

  // 排队中的逐页生成定时器（中止时需要清掉）
  const pendingTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  // 一键中止：杀掉文本流请求、作废在途图像结果、清空排队任务
  const handleCancelAll = useCallback(() => {
    abortAllAiTasks();
    pendingTimersRef.current.forEach(clearTimeout);
    pendingTimersRef.current = [];
    setIsProcessing(false);
    setPages(prev => prev.map(p =>
      p.isGenerating ? { ...p, isGenerating: false, error: "已被用户中止（可单独重绘）" } : p
    ));
  }, []);

  const handlePermissionError = (error: any) => {
    const msg = error.message || JSON.stringify(error);
    if (msg.includes("403") || msg.includes("PERMISSION_DENIED") || msg.includes("permission") || msg.includes("Unauthorized") || msg.includes("401")) {
       setGlobalError("模型调用被拒绝（鉴权失败）。请到 Mulby 设置 → AI 中检查所选模型的 Provider 与 API Key 配置。");
       return true;
    }
    return false;
  };

  const trackUsage = useCallback((action: string, stat: UsageStat) => {
     setTokenUsage(prev => {
        let additionalCost = 0;
        let gemini3ProCostDelta = 0;
        let gemini3ProImageCostDelta = 0;
        let gemini25FlashImageCostDelta = 0;
        
        if (stat.modelType === 'GEMINI_3_PRO') {
            const inputRate = stat.inputTokens > 200000 ? 4.00 : 2.00;
            const inputCost = (stat.inputTokens / 1_000_000) * inputRate;
            const outputRate = stat.outputTokens > 200000 ? 18.00 : 12.00;
            const outputCost = (stat.outputTokens / 1_000_000) * outputRate;
            gemini3ProCostDelta = inputCost + outputCost;
            additionalCost += gemini3ProCostDelta;

        } else if (stat.modelType === 'GEMINI_3_PRO_IMAGE') {
            const inputCost = (stat.inputTokens / 1_000_000) * 2.00;
            const outputCost = (stat.outputTokens / 1_000_000) * 120.00;
            gemini3ProImageCostDelta = inputCost + outputCost;
            additionalCost += gemini3ProImageCostDelta;

        } else if (stat.modelType === 'GEMINI_2_5_FLASH_IMAGE') {
            const inputCost = (stat.inputTokens / 1_000_000) * 0.30;
            const outputCost = (stat.outputTokens / 1_000_000) * 30.00;
            gemini25FlashImageCostDelta = inputCost + outputCost;
            additionalCost += gemini25FlashImageCostDelta;
        }

        return {
            totalInputTokens: prev.totalInputTokens + stat.inputTokens,
            totalOutputTokens: prev.totalOutputTokens + stat.outputTokens,
            totalImages: prev.totalImages + stat.imagesGenerated,
            estimatedCost: prev.estimatedCost + additionalCost,
            breakdown: {
                gemini3ProCost: prev.breakdown.gemini3ProCost + gemini3ProCostDelta,
                gemini3ProImageCost: prev.breakdown.gemini3ProImageCost + gemini3ProImageCostDelta,
                gemini25FlashImageCost: prev.breakdown.gemini25FlashImageCost + gemini25FlashImageCostDelta,
            },
            history: [...prev.history, { 
                action, 
                stat, 
                cost: additionalCost,
                timestamp: Date.now() 
            }]
        };
     });
  }, []);

  // Helper to find character reference image with fuzzy matching
  const getCharacterReference = useCallback((name: string, sheet: CharacterSheetItem[]): string | undefined => {
     if (!sheet || sheet.length === 0) return undefined;
     const target = name.toLowerCase().trim();
     let match = sheet.find(c => c.name.toLowerCase().trim() === target);
     if (match?.referenceImage) return match.referenceImage;
     match = sheet.find(c => {
         const sheetName = c.name.toLowerCase().trim();
         return sheetName.includes(target) || target.includes(sheetName);
     });
     return match?.referenceImage;
  }, []);

  // STEP 1: Generate Script
  const handleGenerateScript = async () => {
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
      
      setComicScript(comicData);
      setCharacterSheet(comicData.character_sheet || []);
      setPropSheet(comicData.prop_sheet || []);
      setWorkflowStep(WorkflowStep.STORYBOARDING); 
      setStoryboardTab('CHARACTERS'); 

    } catch (error: any) {
      if (error?.name === 'AbortError') {
         // 用户主动中止：静默回到配置页
         setWorkflowStep(WorkflowStep.CONFIG);
      } else if (!handlePermissionError(error)) {
         setGlobalError(error.message || "Failed to generate comic script. Please try again.");
         setWorkflowStep(WorkflowStep.CONFIG);
      }
    } finally {
      setIsProcessing(false);
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
  }, []);

  const handlePropUpdate = useCallback((index: number, updatedProp: PropSheetItem) => {
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
 }, []);

  // STEP 3: Start Comic Generation (Images)
  const handleStartComicGeneration = async () => {
      if (!comicScript) return;
      
      setWorkflowStep(WorkflowStep.COMIC_GENERATION);
      
      // Cover Page
      const coverPrompt = `Art Style: ${config.style} (Master Style). ${comicScript.cover_image_prompt}. Text in image must be Simplified Chinese: "${comicScript.title}". Masterpiece, Title Page.`;
      const mainCharRef = getCharacterReference(config.character.name, characterSheet);
      const coverCharacters = mainCharRef ? [config.character.name] : [];

      const coverPage: ComicPageData = {
        page_number: 0,
        layout_description: "Cover Art",
        title: comicScript.title,
        image_prompt: coverPrompt,
        characters_in_scene: coverCharacters, 
        props_in_scene: [],
        isGenerating: true,
        persistent_states: { characters: [], environment: { lighting: 'default', notable_changes: [] } },
        state_changes_this_page: []
      };

      // PRE-CALCULATE PAGES
      const preparedPages = comicScript.pages.map(s => {
          const presentCharacters = s.characters_in_scene || [];
          const presentProps = s.props_in_scene || [];
          
          const sceneRefs: string[] = [];
          const characterContexts: string[] = [];

          // 1. Resolve Characters
          presentCharacters.forEach(name => {
              const charItem = characterSheet.find(c => c.name === name) 
                            || characterSheet.find(c => c.name.includes(name) || name.includes(c.name));
              
              if (charItem) {
                  if (charItem.referenceImage) {
                      sceneRefs.push(charItem.referenceImage);
                  }
                  
                  const charState = s.persistent_states?.characters?.find(c => c.name === name || c.name === charItem.name);
                  let stateDescription = "";
                  if (charState?.state) {
                      const appearance = charState.state.appearance_changes?.join(", ");
                      const injuries = charState.state.injuries?.join(", ");
                      const states = [appearance, injuries].filter(x => x).join(", ");
                      if (states) stateDescription = `[ACTION STATE OVERRIDE: ${states}]`;
                  }
                  
                  characterContexts.push(`Identity: ${charItem.name} (Canonical Character). ${stateDescription}`);
              }
          });

          // 2. Resolve Props
          presentProps.forEach(name => {
              const propItem = propSheet.find(p => p.name === name) 
                            || propSheet.find(p => p.name.includes(name) || name.includes(p.name));
              if (propItem) {
                  if (propItem.referenceImage) {
                      sceneRefs.push(propItem.referenceImage);
                  }
                  characterContexts.push(`Prop: ${propItem.name} (Visual Reference Provided).`);
              }
          });

          const finalPrompt = `
            Art Style: ${config.style} (Master Style). ${comicScript.global_art_style} (Style Description).
            
            ACTIVE CHARACTERS & PROPS CONTEXT (STRICTLY use Reference Images for visual details/clothing):
            ${characterContexts.length > 0 ? characterContexts.join("\n") : "No specific characters or props."}

            SCENE DESCRIPTION:
            ${s.image_prompt}
          `.trim();

          return {
              pageData: {
                  ...s,
                  image_prompt: finalPrompt,
                  isGenerating: true
              } as ComicPageData,
              resolvedRefs: sceneRefs
          };
      });

      const allPages = [coverPage, ...preparedPages.map(p => p.pageData)];
      setPages(allPages);

      const coverRefs = mainCharRef ? [mainCharRef] : undefined;
      pendingTimersRef.current = [];
      triggerImageGeneration(coverPage, config.aspectRatio, coverRefs);

      preparedPages.forEach((item, idx) => {
         const timer = setTimeout(() => {
            pendingTimersRef.current = pendingTimersRef.current.filter(t => t !== timer);
            triggerImageGeneration(item.pageData, config.aspectRatio, item.resolvedRefs);
         }, (idx + 1) * 1200);
         pendingTimersRef.current.push(timer);
      });
  };

  const triggerImageGeneration = async (page: ComicPageData, ratio: string, references?: string[]) => {
    try {
        const base64Image = await generatePanelImage(
            page.image_prompt, 
            ratio, 
            references,
            (stat) => trackUsage(`Draw Page ${page.page_number}`, stat)
        );
        
        setPages(prev => prev.map(p => 
            p.page_number === page.page_number 
            ? { ...p, imageData: base64Image, isGenerating: false, error: undefined } 
            : p
        ));
    } catch (error: any) {
        if (error?.name === 'AbortError') {
           setPages(prev => prev.map(p =>
               p.page_number === page.page_number
               ? { ...p, isGenerating: false, error: "已被用户中止（可单独重绘）" }
               : p
           ));
           return;
        }
        if (handlePermissionError(error)) {
           return;
        }
        setPages(prev => prev.map(p =>
            p.page_number === page.page_number
            ? { ...p, isGenerating: false, error: "Image generation failed." }
            : p
        ));
    }
  };

  const handleRegeneratePage = useCallback((pageNumber: number, newPrompt: string, newCharactersInScene?: string[], newPropsInScene?: string[]) => {
      const page = pages.find(p => p.page_number === pageNumber);
      if (!page) return;

      const activeCharacterNames = newCharactersInScene || page.characters_in_scene || [];
      const activePropNames = newPropsInScene || page.props_in_scene || [];
      
      const sceneRefs: string[] = [];
      const characterContexts: string[] = [];

      // Resolve Characters
      activeCharacterNames.forEach(name => {
          const charItem = characterSheet.find(c => c.name === name) 
                        || characterSheet.find(c => c.name.includes(name) || name.includes(c.name));
          if (charItem) {
              if (charItem.referenceImage) {
                  sceneRefs.push(charItem.referenceImage);
              }
              characterContexts.push(`Identity: ${charItem.name} (Canonical Character).`);
          }
      });

      // Resolve Props
      activePropNames.forEach(name => {
          const propItem = propSheet.find(p => p.name === name) 
                        || propSheet.find(p => p.name.includes(name) || name.includes(p.name));
          if (propItem) {
              if (propItem.referenceImage) {
                  sceneRefs.push(propItem.referenceImage);
              }
              characterContexts.push(`Prop: ${propItem.name} (Visual Reference Provided).`);
          }
      });

      let finalPromptToUse = newPrompt;
      if (newPrompt.includes("ACTIVE CHARACTERS & PROPS CONTEXT") || newPrompt.includes("ACTIVE CHARACTERS CONTEXT")) {
          // Replace legacy context block if present, or new block
          const contextStart = newPrompt.indexOf("ACTIVE CHARACTERS");
          const contextEnd = newPrompt.indexOf("SCENE DESCRIPTION");
          if (contextStart > -1 && contextEnd > -1) {
              const newContextBlock = `ACTIVE CHARACTERS & PROPS CONTEXT (STRICTLY use Reference Images for visual details/clothing):\n${characterContexts.length > 0 ? characterContexts.join("\n") : "No specific characters or props."}\n\n`;
              finalPromptToUse = newPrompt.substring(0, contextStart) + newContextBlock + newPrompt.substring(contextEnd);
          }
      } else {
         // Fallback if structure is messed up: append context at top if it doesn't exist? 
         // For now, if user edited it heavily, we trust their text, but update Refs.
      }

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

  const handleDownloadAll = async () => {
    const pagesWithImages = pages.filter(p => p.imageData);
    if (pagesWithImages.length === 0) return;

    try {
        const zip = new JSZip();
        const comicTitle = pages[0]?.title || "TechManga_Comic";
        const safeTitle = comicTitle.replace(/[^a-z0-9\u4e00-\u9fa5]/gi, '_').substring(0, 50);

        pagesWithImages.forEach((page) => {
            const dataUri = page.imageData!;
            const base64Data = dataUri.split(',')[1];
            const extension = dataUri.substring(dataUri.indexOf('/') + 1, dataUri.indexOf(';'));
            
            let fileName = '';
            if (page.page_number === 0) {
                fileName = `00_Cover_${safeTitle}.${extension}`;
            } else {
                const padNum = page.page_number.toString().padStart(2, '0');
                fileName = `${padNum}_Page_${page.page_number}.${extension}`;
            }

            zip.file(fileName, base64Data, { base64: true });
        });

        const content = await zip.generateAsync({ type: 'blob' });
        
        const link = document.createElement('a');
        link.href = URL.createObjectURL(content);
        link.download = `${safeTitle}.zip`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(link.href);

    } catch (error) {
        console.error("Failed to zip images:", error);
        setGlobalError("Failed to create download package.");
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
            <h1 className="text-2xl font-bold text-white mb-2">Setup Required</h1>
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
                    onClick={() => setWorkflowStep(WorkflowStep.CONFIG)}
                    className="text-xs text-slate-400 hover:text-white underline"
                 >
                    Start Over
                 </button>
             )}
             {(isProcessing || workflowStep === WorkflowStep.STORYBOARDING || pages.some(p => p.isGenerating)) && (
                 <button
                    onClick={handleCancelAll}
                    className="flex items-center space-x-1.5 text-xs bg-red-900/60 hover:bg-red-800 text-red-200 px-3 py-1.5 rounded-full border border-red-700/60 transition-colors font-bold"
                    title="中止剧本流式生成、作废在途图像任务并清空排队任务"
                 >
                    <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
                    <span>中止全部任务</span>
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
                    <LogPanel inputLog={inputLog} outputLog={outputLog} />
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
                       1. Asset Studio (Characters & Props)
                    </button>
                    <button 
                       onClick={() => setStoryboardTab('SCRIPT')}
                       className={`px-6 py-3 text-sm font-bold border-b-2 transition-colors ${storyboardTab === 'SCRIPT' ? 'border-indigo-500 text-white' : 'border-transparent text-slate-400 hover:text-slate-200'}`}
                    >
                       2. Script & Storyboard
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
                    <h2 className="text-2xl font-bold text-white">Comic Pages</h2>
                    {pages.length > 0 && (
                        <span className="text-xs text-indigo-300 bg-indigo-900/30 px-2 py-1 rounded border border-indigo-500/30">
                            {config.aspectRatio} • {pages.length} Pages (1 Cover)
                        </span>
                    )}
                    </div>
                    
                    {pages.some(p => p.imageData) && (
                    <button 
                        onClick={handleDownloadAll}
                        className="flex items-center space-x-2 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white px-5 py-2.5 rounded-lg border border-white/10 transition-all text-sm font-bold shadow-lg shadow-indigo-500/20"
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
                        <span>Download Full Comic (.zip)</span>
                    </button>
                    )}
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
                        />
                    ))}
                </div>
            </div>
        )}
      </main>
      
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

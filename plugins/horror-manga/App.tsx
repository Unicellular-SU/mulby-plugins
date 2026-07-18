import React, { useState, useCallback, useEffect, useRef } from 'react';
import ConfigPanel from './components/ConfigPanel';
import PanelCard from './components/PanelCard';
import LogPanel from './components/LogPanel';
// CastingPanel removed
import ScriptReviewPanel from './components/ScriptReviewPanel';
import { generateComicScript, generatePanelImage, generateCharacterReference } from './services/mulbyAiService';
import { AppConfig, PersistentStates, ComicPageData, HorrorStyle, AspectRatio, StoryMode, WatermarkType, WatermarkSettings, EndingType, ColorMode, CharacterSheetItem, GenerationPhase, ComicMetadata, TokenUsageStats } from './types';
import { applyWatermark } from './utils/watermarkUtils';
import JSZip from 'jszip';

// ... (keep formatPersistentState and generateNegativeEmphasis helper functions unchanged) ...
/**
 * 格式化 PersistentStates 为图像模型友好的文本
 */
function formatPersistentState(state: PersistentStates | null | undefined): string {
  if (!state) return "";
  
  const lines: string[] = [];

  if (state.characters && Array.isArray(state.characters)) {
    for (const wrapper of state.characters) {
      const name = wrapper.name;
      const cs = wrapper.state;
      let line = `- ${name}: ${cs.position}, ${cs.pose}`;
      if (cs.appearance_changes?.length > 0) {
        line += `. Changes: ${cs.appearance_changes.join(', ')}`;
      }
      if (cs.injuries?.length > 0) {
        line += `. Injuries: ${cs.injuries.join(', ')}`;
      }
      lines.push(line);
    }
  }
  
  // 环境状态
  if (state.environment) {
    let envLine = `- Environment: ${state.environment.lighting}`;
    if (state.environment.notable_changes?.length > 0) {
      envLine += `. ${state.environment.notable_changes.join(', ')}`;
    }
    lines.push(envLine);
  }
  
  return lines.join('\n');
}

/**
 * 生成否定式强调描述（防止图像模型默认到普通状态）
 */
function generateNegativeEmphasis(state: PersistentStates | null | undefined): string {
  if (!state) return "";
  
  const emphasis: string[] = [];
  
  if (state.characters && Array.isArray(state.characters)) {
    for (const wrapper of state.characters) {
      const name = wrapper.name;
      const charState = wrapper.state;
      
      // 位置强调
      if (charState.position) {
        const pos = charState.position.toLowerCase();
        if (pos.includes('float') || pos.includes('hover') || pos.includes('air')) {
          emphasis.push(`${name} is FLOATING (feet NOT touching ground)`);
        } else if (pos.includes('ceiling') || pos.includes('wall')) {
          emphasis.push(`${name} is on ${charState.position} (defying gravity, NOT on floor)`);
        } else if (pos.includes('hang') || pos.includes('upside')) {
          emphasis.push(`${name} is HANGING (head pointing DOWN)`);
        }
      }
      
      // 外观变化强调
      if (charState.appearance_changes && charState.appearance_changes.length > 0) {
        for (const change of charState.appearance_changes) {
          if (change.toLowerCase().includes('hair') && change.toLowerCase().includes('white')) {
            emphasis.push(`${name}'s hair is WHITE (NOT black, completely changed)`);
          }
          if (change.toLowerCase().includes('eye') && (change.toLowerCase().includes('miss') || change.toLowerCase().includes('empty'))) {
            emphasis.push(`${name} has EMPTY eye sockets (NO eyeballs)`);
          }
        }
      }
    }
  }
  
  return emphasis.length > 0 ? `\n**[NEGATIVE EMPHASIS - MUST FOLLOW]**:\n${emphasis.join('\n')}\n` : "";
}

// Initial Config State
const INITIAL_CONFIG: AppConfig = {
  sourceText: '',
  style: HorrorStyle.JUNJI_ITO,
  colorMode: ColorMode.BLACK_AND_WHITE,
  storyMode: StoryMode.GHOST,
  endingType: EndingType.TWIST,
  panelCount: 0,
  aspectRatio: AspectRatio.MANGA_PAGE,
  totalPages: 'Short', // Default to short
  watermark: {
      enabled: false,
      type: WatermarkType.TEXT_TILED,
      text: '单细胞漫画',
      image: null,
      opacity: 0.3
  },
  textModel: '',
  imageModel: ''
};

const App: React.FC = () => {
  const [config, setConfig] = useState<AppConfig>(INITIAL_CONFIG);
  
  // Phase Management
  const [phase, setPhase] = useState<GenerationPhase>(GenerationPhase.IDLE);
  
  const [pages, setPages] = useState<ComicPageData[]>([]);
  const [comicMetadata, setComicMetadata] = useState<ComicMetadata | null>(null);
  
  // Log States
  const [inputLog, setInputLog] = useState<string>('');
  const [outputLog, setOutputLog] = useState<string>('');
  
  const [globalError, setGlobalError] = useState<string | null>(null);

  // Token Tracking State
  const [totalCost, setTotalCost] = useState<number>(0);
  const [tokenStats, setTokenStats] = useState({
    promptTokens: 0,
    responseTokens: 0
  });

  // Mulby AI 可用性检查（替代原 AI Studio API Key 检查）
  const [mulbyReady, setMulbyReady] = useState(false);
  const [checkingMulby, setCheckingMulby] = useState(true);

  // Abort Controller for cancelling operations
  const abortControllerRef = useRef<AbortController | null>(null);

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

  // Effect to re-apply watermarks when global settings change
  useEffect(() => {
    const updateGlobalWatermarks = async () => {
        if (!pages.some(p => p.rawImageData)) return;

        const promises = pages.map(async (page) => {
            if (page.rawImageData && !page.watermarkOverrides) {
                const watermarked = await applyWatermark(page.rawImageData, config.watermark);
                return { ...page, imageData: watermarked };
            }
            return page;
        });

        const updatedPages = await Promise.all(promises);
        setPages(updatedPages);
    };

    if (pages.length > 0) {
        updateGlobalWatermarks();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.watermark]); 

  const handlePageWatermarkUpdate = async (pageNumber: number, settings?: WatermarkSettings) => {
      const updatedPages = await Promise.all(pages.map(async (page) => {
          if (page.page_number === pageNumber) {
              const newOverrides = settings;
              const effectiveSettings = newOverrides || config.watermark;
              
              let newImageData = page.imageData;
              if (page.rawImageData) {
                  newImageData = await applyWatermark(page.rawImageData, effectiveSettings);
              }

              return { 
                  ...page, 
                  watermarkOverrides: newOverrides,
                  imageData: newImageData 
              };
          }
          return page;
      }));

      setPages(updatedPages);
  };

  const handleTokenUpdate = useCallback((stats: TokenUsageStats) => {
      setTotalCost(prev => prev + stats.totalCost);
      setTokenStats(prev => ({
          promptTokens: prev.promptTokens + stats.promptTokens,
          responseTokens: prev.responseTokens + stats.responseTokens
      }));
  }, []);

  const handlePermissionError = (error: any) => {
    const msg = error.message || JSON.stringify(error);
    if (msg.includes("403") || msg.includes("PERMISSION_DENIED") || msg.includes("permission") || msg.includes("Unauthorized") || msg.includes("401")) {
       setGlobalError("模型调用被拒绝（鉴权失败）。请到 Mulby 设置 → AI 中检查所选模型的 Provider 与 API Key 配置。");
       return true;
    }
    return false;
  };

  const handleCancel = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setPhase(GenerationPhase.IDLE);
    setPages(prev => prev.map(p => 
      p.isGenerating 
        ? { ...p, isGenerating: false, error: "Ritual Interrupted by User." } 
        : p
    ));
    setGlobalError("Ritual Interrupted.");
  };

  // --------------------------------------------------------
  // PHASE 1: SCRIPT GENERATION
  // --------------------------------------------------------
  const handleGenerateScript = async () => {
    setGlobalError(null);
    setPhase(GenerationPhase.SCRIPTING);
    setInputLog('');
    setOutputLog('');
    setPages([]); 
    setComicMetadata(null);
    setTotalCost(0); // Reset cost for new session
    setTokenStats({ promptTokens: 0, responseTokens: 0 });

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      // 1. Generate Script
      const comicData = await generateComicScript(
        config.sourceText,
        config.style,
        config.storyMode,
        config.panelCount,
        config.totalPages,
        (type, text) => {
            if (type === 'INPUT') setInputLog(text);
            if (type === 'OUTPUT') setOutputLog(text);
        },
        controller.signal,
        config.secondaryStoryMode,
        config.endingType,
        config,
        handleTokenUpdate // Pass token tracker
      );
      
      if (controller.signal.aborted) return;

      // 2. Persist Metadata & Transition to REVIEW Phase
      const sheet = comicData.character_sheet || [];
      
      setComicMetadata({
          analysis: comicData.analysis || "",
          characterSheet: sheet.map(c => ({...c, isGenerating: false})), 
          globalArtStyle: comicData.global_art_style || "",
          coverPrompt: comicData.cover_image_prompt,
          rawPages: comicData.pages,
          rawTitle: comicData.title
      });

      setPhase(GenerationPhase.REVIEW);

    } catch (error: any) {
      if (error.name === 'AbortError' || error.message === 'Aborted') {
          console.log("Script generation cancelled.");
          return;
      }
      if (!handlePermissionError(error)) {
        setGlobalError(error.message || "Failed to generate script.");
        setPhase(GenerationPhase.IDLE);
      }
    }
  };

  // --------------------------------------------------------
  // PHASE 2 (Embedded in Review): CASTING Handlers
  // --------------------------------------------------------

  const handleGenerateCharacterImage = async (index: number) => {
    if (!comicMetadata) return;

    // 1. Update State to Generating
    setComicMetadata(prev => {
        if (!prev) return null;
        const newSheet = [...prev.characterSheet];
        newSheet[index] = { ...newSheet[index], isGenerating: true };
        return { ...prev, characterSheet: newSheet };
    });

    const char = comicMetadata.characterSheet[index];
    
    try {
        const imageBase64 = await generateCharacterReference(
            char.name,
            char.description,
            comicMetadata.globalArtStyle,
            config.colorMode,
            handleTokenUpdate, // Pass token tracker
            config // 携带 Mulby 图像模型选择
        );
        
        setComicMetadata(prev => {
            if (!prev) return null;
            const newSheet = [...prev.characterSheet];
            newSheet[index] = { 
                ...newSheet[index], 
                referenceImage: imageBase64, 
                isGenerating: false 
            };
            return { ...prev, characterSheet: newSheet };
        });

    } catch (e) {
        console.error(`Failed to generate ref for ${char.name}`, e);
        setComicMetadata(prev => {
            if (!prev) return null;
            const newSheet = [...prev.characterSheet];
            newSheet[index] = { ...newSheet[index], isGenerating: false }; 
            return { ...prev, characterSheet: newSheet };
        });
        setGlobalError(`Failed to generate character image for ${char.name}.`);
    }
  };

  const handleUploadCharacterImage = (index: number, base64: string) => {
      setComicMetadata(prev => {
          if (!prev) return null;
          const newSheet = [...prev.characterSheet];
          newSheet[index] = { ...newSheet[index], referenceImage: base64, isGenerating: false };
          return { ...prev, characterSheet: newSheet };
      });
  };

  // --------------------------------------------------------
  // PHASE 3: PRODUCTION (Page Generation)
  // --------------------------------------------------------
  
  const handleConfirmReviewAndProduce = async () => {
    if (!comicMetadata) return;
    setPhase(GenerationPhase.PRODUCING);
    
    // Setup Pages Structure
    const colorKeywords = config.colorMode === ColorMode.BLACK_AND_WHITE 
        ? "monochrome, manga style, screentones, black and white ink illustration, high contrast, noir" 
        : "full color, vivid colors, cinematic lighting, detailed color illustration";

    // 1. Cover Page
    const coverPrompt = `${comicMetadata.globalArtStyle}. ${comicMetadata.coverPrompt}. Text in image must be Simplified Chinese: "${comicMetadata.rawTitle}". Horror Manga Cover, Masterpiece, High Contrast, ${colorKeywords}.`;

    const coverPage: ComicPageData = {
        page_number: 0,
        layout_description: "Cover Art",
        title: comicMetadata.rawTitle,
        image_prompt: coverPrompt,
        characters_in_scene: [], 
        isGenerating: true,
    };

    // 2. Content Pages
    let previousPageState: PersistentStates | null = null;
    let previousPageNumber: number = 0;

    const contentPages: ComicPageData[] = comicMetadata.rawPages.map((s, index) => {
        const currentPageNumber = s.page_number || (index + 1);
        
        // --- PROMPT CONSTRUCTION ---
        const presentCharacters = s.characters_in_scene || [];
        let characterPrompts = "";
        
        // We use the character descriptions from the SHEET (possibly updated in Review)
        if (comicMetadata.characterSheet) {
          characterPrompts = presentCharacters
              .map(sceneCharName => {
                  const char = comicMetadata.characterSheet.find(sheetChar => {
                      const sName = sheetChar.name.trim().toLowerCase();
                      const cName = sceneCharName.trim().toLowerCase();
                      return sName === cName || sName.includes(cName) || cName.includes(sName);
                  });
                  // STRONG INSTRUCTION IF REF EXISTS
                  if (char?.referenceImage) {
                      // CRITICAL FIX: IF REFERENCE EXISTS, DO NOT INCLUDE TEXT DESCRIPTION.
                      // TEXT DESCRIPTION OFTEN CONFLICTS WITH REFERENCE IMAGE IN COMPLEX PROMPTS.
                      return `${char.name}: [VISUAL IDENTITY LOCKED] MUST MATCH PROVIDED REFERENCE IMAGE EXACTLY. IGNORE TEXT DESCRIPTIONS OF FACE/CLOTHES.`;
                  }
                  return char ? `${char.name}: ${char.description}` : "";
              })
              .filter(desc => desc !== "")
              .join(" | ");
        }

        // --- STATE LOGIC ---
        let stateContext = "";
        if (index > 0) {
          const inheritedState = s.inherited_state || previousPageState;
          if (inheritedState) {
            const formattedState = formatPersistentState(inheritedState);
            const negativeEmphasis = generateNegativeEmphasis(inheritedState);
            stateContext = `\n**[INHERITED VISUAL STATE]**:\n${formattedState}\n${negativeEmphasis}\n**CRITICAL**: Maintain this state.`;
          }
          if (s.continuity_note) stateContext += `\n**[CONTINUITY]**: ${s.continuity_note}\n`;
        }
        
        if (s.persistent_states) previousPageState = s.persistent_states;
        previousPageNumber = currentPageNumber;
        
        const sourceDef = "Source Type: Direct digital export from Clip Studio Paint. Status: Finished inked manga page with screentones (Beta). Quality: 8k lossless master file.";
        const layoutConstraint = "Layout: Full page comic panel with clean white margins.";

        const finalPrompt = `
  ${sourceDef}
  ${layoutConstraint}

  **Art Style**: ${comicMetadata.globalArtStyle}.
  **Color Mode**: ${config.colorMode}.
  **Mandatory Style Tags**: ${colorKeywords}

  **Characters Present**: [${characterPrompts}].
  ${stateContext}
  **Scene Action**: ${s.image_prompt}
  `.trim();

        return { ...s, image_prompt: finalPrompt, isGenerating: true };
    });

    const allPages = [coverPage, ...contentPages];
    setPages(allPages);

    // 3. Trigger Generation 
    if (!abortControllerRef.current) abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    // Fire & Forget Generation
    triggerImageGeneration(coverPage, config.aspectRatio, signal, comicMetadata.characterSheet);
      
    contentPages.forEach((page, idx) => {
        setTimeout(() => {
            if (signal.aborted) return;
            triggerImageGeneration(page, config.aspectRatio, signal, comicMetadata.characterSheet);
        }, (idx + 1) * 1000); // Stagger requests
    });
  };


  const triggerImageGeneration = async (
      page: ComicPageData, 
      ratio: string, 
      signal: AbortSignal,
      allCharacters: CharacterSheetItem[]
  ) => {
    if (signal?.aborted) return;
    try {
        // FILTER REFERENCE IMAGES FOR THIS PAGE
        // Robust strategy: Check explicit list AND scan prompt for names
        const relevantRefs: {name: string, image: string}[] = [];
        
        if (allCharacters) {
            allCharacters.forEach(char => {
                if (!char.referenceImage) return;

                const normalizedCharName = char.name.trim().toLowerCase();
                
                // 1. Check Explicit List (Robust Fuzzy Match)
                let isPresent = page.characters_in_scene?.some(name => {
                   const n = name.trim().toLowerCase();
                   return n.includes(normalizedCharName) || normalizedCharName.includes(n);
                });

                // 2. Fallback: Scan Prompt Text
                if (!isPresent && page.image_prompt) {
                     const promptLower = page.image_prompt.toLowerCase();
                     // Check for name match in prompt
                     if (promptLower.includes(normalizedCharName)) {
                         isPresent = true;
                     }
                }

                if (isPresent) {
                    relevantRefs.push({ name: char.name, image: char.referenceImage });
                }
            });
        }

        const base64Image = await generatePanelImage(
            page.image_prompt,
            ratio,
            relevantRefs,
            handleTokenUpdate, // Pass token tracker
            config // 携带 Mulby 图像模型选择
        );
        
        if (signal?.aborted) return;

        const settings = page.watermarkOverrides || config.watermark;
        const watermarkedImage = await applyWatermark(base64Image, settings);
        
        setPages(prev => prev.map(p => 
            p.page_number === page.page_number 
            ? { 
                ...p, 
                rawImageData: base64Image, 
                imageData: watermarkedImage, 
                isGenerating: false, 
                error: undefined 
              } 
            : p
        ));
    } catch (error: any) {
        if (signal?.aborted) return;
        if (handlePermissionError(error)) return;
        setPages(prev => prev.map(p => 
            p.page_number === page.page_number 
            ? { ...p, isGenerating: false, error: "Image generation failed." } 
            : p
        ));
    }
  };

  const handleRegeneratePage = useCallback((pageNumber: number, newPrompt: string, newCharactersInScene?: string[]) => {
      // 1. Update State
      setPages(prev => prev.map(p => 
        p.page_number === pageNumber 
        ? { 
            ...p, 
            image_prompt: newPrompt, 
            isGenerating: true, 
            error: undefined,
            characters_in_scene: newCharactersInScene || p.characters_in_scene 
          } 
        : p
      ));
      
      const prevPage = pages.find(p => p.page_number === pageNumber);
      
      // Ensure we use the CURRENT metadata including the character sheet
      // Note: comicMetadata might be stale in this closure if not handled carefully,
      // but useCallback dependency array includes comicMetadata.
      if (prevPage && comicMetadata?.characterSheet) {
           const controller = abortControllerRef.current || new AbortController();
           
           const updatedPageObj = {
               ...prevPage,
               image_prompt: newPrompt,
               characters_in_scene: newCharactersInScene || prevPage.characters_in_scene
           };

           triggerImageGeneration(
               updatedPageObj, 
               config.aspectRatio, 
               controller.signal, 
               comicMetadata.characterSheet
           );
      }
  }, [config.aspectRatio, pages, comicMetadata]); 

  const handleDownloadAll = async () => {
    const pagesWithImages = pages.filter(p => p.imageData);
    if (pagesWithImages.length === 0) return;

    try {
        const zip = new JSZip();
        const comicTitle = pages[0]?.title || "HorrorManga";
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

  if (checkingMulby) {
     return (
        <div className="min-h-screen bg-black flex items-center justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-red-700"></div>
        </div>
     );
  }

  if (!mulbyReady) {
     return (
      <div className="min-h-screen bg-black flex flex-col items-center justify-center p-6 text-center">
        <div className="max-w-md w-full bg-[#111] p-8 rounded-2xl border border-red-900/50 shadow-2xl space-y-6">
          <div className="text-4xl">🩸</div>
          <div>
            <h1 className="text-2xl font-bold text-red-600 font-horror mb-2 tracking-widest">SETUP REQUIRED</h1>
            <p className="text-slate-400 text-sm">
              未检测到 Mulby AI 接口。请通过 <b>Mulby</b> 启动本插件，并在 Mulby 设置 → AI 中配置至少一个文本模型和一个图像生成模型。
            </p>
          </div>
        </div>
      </div>
     );
  }

  return (
    <div className="min-h-screen bg-[#020617] text-slate-100 flex flex-col font-sans selection:bg-red-900 selection:text-white">
      
      <header className="sticky top-0 z-50 bg-[#020617]/90 backdrop-blur border-b border-red-900/30">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-3">
             <div className="w-8 h-8 bg-red-900 rounded-lg flex items-center justify-center font-bold text-black shadow-lg shadow-red-900/20 text-lg">HM</div>
             <h1 className="text-2xl font-bold tracking-widest text-white font-horror">HORROR<span className="text-red-600">MANGA</span></h1>
          </div>
          <div className="flex items-center space-x-4">
             {/* Token Usage Display */}
             <div className="hidden md:flex flex-col items-end mr-4">
                <div className="flex items-center space-x-2 text-xs text-slate-400">
                    <span className="font-mono text-xs">{tokenStats.promptTokens.toLocaleString()} T (In)</span>
                    <span className="text-slate-700">|</span>
                    <span className="font-mono text-xs">{tokenStats.responseTokens.toLocaleString()} T (Out)</span>
                </div>
                <div className="text-green-400 font-bold text-sm tracking-wide">
                    ${totalCost.toFixed(4)} <span className="text-[10px] font-normal text-slate-600 opacity-70">EST. COST</span>
                </div>
             </div>

             {phase !== GenerationPhase.IDLE && (
                 <span className="text-xs px-3 py-1 bg-red-950/50 border border-red-900/50 rounded-full text-red-400 animate-pulse">
                     RITUAL PHASE: {phase}
                 </span>
             )}
          </div>
        </div>
      </header>

      <main className="flex-grow max-w-7xl mx-auto px-4 py-8 w-full space-y-12">
        
        {globalError && (
          <div className="mb-6 p-4 bg-red-950/30 border border-red-800 rounded-lg flex items-start space-x-3">
             <svg className="w-5 h-5 text-red-500 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
             <p className="text-red-200">{globalError}</p>
          </div>
        )}

        {/* --- SECTION 1: CONFIG & SCRIPT --- */}
        <div className={`grid grid-cols-1 lg:grid-cols-12 gap-8 ${phase === GenerationPhase.PRODUCING ? 'opacity-50 pointer-events-none' : ''}`}>
          <div className="lg:col-span-4">
             <div className="sticky top-24">
                <ConfigPanel 
                  config={config} 
                  onChange={setConfig} 
                  onGenerate={handleGenerateScript} 
                  onCancel={handleCancel}
                  isLoading={phase === GenerationPhase.SCRIPTING} 
                />
             </div>
          </div>
          <div className="lg:col-span-8 flex flex-col">
             <div className="sticky top-24 h-full min-h-[600px]">
                <LogPanel inputLog={inputLog} outputLog={outputLog} />
             </div>
          </div>
        </div>

        {/* --- SECTION 1.5: REVIEW & CASTING (Integrated) --- */}
        {phase === GenerationPhase.REVIEW && comicMetadata && (
            <div className="animate-fade-in-up">
                 <ScriptReviewPanel 
                    metadata={comicMetadata}
                    config={config}
                    onUpdate={setComicMetadata}
                    onConfirm={handleConfirmReviewAndProduce}
                    onGenerateCharacterImage={handleGenerateCharacterImage}
                    onUploadCharacterImage={handleUploadCharacterImage}
                    onTokenUpdate={handleTokenUpdate} // Pass tracker
                 />
            </div>
        )}

        {/* --- SECTION 3: PRODUCTION RESULTS --- */}
        {phase === GenerationPhase.PRODUCING && (
            <div className="pt-8 border-t border-red-900/30 min-h-[400px]">
                <div className="flex items-center justify-between mb-8">
                    <div className="flex items-center space-x-3">
                    <h2 className="text-2xl font-bold text-red-50 font-horror tracking-widest">PAGES FROM THE ABYSS</h2>
                    {pages.length > 0 && (
                        <span className="text-xs text-red-300 bg-red-950/50 px-2 py-1 rounded border border-red-900/50">
                            {config.aspectRatio} • {pages.length} Pages
                        </span>
                    )}
                    </div>
                    {pages.some(p => p.imageData) && (
                    <button onClick={handleDownloadAll} className="flex items-center space-x-2 bg-red-900 hover:bg-red-800 text-white px-5 py-2.5 rounded-lg border border-red-700 transition-all text-sm font-bold shadow-lg shadow-red-900/20">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
                        <span>Download Artifacts (.zip)</span>
                    </button>
                    )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-12 animate-fade-in-up pb-12">
                    {pages.map((page, idx) => (
                        <PanelCard 
                        key={page.page_number} 
                        index={idx} 
                        page={page} 
                        style={comicMetadata?.globalArtStyle || config.style}
                        analysis={comicMetadata?.analysis}
                        characterSheet={comicMetadata?.characterSheet}
                        globalWatermarkSettings={config.watermark}
                        config={config}
                        onRegenerate={handleRegeneratePage}
                        onUpdateWatermark={handlePageWatermarkUpdate}
                        onTokenUpdate={handleTokenUpdate} // Pass tracker
                        />
                    ))}
                </div>
            </div>
        )}
      </main>
      
      <style>{`
        @keyframes loading-bar { 0% { width: 0%; margin-left: 0; } 50% { width: 100%; margin-left: 0; } 100% { width: 0%; margin-left: 100%; } }
        .animate-loading-bar { animation: loading-bar 1.5s infinite ease-in-out; }
        .animate-fade-in { animation: fadeIn 0.5s ease-out forwards; }
        .animate-fade-in-up { animation: fadeInUp 0.5s ease-out forwards; }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes fadeInUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
        .scrollbar-thin::-webkit-scrollbar { width: 6px; }
        .scrollbar-thin::-webkit-scrollbar-track { background: transparent; }
        .scrollbar-thin::-webkit-scrollbar-thumb { background: #334155; border-radius: 3px; }
        .scrollbar-thin::-webkit-scrollbar-thumb:hover { background: #475569; }
      `}</style>
    </div>
  );
};

export default App;
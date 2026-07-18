import React, { useState, useRef, useEffect } from 'react';
import { ComicPageData, WatermarkSettings, WatermarkType, CharacterSheetItem, AppConfig, OnTokenUpdate } from '../types';
import { WATERMARK_TYPE_OPTIONS } from '../constants';
import { refineImagePrompt } from '../services/mulbyAiService';

interface PanelCardProps {
  page: ComicPageData;
  index: number;
  globalWatermarkSettings: WatermarkSettings;
  style: string; // The active horror style
  analysis?: string; // Narrative analysis
  characterSheet?: CharacterSheetItem[]; // Global character definitions
  config: AppConfig; // Config for API settings
  onRegenerate: (pageNumber: number, newPrompt: string, newCharactersInScene?: string[]) => void;
  onUpdateWatermark: (pageNumber: number, settings?: WatermarkSettings) => void;
  onTokenUpdate?: OnTokenUpdate;
}

const PanelCard: React.FC<PanelCardProps> = ({ 
    page, 
    index, 
    globalWatermarkSettings, 
    style, 
    analysis, 
    characterSheet,
    config,
    onRegenerate, 
    onUpdateWatermark,
    onTokenUpdate
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [isWatermarkEditing, setIsWatermarkEditing] = useState(false);
  const [promptDraft, setPromptDraft] = useState(page.image_prompt);
  const watermarkImgRef = useRef<HTMLInputElement>(null);

  // Scene Casting State
  const [sceneCharacters, setSceneCharacters] = useState<string[]>(page.characters_in_scene || []);

  // Prompt Refinement State
  const [refineInstruction, setRefineInstruction] = useState("");
  const [isRefining, setIsRefining] = useState(false);

  // Reset local state when page prop updates
  useEffect(() => {
    setPromptDraft(page.image_prompt);
    setSceneCharacters(page.characters_in_scene || []);
  }, [page]);

  // Local state for watermark editing
  const currentSettings = page.watermarkOverrides || globalWatermarkSettings;

  const handleSave = () => {
    onRegenerate(page.page_number, promptDraft, sceneCharacters);
    setIsEditing(false);
  };

  const handleAddCharacter = (charName: string) => {
      if (!sceneCharacters.includes(charName)) {
          setSceneCharacters([...sceneCharacters, charName]);
      }
  };

  const handleRemoveCharacter = (charName: string) => {
      setSceneCharacters(sceneCharacters.filter(n => n !== charName));
  };

  const handleAiRefine = async () => {
      if (!refineInstruction.trim()) return;
      setIsRefining(true);
      try {
          const newPrompt = await refineImagePrompt(
              promptDraft, 
              refineInstruction, 
              style, 
              analysis, 
              characterSheet,
              config, // Pass config for API provider support
              onTokenUpdate
          );
          setPromptDraft(newPrompt);
          setRefineInstruction(""); // Clear instruction after success
      } catch (e) {
          console.error("Refinement failed", e);
      } finally {
          setIsRefining(false);
      }
  };

  const handleWatermarkChange = (field: keyof WatermarkSettings, value: any) => {
    const newSettings = { ...currentSettings, [field]: value };
    onUpdateWatermark(page.page_number, newSettings);
  };

  const handleWatermarkImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (event) => {
        handleWatermarkChange('image', event.target?.result as string);
      };
      reader.readAsDataURL(file);
  };

  const toggleOverride = () => {
      if (page.watermarkOverrides) {
          onUpdateWatermark(page.page_number, undefined);
      } else {
          onUpdateWatermark(page.page_number, { ...globalWatermarkSettings });
      }
  };

  const downloadImage = () => {
      if (!page.imageData) return;
      const link = document.createElement('a');
      link.href = page.imageData;
      link.download = `horrormanga-page-${page.page_number}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
  }

  const isCover = page.page_number === 0;

  // Helper to find char image
  const getCharImage = (name: string) => {
      if (!characterSheet) return null;
      // Fuzzy match
      const char = characterSheet.find(c => {
          const sName = c.name.trim().toLowerCase();
          const cName = name.trim().toLowerCase();
          return sName === cName || sName.includes(cName) || cName.includes(sName);
      });
      return char?.referenceImage;
  };

  return (
    <div className="flex flex-col h-full space-y-4">
      {/* ... Visual Container code ... */}
      <div className={`relative w-full overflow-hidden rounded-sm bg-[#1a0505] shadow-2xl aspect-[2/3] group 
        ${isCover ? 'border-4 border-red-700 shadow-red-900/50' : 'border border-slate-800'}`}>
        
        {/* ... Loading/Image/Watermark/Overlay code ... */}
        {page.isGenerating && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/90 backdrop-blur-sm">
             <div className="w-32 h-1 bg-red-950 rounded-full overflow-hidden">
                <div className="h-full bg-red-600 animate-loading-bar"></div>
             </div>
             <p className="mt-4 text-xs text-red-500 font-horror tracking-widest animate-pulse">
               {isCover ? 'CONJURING COVER...' : `DRAWING PAGE ${page.page_number}...`}
             </p>
          </div>
        )}

        {page.imageData ? (
          <img 
            src={page.imageData} 
            alt={page.layout_description}
            className="w-full h-full object-cover filter contrast-110"
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center text-slate-700 bg-black">
             <span className="text-4xl opacity-30 grayscale">💀</span>
             <span className="text-xs mt-2 font-mono opacity-30 uppercase tracking-widest">{isCover ? 'COVER' : `Page ${page.page_number}`}</span>
          </div>
        )}

        <div className={`absolute top-0 left-0 z-10 text-white text-xs font-bold px-3 py-1 shadow-md font-serif
          ${isCover ? 'bg-red-800 text-black' : 'bg-black/80 text-slate-400 border-r border-b border-slate-800'}`}>
          {isCover ? 'THE COVER' : `PAGE ${page.page_number}`}
        </div>
        
        {page.error && (
            <div className="absolute inset-0 flex items-center justify-center bg-red-950/90 p-4 text-center border-2 border-red-600">
                <p className="text-red-400 text-sm font-mono">{page.error}</p>
            </div>
        )}

        {/* ... Watermark Editor Overlay ... */}
        {isWatermarkEditing && (
            <div className="absolute inset-0 z-30 bg-[#0d0d0d]/95 backdrop-blur-md p-4 animate-fade-in flex flex-col overflow-y-auto">
                <div className="flex justify-between items-center mb-4 border-b border-red-900/30 pb-2">
                    <h3 className="text-sm font-bold text-red-500 uppercase">Seal Settings (Page {page.page_number})</h3>
                    <button onClick={() => setIsWatermarkEditing(false)} className="text-slate-500 hover:text-white">✕</button>
                </div>
                <div className="space-y-4 flex-1">
                     <div className="flex items-center justify-between bg-black/50 p-2 rounded border border-slate-800">
                        <span className="text-xs text-slate-400">Mode</span>
                        <button 
                            onClick={toggleOverride}
                            className={`text-xs px-2 py-1 rounded border transition-all ${
                                page.watermarkOverrides 
                                ? 'bg-red-900/30 border-red-700 text-red-200' 
                                : 'bg-slate-800 border-slate-600 text-slate-400'
                            }`}
                        >
                            {page.watermarkOverrides ? 'CUSTOM' : 'GLOBAL SYNC'}
                        </button>
                     </div>

                     {page.watermarkOverrides && (
                        <div className="space-y-3 animate-fade-in-up">
                            <div className="flex items-center justify-between">
                                <label className="text-xs text-slate-400">Enable Seal</label>
                                <input 
                                    type="checkbox"
                                    checked={currentSettings.enabled}
                                    onChange={(e) => handleWatermarkChange('enabled', e.target.checked)}
                                    className="accent-red-600 w-4 h-4"
                                />
                            </div>
                            
                            {currentSettings.enabled && (
                                <>
                                    <div className="space-y-1">
                                        <label className="text-xs text-slate-500 uppercase">Style</label>
                                        <select
                                            className="w-full bg-[#1c1c1c] border border-slate-800 rounded p-1.5 text-xs text-slate-300"
                                            value={currentSettings.type}
                                            onChange={(e) => handleWatermarkChange('type', e.target.value)}
                                        >
                                            {WATERMARK_TYPE_OPTIONS.map(opt => (
                                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                                            ))}
                                        </select>
                                    </div>

                                    {currentSettings.type.includes('TEXT') ? (
                                        <div className="space-y-1">
                                            <label className="text-xs text-slate-500 uppercase">Text</label>
                                            <input
                                                type="text"
                                                className="w-full bg-[#1c1c1c] border border-slate-800 rounded p-1.5 text-xs text-slate-300"
                                                value={currentSettings.text}
                                                onChange={(e) => handleWatermarkChange('text', e.target.value)}
                                            />
                                        </div>
                                    ) : (
                                        <div className="space-y-1">
                                            <label className="text-xs text-slate-500 uppercase">Image</label>
                                            <div className="flex gap-2">
                                                <button 
                                                    onClick={() => watermarkImgRef.current?.click()}
                                                    className="flex-1 bg-slate-800 text-xs py-1.5 rounded border border-slate-600"
                                                >
                                                    Upload
                                                </button>
                                                <input 
                                                    type="file" 
                                                    ref={watermarkImgRef} 
                                                    className="hidden" 
                                                    accept="image/*" 
                                                    onChange={handleWatermarkImageUpload}
                                                />
                                            </div>
                                        </div>
                                    )}

                                    <div className="space-y-1">
                                        <div className="flex justify-between text-xs text-slate-500">
                                            <span>Opacity</span>
                                            <span>{Math.round(currentSettings.opacity * 100)}%</span>
                                        </div>
                                        <input 
                                            type="range" 
                                            min="0.1" 
                                            max="1" 
                                            step="0.1"
                                            value={currentSettings.opacity}
                                            onChange={(e) => handleWatermarkChange('opacity', Number(e.target.value))}
                                            className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-red-600"
                                        />
                                    </div>
                                </>
                            )}
                        </div>
                     )}
                </div>
            </div>
        )}

        {/* Hover Actions */}
        <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity flex space-x-2 z-20">
             {page.imageData && (
                <>
                    <button 
                        onClick={downloadImage}
                        className="bg-red-900/80 hover:bg-red-700 p-2 rounded-full text-white backdrop-blur transition-colors border border-red-500/30"
                        title="Download Page"
                    >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
                    </button>
                    <button
                        onClick={() => setIsWatermarkEditing(true)}
                        className={`p-2 rounded-full text-white backdrop-blur transition-colors border ${page.watermarkOverrides ? 'bg-red-800 border-red-500' : 'bg-black/80 hover:bg-slate-800 border-white/10'}`}
                        title="Watermark Settings"
                    >
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="12" r="10" />
                            <path d="M12 6v12" />
                            <path d="M12 12h8" />
                            <path d="M12 12H4" />
                            <circle cx="12" cy="12" r="4" />
                        </svg>
                    </button>
                </>
             )}
             <button 
                onClick={() => setIsEditing(!isEditing)}
                className="bg-black/80 hover:bg-slate-800 p-2 rounded-full text-white backdrop-blur transition-colors border border-white/10"
                title={isEditing ? "Close Prompt" : "View/Edit Prompt"}
             >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path></svg>
             </button>
        </div>
      </div>

      {/* Editor Panel */}
      {isEditing && (
        <div className="p-3 bg-[#0d0d0d] border border-red-900/30 rounded-lg animate-fade-in shadow-inner order-last flex flex-col gap-3">
          
          {/* AI Refine Section */}
          <div className="bg-[#1a1a1a] p-2 rounded border border-purple-900/30">
              <label className="text-[10px] text-purple-400 font-bold mb-1 block uppercase flex justify-between">
                  <span>Dark Whisper (AI Modify)</span>
                  {isRefining && <span className="animate-pulse">Consulting the void...</span>}
              </label>
              <div className="flex gap-2">
                  <input 
                      type="text"
                      className="flex-1 bg-black border border-slate-800 rounded px-2 py-1 text-xs text-slate-300 focus:border-purple-600 focus:outline-none placeholder-slate-700"
                      placeholder='e.g. "Make it rain harder", "Add a cat"'
                      value={refineInstruction}
                      onChange={(e) => setRefineInstruction(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleAiRefine()}
                      disabled={isRefining}
                  />
                  <button 
                      onClick={handleAiRefine}
                      disabled={isRefining || !refineInstruction.trim()}
                      className={`text-xs px-2 py-1 rounded border transition-colors ${
                          isRefining 
                          ? 'bg-purple-900/50 text-purple-300 border-purple-800 cursor-not-allowed' 
                          : 'bg-purple-900 hover:bg-purple-800 text-purple-100 border-purple-700'
                      }`}
                  >
                      ✨
                  </button>
              </div>
          </div>
          
          {/* Scene Casting Manager */}
          {characterSheet && characterSheet.length > 0 && (
             <div className="bg-[#1a1a1a] p-2 rounded border border-slate-800">
                <label className="text-[10px] text-slate-500 font-bold mb-2 block uppercase">Scene Cast (Reference Injection)</label>
                
                {/* Active Characters */}
                <div className="flex flex-wrap gap-2 mb-2">
                    {sceneCharacters.map(charName => {
                        const img = getCharImage(charName);
                        return (
                            <div key={charName} className="flex items-center bg-slate-900 border border-slate-700 rounded-full pr-2 pl-1 py-0.5 max-w-[120px]">
                                {img ? (
                                    <img src={img} className="w-5 h-5 rounded-full object-cover border border-slate-600 mr-1.5" alt={charName} />
                                ) : (
                                    <div className="w-5 h-5 rounded-full bg-slate-800 border border-slate-600 mr-1.5 flex items-center justify-center text-[8px]">?</div>
                                )}
                                <span className="text-[10px] text-slate-300 truncate">{charName}</span>
                                <button 
                                    onClick={() => handleRemoveCharacter(charName)}
                                    className="ml-1 text-slate-500 hover:text-red-400 font-bold"
                                >
                                    ×
                                </button>
                            </div>
                        );
                    })}
                    {sceneCharacters.length === 0 && (
                        <span className="text-[10px] text-slate-600 italic">No specific characters assigned.</span>
                    )}
                </div>

                {/* Add Character Dropdown */}
                <div className="flex items-center gap-2">
                    <select 
                        className="flex-1 bg-black border border-slate-800 rounded px-2 py-1 text-xs text-slate-400 focus:outline-none"
                        onChange={(e) => {
                            if (e.target.value) {
                                handleAddCharacter(e.target.value);
                                e.target.value = "";
                            }
                        }}
                    >
                        <option value="">+ Add Character to Scene...</option>
                        {characterSheet
                            .filter(c => !sceneCharacters.includes(c.name))
                            .map(c => (
                                <option key={c.name} value={c.name}>{c.name}</option>
                            ))
                        }
                    </select>
                </div>
             </div>
          )}

          <div className="space-y-1">
             <label className="text-xs text-red-500 font-bold block uppercase">Image Prompt (Draft)</label>
             <textarea 
                className="w-full h-32 bg-black text-xs text-slate-300 p-2 rounded border border-slate-800 focus:border-red-900 focus:outline-none font-mono leading-tight"
                value={promptDraft}
                onChange={(e) => setPromptDraft(e.target.value)}
             />
          </div>

          <div className="flex justify-end space-x-2">
            <button 
                onClick={() => setIsEditing(false)}
                className="text-xs text-slate-500 hover:text-white px-3 py-1"
            >
                Cancel
            </button>
            <button 
                onClick={handleSave}
                disabled={page.isGenerating}
                className="text-xs bg-red-900 hover:bg-red-800 text-white px-3 py-1 rounded font-medium border border-red-700 shadow-red-900/20 shadow-lg"
            >
                Re-Summon
            </button>
          </div>
        </div>
      )}

      {/* Info Section */}
      <div className="bg-[#0f0e0e] rounded-lg border border-red-900/10 p-4 flex-grow">
          {isCover ? (
            <div className="text-center py-6">
                <h3 className="text-xl font-horror text-red-500 mb-2 tracking-widest">{page.title || "UNTITLED"}</h3>
                <p className="text-xs text-slate-500 uppercase">Generated by HorrorManga AI</p>
                <div className="w-12 h-1 bg-red-900/50 mx-auto mt-4 rounded-full"></div>
            </div>
          ) : (
            <div className="h-full flex flex-col justify-between">
               <div>
                  <h4 className="text-xs font-bold text-red-900/70 mb-2 uppercase tracking-wider flex items-center">
                    <span className="w-1.5 h-1.5 rounded-full bg-red-900 mr-2"></span>
                    Layout
                  </h4>
                  <p className="text-sm text-slate-400 italic leading-relaxed">
                     {page.layout_description}
                  </p>
               </div>
               
               <div className="mt-4 pt-3 border-t border-slate-800/50">
                  <button 
                     onClick={() => setIsEditing(!isEditing)}
                     className="text-xs text-slate-500 hover:text-red-400 underline flex items-center"
                  >
                     <span>View Prompt & Casting</span>
                     <svg className="w-3 h-3 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                  </button>
               </div>
            </div>
          )}
      </div>

    </div>
  );
};

export default PanelCard;
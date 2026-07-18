
import React, { useState } from 'react';
import { ComicPageData, AppConfig, CharacterSheetItem, PropSheetItem } from '../types';
import { refineImagePrompt } from '../services/mulbyAiService';

interface PanelCardProps {
  page: ComicPageData;
  index: number;
  config: AppConfig;
  characterSheet?: CharacterSheetItem[];
  propSheet?: PropSheetItem[];
  onRegenerate: (pageNumber: number, newPrompt: string, newCharactersInScene?: string[], newPropsInScene?: string[]) => void;
}

const PanelCard: React.FC<PanelCardProps> = ({ page, index, config, characterSheet, propSheet, onRegenerate }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [promptDraft, setPromptDraft] = useState(page.image_prompt);
  
  // State for selections in edit mode
  const [selectedCharacters, setSelectedCharacters] = useState<string[]>(page.characters_in_scene || []);
  const [selectedProps, setSelectedProps] = useState<string[]>(page.props_in_scene || []);
  
  // AI Refine State
  const [refineInstruction, setRefineInstruction] = useState('');
  const [isRefining, setIsRefining] = useState(false);
  const [refineError, setRefineError] = useState<string | null>(null);

  const handleSave = () => {
    onRegenerate(page.page_number, promptDraft, selectedCharacters, selectedProps);
    setIsEditing(false);
  };

  const handleRefine = async () => {
    if (!refineInstruction.trim()) return;
    setIsRefining(true);
    setRefineError(null);
    try {
      const newPrompt = await refineImagePrompt(
        promptDraft,
        refineInstruction,
        config.style,
        config.character,
        config.storyMode
      );
      setPromptDraft(newPrompt);
      setRefineInstruction(''); // Clear instruction on success
    } catch (error: any) {
      console.error("Failed to refine prompt", error);
      // 方案 2.2：失败可见，保留输入可重试
      setRefineError(error?.message || 'AI 润色失败，请重试');
    } finally {
      setIsRefining(false);
    }
  };

  const toggleCharacter = (charName: string) => {
      setSelectedCharacters(prev => {
          if (prev.includes(charName)) {
              return prev.filter(c => c !== charName);
          } else {
              return [...prev, charName];
          }
      });
  };

  const toggleProp = (propName: string) => {
    setSelectedProps(prev => {
        if (prev.includes(propName)) {
            return prev.filter(p => p !== propName);
        } else {
            return [...prev, propName];
        }
    });
};

  const downloadImage = () => {
      if (!page.imageData) return;
      const link = document.createElement('a');
      link.href = page.imageData;
      link.download = `techmanga-page-${page.page_number}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
  }

  // Is this the Cover Page?
  const isCover = page.page_number === 0;

  // Identify characters on this page for display (using current Page data)
  const charsOnPage = characterSheet?.filter(c => page.characters_in_scene?.includes(c.name)) || [];
  const propsOnPage = propSheet?.filter(p => page.props_in_scene?.includes(p.name)) || [];

  return (
    <div className="flex flex-col h-full space-y-4">
      
      {/* Visual Container (The Page) */}
      <div className={`relative w-full overflow-hidden rounded-sm bg-slate-800 border-4 shadow-2xl aspect-[2/3] group ${isCover ? 'border-yellow-500/50' : 'border-white'}`}>
        
        {/* Loading State */}
        {page.isGenerating && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-slate-900/80 backdrop-blur-sm">
             <div className="w-24 h-1 bg-slate-700 rounded-full overflow-hidden">
                <div className="h-full bg-indigo-500 animate-loading-bar"></div>
             </div>
             <p className="mt-4 text-xs text-indigo-300 font-mono animate-pulse uppercase tracking-widest">
               {isCover ? 'Designing Cover...' : `Drawing Page ${page.page_number}...`}
             </p>
          </div>
        )}

        {/* Image Display */}
        {page.imageData ? (
          <img 
            src={page.imageData} 
            alt={page.layout_description}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center text-slate-600 bg-slate-100/5">
             <span className="text-4xl opacity-50">{isCover ? '📔' : '📄'}</span>
             <span className="text-xs mt-2 font-mono opacity-50">{isCover ? 'COVER' : `Page ${page.page_number}`}</span>
          </div>
        )}

        {/* Page Number Badge */}
        <div className={`absolute top-0 left-0 z-10 text-white text-xs font-bold px-3 py-1 shadow-md ${isCover ? 'bg-yellow-600' : 'bg-indigo-600'}`}>
          {isCover ? 'COVER' : `PAGE ${page.page_number}`}
        </div>
        
        {/* Error Overlay */}
        {page.error && (
            <div className="absolute inset-0 flex items-center justify-center bg-red-900/80 p-4 text-center">
                <p className="text-red-200 text-sm font-mono">{page.error}</p>
            </div>
        )}

        {/* Hover Actions */}
        <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity flex space-x-2 z-20">
             {page.imageData && (
                <button 
                  onClick={downloadImage}
                  className="bg-black/50 hover:bg-indigo-600 p-2 rounded text-white backdrop-blur border border-white/20 transition-colors"
                  title="Download Page"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
                </button>
             )}
             <button 
                onClick={() => {
                    setSelectedCharacters(page.characters_in_scene || []);
                    setSelectedProps(page.props_in_scene || []);
                    setIsEditing(!isEditing);
                }}
                className="bg-black/50 hover:bg-indigo-600 p-2 rounded text-white backdrop-blur border border-white/20 transition-colors"
                title={isEditing ? "Close Prompt" : "View/Edit Prompt & Characters"}
             >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path></svg>
             </button>
        </div>
      </div>

      {/* Editor Panel (Expandable) */}
      {isEditing && (
        <div className="p-3 bg-slate-800 border border-slate-600 rounded-lg animate-fade-in shadow-inner order-last">
          
          {/* Character Selector */}
          {characterSheet && characterSheet.length > 0 && (
             <div className="mb-3">
                 <label className="text-xs text-indigo-400 font-bold mb-1 block">INCLUDE CHARACTERS IN SCENE</label>
                 <div className="flex flex-wrap gap-2">
                     {characterSheet.map((char, i) => {
                         const isSelected = selectedCharacters.includes(char.name);
                         return (
                             <button
                                key={i}
                                onClick={() => toggleCharacter(char.name)}
                                className={`flex items-center space-x-1 px-2 py-1 rounded-full text-[10px] border transition-all ${isSelected ? 'bg-indigo-600 border-indigo-400 text-white' : 'bg-slate-900 border-slate-700 text-slate-400 hover:border-slate-500'}`}
                             >
                                 <div className="w-4 h-4 rounded-full bg-slate-700 overflow-hidden">
                                     {char.referenceImage ? <img src={char.referenceImage} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full bg-slate-600"/>}
                                 </div>
                                 <span className="truncate max-w-[80px]">{char.name}</span>
                                 {isSelected && <span>✓</span>}
                             </button>
                         )
                     })}
                 </div>
             </div>
          )}

          {/* Prop Selector */}
          {propSheet && propSheet.length > 0 && (
             <div className="mb-3">
                 <label className="text-xs text-indigo-400 font-bold mb-1 block">INCLUDE PROPS IN SCENE</label>
                 <div className="flex flex-wrap gap-2">
                     {propSheet.map((prop, i) => {
                         const isSelected = selectedProps.includes(prop.name);
                         return (
                             <button
                                key={i}
                                onClick={() => toggleProp(prop.name)}
                                className={`flex items-center space-x-1 px-2 py-1 rounded-full text-[10px] border transition-all ${isSelected ? 'bg-purple-600 border-purple-400 text-white' : 'bg-slate-900 border-slate-700 text-slate-400 hover:border-slate-500'}`}
                             >
                                 <div className="w-4 h-4 rounded bg-slate-700 overflow-hidden flex items-center justify-center">
                                     {prop.referenceImage ? <img src={prop.referenceImage} alt="" className="w-full h-full object-cover" /> : <div className="text-[8px]">📦</div>}
                                 </div>
                                 <span className="truncate max-w-[80px]">{prop.name}</span>
                                 {isSelected && <span>✓</span>}
                             </button>
                         )
                     })}
                 </div>
             </div>
          )}

          <label className="text-xs text-indigo-400 font-bold mb-1 block">FULL IMAGE PROMPT (Includes Text/Dialogue)</label>
          <textarea 
            className="w-full h-48 bg-slate-900 text-xs text-slate-300 p-2 rounded border border-slate-700 focus:border-indigo-500 focus:outline-none mb-3 font-mono leading-tight"
            value={promptDraft}
            onChange={(e) => setPromptDraft(e.target.value)}
          />

          {/* AI Refine Section */}
          <div className="bg-slate-900/50 p-2 rounded-md border border-slate-700 mb-3">
             <label className="text-xs text-indigo-300 font-bold mb-1 flex items-center">
               <span className="mr-1">✨</span> AI Refine Prompt
             </label>
             <div className="flex gap-2">
                <input 
                  type="text" 
                  value={refineInstruction}
                  onChange={(e) => setRefineInstruction(e.target.value)}
                  placeholder="e.g. 'Make the background darker' or 'Change layout to...'"
                  className="flex-grow bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-indigo-500"
                  onKeyDown={(e) => e.key === 'Enter' && handleRefine()}
                />
                <button 
                  onClick={handleRefine}
                  disabled={isRefining || !refineInstruction.trim()}
                  className="text-xs bg-indigo-700 hover:bg-indigo-600 disabled:bg-slate-700 disabled:text-slate-500 text-white px-3 py-1 rounded font-medium transition-colors"
                >
                  {isRefining ? '...' : 'Refine'}
                </button>
             </div>
             {refineError && <p className="text-[11px] text-red-400 mt-1.5">{refineError}</p>}
          </div>

          <div className="flex justify-end space-x-2">
            <button 
                onClick={() => setIsEditing(false)}
                className="text-xs text-slate-400 hover:text-white px-3 py-1"
            >
                Cancel
            </button>
            <button 
                onClick={handleSave}
                disabled={page.isGenerating || isRefining}
                className="text-xs bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 text-white px-3 py-1 rounded font-medium"
            >
                Redraw Page
            </button>
          </div>
        </div>
      )}

      {/* Info Section - Simplified since panels are removed */}
      <div className="bg-slate-800/50 rounded-lg border border-slate-700/50 p-4 flex-grow">
          {isCover ? (
            <div className="text-center py-6">
                <h3 className="text-xl font-bold text-white mb-2 tracking-wide">{page.title || "Untitled Comic"}</h3>
                <p className="text-sm text-slate-400">Written by TechManga AI</p>
                <div className="w-12 h-1 bg-gradient-to-r from-indigo-500 to-purple-500 mx-auto mt-4 rounded-full"></div>
            </div>
          ) : (
            <div className="h-full flex flex-col justify-between">
               <div>
                  <h4 className="text-xs font-bold text-slate-400 mb-2 uppercase tracking-wider flex items-center">
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-500 mr-2"></span>
                    Page Layout
                  </h4>
                  <p className="text-sm text-slate-300 italic leading-relaxed">
                     {page.layout_description}
                  </p>
               </div>
               
               {/* Characters in Scene Badge */}
               {(charsOnPage.length > 0 || propsOnPage.length > 0) && (
                 <div className="mt-3 flex flex-wrap gap-2">
                    {charsOnPage.map((char, i) => (
                      <div key={`c-${i}`} className="flex items-center bg-slate-900 border border-slate-700 rounded-full pr-2 overflow-hidden">
                        {char.referenceImage && <img src={char.referenceImage} alt="" className="w-5 h-5 object-cover" />}
                        <span className="text-[10px] text-slate-300 pl-1">{char.name}</span>
                      </div>
                    ))}
                    {propsOnPage.map((prop, i) => (
                      <div key={`p-${i}`} className="flex items-center bg-slate-900 border border-slate-700 rounded pr-2 overflow-hidden">
                        {prop.referenceImage ? <img src={prop.referenceImage} alt="" className="w-5 h-5 object-cover" /> : <span className="w-5 h-5 flex items-center justify-center text-[10px]">📦</span>}
                        <span className="text-[10px] text-slate-300 pl-1">{prop.name}</span>
                      </div>
                    ))}
                 </div>
               )}

               <div className="mt-4 pt-3 border-t border-slate-700/50">
                  <button 
                     onClick={() => {
                        setSelectedCharacters(page.characters_in_scene || []);
                        setSelectedProps(page.props_in_scene || []);
                        setIsEditing(!isEditing);
                     }}
                     className="text-xs text-indigo-400 hover:text-indigo-300 underline flex items-center"
                  >
                     <span>View Prompt & Dialogue</span>
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

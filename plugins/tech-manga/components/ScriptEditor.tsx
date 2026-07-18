
import React, { useState } from 'react';
import { ComicResponse, ComicPageScript, CharacterSheetItem, PropSheetItem } from '../types';
import { refineText } from '../services/mulbyAiService';

interface ScriptEditorProps {
  script: ComicResponse;
  characterSheet: CharacterSheetItem[];
  propSheet?: PropSheetItem[];
  onUpdate: (updatedScript: ComicResponse) => void;
  onContinue: () => void;
}

const ScriptEditor: React.FC<ScriptEditorProps> = ({ script, characterSheet, propSheet = [], onUpdate, onContinue }) => {
  const [activePageIdx, setActivePageIdx] = useState(0);
  const [refiningField, setRefiningField] = useState<string | null>(null);
  const [instruction, setInstruction] = useState('');

  const activePage = script.pages[activePageIdx];

  const handleTextChange = (field: 'analysis' | 'title', value: string) => {
    onUpdate({ ...script, [field]: value });
  };

  const handlePageChange = (pageIdx: number, field: keyof ComicPageScript, value: any) => {
    const newPages = [...script.pages];
    newPages[pageIdx] = { ...newPages[pageIdx], [field]: value };
    onUpdate({ ...script, pages: newPages });
  };

  const handleRefine = async (
    target: 'ANALYSIS' | 'COVER' | 'LAYOUT' | 'PROMPT', 
    currentText: string,
    pageIdx?: number
  ) => {
    if (!instruction.trim()) return;
    setRefiningField(target);

    try {
      // Build a richer context that includes Character Universe info
      const context = `
        Manga Title: ${script.title}. 
        Style: ${script.global_art_style}. 
        Universe Characters: ${script.character_sheet?.map(c => c.name).join(', ')}. 
        Story Analysis: ${script.analysis}.
        (IMPORTANT: Ensure all edits conform to the universe/lore of these characters)
      `.trim();

      const refined = await refineText(currentText, instruction, context);

      if (target === 'ANALYSIS') handleTextChange('analysis', refined);
      if (target === 'COVER') onUpdate({ ...script, cover_image_prompt: refined });
      if (target === 'LAYOUT' && pageIdx !== undefined) handlePageChange(pageIdx, 'layout_description', refined);
      if (target === 'PROMPT' && pageIdx !== undefined) handlePageChange(pageIdx, 'image_prompt', refined);

      setInstruction('');
    } catch (e) {
      console.error(e);
    } finally {
      setRefiningField(null);
    }
  };

  // Helper to find images
  const getCharImage = (name: string) => {
     const found = characterSheet?.find(c => c.name.includes(name) || name.includes(c.name));
     return found?.referenceImage;
  };
  const getPropImage = (name: string) => {
      const found = propSheet?.find(p => p.name.includes(name) || name.includes(p.name));
      return found?.referenceImage;
  };

  return (
    <div className="w-full h-full bg-slate-900 flex flex-col rounded-xl overflow-hidden border border-slate-700 shadow-2xl">
      {/* Header */}
      <div className="bg-slate-800 p-4 border-b border-slate-700 flex justify-between items-center">
        <div>
           <h2 className="text-xl font-bold text-white">Storyboard Editor</h2>
           <p className="text-xs text-slate-400">Review and refine the AI generated script before production.</p>
        </div>
        <button 
           onClick={onContinue}
           className="px-6 py-2 bg-green-600 hover:bg-green-500 text-white font-bold rounded-lg shadow-lg shadow-green-500/20 text-sm transition-all"
        >
           Start Comic Production →
        </button>
      </div>

      <div className="flex-grow flex overflow-hidden">
        
        {/* Sidebar: Navigation */}
        <div className="w-64 bg-slate-800/50 border-r border-slate-700 overflow-y-auto p-2 space-y-2">
           <div className="text-xs font-bold text-slate-500 uppercase px-2 mt-2">Global</div>
           <button 
             onClick={() => setActivePageIdx(-1)}
             className={`w-full text-left px-3 py-2 rounded text-sm ${activePageIdx === -1 ? 'bg-indigo-600 text-white' : 'text-slate-300 hover:bg-slate-700'}`}
           >
             Overview & Analysis
           </button>
           
           <div className="text-xs font-bold text-slate-500 uppercase px-2 mt-4">Pages</div>
           <button 
             onClick={() => setActivePageIdx(-2)}
             className={`w-full text-left px-3 py-2 rounded text-sm ${activePageIdx === -2 ? 'bg-indigo-600 text-white' : 'text-slate-300 hover:bg-slate-700'}`}
           >
             00. Cover Art
           </button>
           {script.pages.map((p, idx) => (
             <button
               key={p.page_number}
               onClick={() => setActivePageIdx(idx)}
               className={`w-full text-left px-3 py-2 rounded text-sm ${activePageIdx === idx ? 'bg-indigo-600 text-white' : 'text-slate-300 hover:bg-slate-700'}`}
             >
               {String(p.page_number).padStart(2, '0')}. Page Layout
             </button>
           ))}
        </div>

        {/* Main Content Area */}
        <div className="flex-1 overflow-y-auto p-6 bg-[#0f172a]">
           
           {/* GLOBAL ANALYSIS VIEW */}
           {activePageIdx === -1 && (
             <div className="space-y-6 max-w-3xl mx-auto animate-fade-in">
                <div className="space-y-2">
                   <label className="text-sm font-bold text-indigo-400">Comic Title</label>
                   <input 
                      className="w-full bg-slate-800 border border-slate-600 rounded p-2 text-white font-bold text-lg focus:border-indigo-500 outline-none"
                      value={script.title}
                      onChange={(e) => handleTextChange('title', e.target.value)}
                   />
                </div>
                <div className="space-y-2">
                   <label className="text-sm font-bold text-indigo-400">Story Analysis & Pacing Strategy</label>
                   <textarea 
                      className="w-full h-96 bg-slate-800 border border-slate-600 rounded p-4 text-slate-300 text-sm leading-relaxed focus:border-indigo-500 outline-none resize-none"
                      value={script.analysis}
                      onChange={(e) => handleTextChange('analysis', e.target.value)}
                   />
                   <RefineBox 
                     isLoading={refiningField === 'ANALYSIS'} 
                     onRefine={(instr) => handleRefine('ANALYSIS', script.analysis, -1)} 
                   />
                </div>
             </div>
           )}

           {/* COVER ART VIEW */}
           {activePageIdx === -2 && (
             <div className="space-y-6 max-w-3xl mx-auto animate-fade-in">
                <h3 className="text-lg font-bold text-white border-b border-slate-700 pb-2">Cover Art Design</h3>
                <div className="space-y-2">
                   <label className="text-sm font-bold text-indigo-400">Image Prompt</label>
                   <textarea 
                      className="w-full h-64 bg-slate-800 border border-slate-600 rounded p-4 text-slate-300 text-sm leading-relaxed focus:border-indigo-500 outline-none font-mono"
                      value={script.cover_image_prompt}
                      onChange={(e) => onUpdate({ ...script, cover_image_prompt: e.target.value })}
                   />
                   <RefineBox 
                     isLoading={refiningField === 'COVER'} 
                     onRefine={(instr) => handleRefine('COVER', script.cover_image_prompt, -1)} 
                   />
                </div>
             </div>
           )}

           {/* PAGE DETAIL VIEW */}
           {activePageIdx >= 0 && activePage && (
             <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-fade-in">
                
                {/* Editor Column */}
                <div className="lg:col-span-2 space-y-8">
                    <div className="flex justify-between items-end border-b border-slate-700 pb-2">
                        <h3 className="text-lg font-bold text-white">Page {activePage.page_number}</h3>
                    </div>

                    <div className="space-y-2">
                    <label className="text-sm font-bold text-indigo-400">Layout Description</label>
                    <textarea 
                        className="w-full h-32 bg-slate-800 border border-slate-600 rounded p-3 text-slate-300 text-sm leading-relaxed focus:border-indigo-500 outline-none resize-none"
                        value={activePage.layout_description}
                        onChange={(e) => handlePageChange(activePageIdx, 'layout_description', e.target.value)}
                    />
                    <RefineBox 
                        isLoading={refiningField === 'LAYOUT'} 
                        onRefine={(instr) => handleRefine('LAYOUT', activePage.layout_description, activePageIdx)} 
                    />
                    </div>

                    <div className="space-y-2">
                    <label className="text-sm font-bold text-indigo-400">Full Image Prompt (Includes Visual State & Dialogue)</label>
                    <p className="text-xs text-slate-500 mb-1">
                        This is the raw instruction sent to the image generator. It includes character states, environment details, and mandatory Chinese dialogue.
                    </p>
                    <textarea 
                        className="w-full h-80 bg-slate-800 border border-slate-600 rounded p-3 text-slate-300 text-xs leading-relaxed focus:border-indigo-500 outline-none font-mono"
                        value={activePage.image_prompt}
                        onChange={(e) => handlePageChange(activePageIdx, 'image_prompt', e.target.value)}
                    />
                    <RefineBox 
                        isLoading={refiningField === 'PROMPT'} 
                        onRefine={(instr) => handleRefine('PROMPT', activePage.image_prompt, activePageIdx)} 
                    />
                    </div>
                </div>

                {/* Info / Visual Column */}
                <div className="space-y-6">
                    <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
                        <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4">Characters in Scene</h4>
                        {activePage.characters_in_scene && activePage.characters_in_scene.length > 0 ? (
                             <div className="space-y-3">
                                {activePage.characters_in_scene.map((name, i) => (
                                    <div key={i} className="flex items-center space-x-3">
                                        <div className="w-10 h-10 rounded-full bg-slate-700 overflow-hidden border border-slate-600">
                                            {getCharImage(name) ? (
                                                <img src={getCharImage(name)} alt={name} className="w-full h-full object-cover" />
                                            ) : (
                                                <div className="w-full h-full flex items-center justify-center text-slate-500 text-xs">?</div>
                                            )}
                                        </div>
                                        <span className="text-sm text-slate-300 font-medium">{name}</span>
                                    </div>
                                ))}
                             </div>
                        ) : (
                            <p className="text-xs text-slate-500 italic">No specific characters listed for this scene.</p>
                        )}
                        
                        <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4 mt-6">Props in Scene</h4>
                         {activePage.props_in_scene && activePage.props_in_scene.length > 0 ? (
                             <div className="space-y-3">
                                {activePage.props_in_scene.map((name, i) => (
                                    <div key={i} className="flex items-center space-x-3">
                                        <div className="w-10 h-10 rounded bg-slate-700 overflow-hidden border border-slate-600 flex items-center justify-center">
                                            {getPropImage(name) ? (
                                                <img src={getPropImage(name)} alt={name} className="w-full h-full object-cover" />
                                            ) : (
                                                <div className="text-slate-500 text-xs">📦</div>
                                            )}
                                        </div>
                                        <span className="text-sm text-slate-300 font-medium">{name}</span>
                                    </div>
                                ))}
                             </div>
                        ) : (
                            <p className="text-xs text-slate-500 italic">No key props listed.</p>
                        )}

                    </div>
                </div>

             </div>
           )}

        </div>
      </div>
    </div>
  );
};

// Helper Sub-component for Refine Input
const RefineBox: React.FC<{ isLoading: boolean, onRefine: (instr: string) => void }> = ({ isLoading, onRefine }) => {
   const [val, setVal] = useState('');
   return (
     <div className="flex gap-2 mt-2 bg-slate-900/50 p-2 rounded border border-slate-700/50">
        <input 
           className="flex-grow bg-transparent text-xs text-white placeholder-slate-500 focus:outline-none"
           placeholder="Ask AI to refine this text (e.g., 'Make it more dramatic', 'Fix the dialogue')..."
           value={val}
           onChange={(e) => setVal(e.target.value)}
           onKeyDown={(e) => { if(e.key === 'Enter') { onRefine(val); setVal(''); } }}
        />
        <button 
           onClick={() => { onRefine(val); setVal(''); }}
           disabled={isLoading || !val.trim()}
           className="text-xs bg-indigo-700 hover:bg-indigo-600 disabled:bg-slate-700 text-white px-3 py-1 rounded"
        >
           {isLoading ? 'Refining...' : 'AI Refine'}
        </button>
     </div>
   )
}

export default ScriptEditor;

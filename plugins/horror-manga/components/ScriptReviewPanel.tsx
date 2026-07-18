import React, { useState, useRef, useEffect } from 'react';
import { ComicMetadata, CharacterSheetItem, ComicPageScript, AppConfig, OnTokenUpdate } from '../types';
import { refineText } from '../services/mulbyAiService';

interface ScriptReviewPanelProps {
  metadata: ComicMetadata;
  config: AppConfig;
  onUpdate: (newMetadata: ComicMetadata) => void;
  onConfirm: () => void;
  // New props for Casting integration
  onGenerateCharacterImage: (index: number) => Promise<void>;
  onUploadCharacterImage: (index: number, base64: string) => void;
  onTokenUpdate?: OnTokenUpdate;
}

type Tab = 'ANALYSIS' | 'CHARACTERS' | 'SCRIPT';

const ScriptReviewPanel: React.FC<ScriptReviewPanelProps> = ({ 
  metadata, 
  config, 
  onUpdate, 
  onConfirm,
  onGenerateCharacterImage,
  onUploadCharacterImage,
  onTokenUpdate
}) => {
  const [activeTab, setActiveTab] = useState<Tab>('ANALYSIS');
  const [refiningField, setRefiningField] = useState<string | null>(null);
  const [instruction, setInstruction] = useState("");
  
  // Track auto-generation attempts to prevent infinite loops if generation fails
  const autoGenAttempted = useRef<Set<number>>(new Set());
  
  const fileInputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Auto-generate character images when entering Characters tab
  useEffect(() => {
    if (activeTab === 'CHARACTERS') {
        metadata.characterSheet.forEach((char, idx) => {
            // Only generate if: 
            // 1. No image exists
            // 2. Not currently generating
            // 3. Haven't tried auto-generating this session (to avoid loops on error)
            if (!char.referenceImage && !char.isGenerating && !autoGenAttempted.current.has(idx)) {
                autoGenAttempted.current.add(idx);
                onGenerateCharacterImage(idx);
            }
        });
    }
  }, [activeTab, metadata.characterSheet, onGenerateCharacterImage]);

  const handleRefine = async (
    targetFieldId: string, 
    currentText: string, 
    onSuccess: (newText: string) => void,
    context: string
  ) => {
    if (!instruction.trim()) return;
    setRefiningField(targetFieldId);
    try {
        const refined = await refineText(
          currentText, 
          instruction, 
          context, 
          config,
          onTokenUpdate
        );
        onSuccess(refined);
        setInstruction("");
        setRefiningField(null);
    } catch (e) {
        console.error("Refinement failed", e);
        setRefiningField(null);
    }
  };

  const updateCharacter = (idx: number, field: keyof CharacterSheetItem, value: string) => {
      const newSheet = [...metadata.characterSheet];
      newSheet[idx] = { ...newSheet[idx], [field]: value };
      onUpdate({ ...metadata, characterSheet: newSheet });
  };

  const removeCharacter = (idx: number) => {
      const newSheet = metadata.characterSheet.filter((_, i) => i !== idx);
      onUpdate({ ...metadata, characterSheet: newSheet });
  };

  const addCharacter = () => {
      const newChar: CharacterSheetItem = { name: "New Character", description: "Describe appearance here..." };
      onUpdate({ ...metadata, characterSheet: [...metadata.characterSheet, newChar] });
  };

  const updatePage = (idx: number, field: keyof ComicPageScript, value: any) => {
      const newPages = [...metadata.rawPages];
      newPages[idx] = { ...newPages[idx], [field]: value };
      onUpdate({ ...metadata, rawPages: newPages });
  };
  
  const handleFileUpload = (index: number, e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (event) => {
        onUploadCharacterImage(index, event.target?.result as string);
      };
      reader.readAsDataURL(file);
  };

  // Explicitly trigger manual regeneration (resets the auto-gen guard)
  const handleManualGenerate = (idx: number) => {
      autoGenAttempted.current.add(idx); // Ensure marked so we don't auto-retry immediately if it fails
      onGenerateCharacterImage(idx);
  };

  return (
    <div className="bg-[#0f0e0e] rounded-xl border border-red-900/30 shadow-2xl flex flex-col h-[750px] overflow-hidden animate-fade-in">
        
        {/* Header */}
        <div className="bg-[#161b22] px-6 py-4 border-b border-red-900/30 flex justify-between items-center shrink-0">
            <h2 className="text-xl font-bold text-red-500 font-horror tracking-wider">Scriptorium & Casting</h2>
            <div className="flex space-x-2">
                <button onClick={() => setActiveTab('ANALYSIS')} className={`px-4 py-1.5 rounded-full text-xs font-bold transition-all ${activeTab === 'ANALYSIS' ? 'bg-red-900 text-white' : 'text-slate-500 hover:text-slate-300'}`}>GRIMOIRE</button>
                <button onClick={() => setActiveTab('CHARACTERS')} className={`px-4 py-1.5 rounded-full text-xs font-bold transition-all ${activeTab === 'CHARACTERS' ? 'bg-red-900 text-white' : 'text-slate-500 hover:text-slate-300'}`}>BESTIARY (CASTING)</button>
                <button onClick={() => setActiveTab('SCRIPT')} className={`px-4 py-1.5 rounded-full text-xs font-bold transition-all ${activeTab === 'SCRIPT' ? 'bg-red-900 text-white' : 'text-slate-500 hover:text-slate-300'}`}>SCRIPTURES</button>
            </div>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 scrollbar-thin scrollbar-thumb-slate-700">
            
            {/* --- ANALYSIS TAB --- */}
            {activeTab === 'ANALYSIS' && (
                <div className="space-y-4">
                    <div className="space-y-2">
                        <label className="text-xs font-bold text-slate-500 uppercase">Title (Raw)</label>
                        <input 
                            className="w-full bg-[#0a0a0a] border border-slate-700 rounded p-2 text-red-400 font-horror text-xl focus:border-red-500 focus:outline-none"
                            value={metadata.rawTitle}
                            onChange={(e) => onUpdate({...metadata, rawTitle: e.target.value})}
                        />
                    </div>
                    
                    <div className="space-y-2">
                        <div className="flex justify-between items-end">
                            <label className="text-xs font-bold text-slate-500 uppercase">Story Analysis & Pacing Strategy</label>
                            {refiningField === 'analysis' ? (
                                <span className="text-xs text-purple-400 animate-pulse">Whispering to the void...</span>
                            ) : (
                                <div className="flex items-center space-x-2">
                                    <input 
                                        type="text" 
                                        placeholder="AI Instruction (e.g. Make it darker)" 
                                        className="bg-[#0a0a0a] border border-slate-700 rounded px-2 py-1 text-xs text-slate-300 w-48 focus:border-purple-500 focus:outline-none"
                                        value={refiningField === null ? instruction : ""}
                                        onChange={(e) => setInstruction(e.target.value)}
                                    />
                                    <button 
                                        onClick={() => handleRefine('analysis', metadata.analysis, (txt) => onUpdate({...metadata, analysis: txt}), "Story Analysis")}
                                        className="text-purple-400 hover:text-purple-300 text-xs border border-purple-900 bg-purple-900/20 px-2 py-1 rounded"
                                    >
                                        AI Refine
                                    </button>
                                </div>
                            )}
                        </div>
                        <textarea 
                            className="w-full h-64 bg-[#0a0a0a] border border-slate-700 rounded p-4 text-sm text-slate-300 focus:border-red-900 focus:outline-none leading-relaxed font-mono"
                            value={metadata.analysis}
                            onChange={(e) => onUpdate({...metadata, analysis: e.target.value})}
                        />
                    </div>
                </div>
            )}

            {/* --- CHARACTERS (CASTING) TAB --- */}
            {activeTab === 'CHARACTERS' && (
                <div className="space-y-6">
                    <div className="flex justify-between items-center">
                        <p className="text-sm text-slate-400">Modify appearance descriptions. Reference images will generate automatically.</p>
                        <button onClick={addCharacter} className="text-xs bg-green-900/50 text-green-300 border border-green-800 px-3 py-1 rounded hover:bg-green-900">+ Add Entity</button>
                    </div>

                    <div className="grid grid-cols-1 gap-6">
                        {metadata.characterSheet.map((char, idx) => (
                            <div key={idx} className="bg-[#0a0a0a] border border-slate-700 rounded-lg p-4 flex flex-col md:flex-row gap-6">
                                
                                {/* Left Column: Reference Image */}
                                <div className="w-full md:w-1/3 flex flex-col gap-2">
                                    <div className="aspect-[3/4] bg-[#000] rounded border border-slate-800 overflow-hidden relative group">
                                        {char.isGenerating ? (
                                            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80">
                                                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-red-600 mb-2"></div>
                                                <span className="text-xs text-red-500 font-mono animate-pulse">SUMMONING...</span>
                                            </div>
                                        ) : char.referenceImage ? (
                                            <img src={char.referenceImage} alt={char.name} className="w-full h-full object-cover" />
                                        ) : (
                                            <div className="absolute inset-0 flex items-center justify-center text-slate-700">
                                                <span className="text-xs uppercase tracking-widest">No Visage</span>
                                            </div>
                                        )}
                                        
                                        {/* Overlay Controls */}
                                        <div className="absolute inset-0 bg-black/80 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-2">
                                            <button 
                                                onClick={() => handleManualGenerate(idx)}
                                                className="px-3 py-1 bg-red-900 hover:bg-red-800 text-white text-xs rounded border border-red-500/50 w-32"
                                            >
                                                {char.referenceImage ? "Regenerate" : "Generate"}
                                            </button>
                                            <button 
                                                onClick={() => fileInputRefs.current[idx]?.click()}
                                                className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-white text-xs rounded border border-slate-600 w-32"
                                            >
                                                Upload
                                            </button>
                                            <input 
                                                type="file"
                                                ref={el => { fileInputRefs.current[idx] = el; }}
                                                className="hidden"
                                                accept="image/*"
                                                onChange={(e) => handleFileUpload(idx, e)}
                                            />
                                        </div>
                                    </div>
                                    <div className="text-center">
                                         <span className={`text-[10px] uppercase font-bold ${char.referenceImage ? 'text-green-500' : 'text-slate-600'}`}>
                                             {char.referenceImage ? "• Reference Ready" : "• No Reference"}
                                         </span>
                                    </div>
                                </div>

                                {/* Right Column: Details & Edit */}
                                <div className="flex-1 space-y-4">
                                    <div className="flex gap-2">
                                        <div className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center text-xs text-slate-500 border border-slate-600 shrink-0">
                                            {idx + 1}
                                        </div>
                                        <input 
                                            className="flex-1 bg-[#161b22] border border-slate-700 rounded p-2 text-sm text-red-200 font-bold focus:border-red-500 focus:outline-none"
                                            value={char.name}
                                            onChange={(e) => updateCharacter(idx, 'name', e.target.value)}
                                            placeholder="Character Name"
                                        />
                                        <button onClick={() => removeCharacter(idx)} className="text-slate-600 hover:text-red-500 px-2">✕</button>
                                    </div>
                                    
                                    <div className="relative flex-1">
                                        <textarea 
                                            className="w-full h-40 bg-[#161b22] border border-slate-700 rounded p-3 text-xs text-slate-400 focus:border-slate-500 focus:outline-none leading-relaxed resize-none"
                                            value={char.description}
                                            onChange={(e) => updateCharacter(idx, 'description', e.target.value)}
                                            placeholder="Visual Description..."
                                        />
                                        <div className="absolute bottom-2 right-2 flex gap-1">
                                            {refiningField === `char_${idx}` ? (
                                                <span className="text-[10px] text-purple-400 animate-pulse bg-black/50 px-2 rounded">Refining...</span>
                                            ) : (
                                                <>
                                                    <input 
                                                        type="text" 
                                                        placeholder="AI Instruction..." 
                                                        className="bg-black/50 border border-slate-600 rounded px-2 py-0.5 text-[10px] text-slate-300 w-32 focus:border-purple-500 focus:outline-none"
                                                        value={refiningField === null ? instruction : ""}
                                                        onChange={(e) => setInstruction(e.target.value)}
                                                    />
                                                    <button 
                                                        onClick={() => handleRefine(`char_${idx}`, char.description, (txt) => updateCharacter(idx, 'description', txt), `Character: ${char.name}`)}
                                                        className="text-purple-300 hover:text-white text-[10px] bg-purple-900/50 border border-purple-800 px-2 py-0.5 rounded"
                                                    >
                                                        Refine
                                                    </button>
                                                </>
                                            )}
                                        </div>
                                    </div>

                                    <div className="bg-red-900/10 border border-red-900/20 p-2 rounded text-[10px] text-slate-500 italic">
                                        💡 Tip: Reference images are generating automatically. Modify description and Regenerate if needed.
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* --- SCRIPT TAB --- */}
            {activeTab === 'SCRIPT' && (
                <div className="space-y-8">
                     {/* Cover Prompt */}
                     <div className="bg-[#0a0a0a] border border-red-900/20 rounded p-4">
                        <div className="flex justify-between items-center mb-2">
                             <h3 className="text-sm font-bold text-red-500 uppercase">Cover Art Prompt</h3>
                             {refiningField === 'cover' ? (
                                 <span className="text-xs text-purple-400 animate-pulse">Refining...</span>
                             ) : (
                                 <div className="flex items-center space-x-2">
                                     <input 
                                        type="text" placeholder="Modify Instruction..." 
                                        className="bg-[#161b22] border border-slate-700 rounded px-2 py-1 text-xs text-slate-300 w-40"
                                        value={refiningField === null ? instruction : ""}
                                        onChange={(e) => setInstruction(e.target.value)}
                                     />
                                     <button 
                                        onClick={() => handleRefine('cover', metadata.coverPrompt, (txt) => onUpdate({...metadata, coverPrompt: txt}), "Cover Art")}
                                        className="text-purple-400 text-xs px-2"
                                     >AI Modify</button>
                                 </div>
                             )}
                        </div>
                        <textarea 
                            className="w-full h-24 bg-[#161b22] border border-slate-700 rounded p-2 text-xs text-slate-300 font-mono"
                            value={metadata.coverPrompt}
                            onChange={(e) => onUpdate({...metadata, coverPrompt: e.target.value})}
                        />
                     </div>

                     {/* Pages */}
                     {metadata.rawPages.map((page, idx) => (
                         <div key={idx} className="bg-[#0a0a0a] border border-slate-800 rounded p-4 space-y-3">
                             <div className="flex justify-between items-center border-b border-slate-800 pb-2">
                                 <h3 className="text-sm font-bold text-slate-300">Page {page.page_number}</h3>
                                 <span className="text-xs text-slate-600">{page.layout_description.substring(0, 50)}...</span>
                             </div>

                             <div className="space-y-1">
                                 <div className="flex justify-between">
                                     <label className="text-[10px] text-slate-500 uppercase">Image Prompt</label>
                                     <div className="flex items-center gap-1">
                                          {refiningField === `page_${idx}` ? (
                                              <span className="text-[10px] text-purple-400">Refining...</span>
                                          ) : (
                                              <>
                                                <input 
                                                    type="text" placeholder="Fix prompt..." 
                                                    className="bg-[#161b22] border border-slate-700 rounded px-1 py-0.5 text-[10px] w-24"
                                                    value={refiningField === null ? instruction : ""}
                                                    onChange={(e) => setInstruction(e.target.value)}
                                                />
                                                <button 
                                                    onClick={() => handleRefine(`page_${idx}`, page.image_prompt, (txt) => updatePage(idx, 'image_prompt', txt), `Page ${page.page_number}`)}
                                                    className="text-purple-400 hover:text-white text-[10px]"
                                                >AI</button>
                                              </>
                                          )}
                                     </div>
                                 </div>
                                 <textarea 
                                    className="w-full h-32 bg-[#161b22] border border-slate-700 rounded p-2 text-xs text-slate-300 font-mono"
                                    value={page.image_prompt}
                                    onChange={(e) => updatePage(idx, 'image_prompt', e.target.value)}
                                 />
                             </div>
                         </div>
                     ))}
                </div>
            )}

        </div>

        {/* Footer */}
        <div className="bg-[#161b22] px-6 py-4 border-t border-red-900/30 flex justify-end items-center space-x-4 shrink-0">
            <span className="text-xs text-slate-500 italic">Review character designs and script before final production.</span>
            <button 
                onClick={onConfirm}
                className="bg-red-900 hover:bg-red-800 text-white px-6 py-2 rounded-lg font-bold text-sm tracking-widest shadow-lg shadow-red-900/20 border border-red-700 transition-all flex items-center space-x-2"
            >
                <span>CONFIRM & START FILMING</span>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14 5l7 7m0 0l-7 7m7-7H3"></path></svg>
            </button>
        </div>

    </div>
  );
};

export default ScriptReviewPanel;
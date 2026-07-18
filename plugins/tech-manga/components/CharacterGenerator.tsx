
import React, { useState, useEffect, useRef } from 'react';
import { CharacterSheetItem, PropSheetItem } from '../types';
import { generateCharacterReference, generatePropReference, getAbortEpoch } from '../services/mulbyAiService';

interface CharacterGeneratorProps {
  characters: CharacterSheetItem[];
  props?: PropSheetItem[];
  style: string;
  mainCharacterName: string;
  storyMode: string;
  onUpdateCharacter: (index: number, updatedChar: CharacterSheetItem) => void;
  onUpdateProp?: (index: number, updatedProp: PropSheetItem) => void;
  onConfirm: () => void;
  onUsageCallback: (stat: any) => void;
}

const CharacterGenerator: React.FC<CharacterGeneratorProps> = ({ 
  characters, 
  props = [],
  style, 
  mainCharacterName,
  storyMode,
  onUpdateCharacter,
  onUpdateProp,
  onConfirm,
  onUsageCallback
}) => {
  const [activeTab, setActiveTab] = useState<'CHARACTERS' | 'PROPS'>('CHARACTERS');

  const [generatingStates, setGeneratingStates] = useState<Record<string, boolean>>({});
  const [errorStates, setErrorStates] = useState<Record<string, string>>({});
  
  const initializedRef = useRef(false);
  const charactersRef = useRef(characters);
  const propsRef = useRef(props);
  // 方案 2.6：单飞去重——自动循环与手动按钮共享同一在途集合，同一资产至多一个在途请求
  const inFlightRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    charactersRef.current = characters;
    propsRef.current = props;
  }, [characters, props]);

  // Auto-generate missing character references on mount, SEQUENTIALLY
  useEffect(() => {
    const generateSequentially = async () => {
        if (initializedRef.current) return;
        initializedRef.current = true;

        // 捕获当前中止纪元；用户点击「中止全部任务」后纪元变化，队列停止推进
        const epoch = getAbortEpoch();

        // 1. Characters
        const charIndices = charactersRef.current
            .map((c, i) => (!c.referenceImage ? i : -1))
            .filter(i => i !== -1);

        // 中止时给剩余缺图项标注可见状态（方案 2.6 可选项），避免静默停止
        const markRemainingAborted = (kind: 'char' | 'prop', remaining: number[]) => {
            setErrorStates(prev => {
                const next = { ...prev };
                remaining.forEach(i => { next[`${kind}-${i}`] = "已被用户中止"; });
                return next;
            });
        };

        for (let n = 0; n < charIndices.length; n++) {
             if (getAbortEpoch() !== epoch) {
                 markRemainingAborted('char', charIndices.slice(n));
                 return;
             }
             const idx = charIndices[n];
             const currentChar = charactersRef.current[idx];
             if (currentChar && !currentChar.referenceImage) {
                 await handleGenerateCharacter(idx, currentChar);
                 await new Promise(r => setTimeout(r, 800));
             }
        }

        // 2. Props (Only if props exist)
        if (propsRef.current.length > 0 && onUpdateProp) {
            const propIndices = propsRef.current
                .map((p, i) => (!p.referenceImage ? i : -1))
                .filter(i => i !== -1);

            for (let n = 0; n < propIndices.length; n++) {
                if (getAbortEpoch() !== epoch) {
                    markRemainingAborted('prop', propIndices.slice(n));
                    return;
                }
                const idx = propIndices[n];
                const currentProp = propsRef.current[idx];
                if (currentProp && !currentProp.referenceImage) {
                    await handleGenerateProp(idx, currentProp);
                    await new Promise(r => setTimeout(r, 800));
                }
            }
        }
    };

    const timer = setTimeout(() => {
        generateSequentially();
    }, 500);

    return () => clearTimeout(timer);
  }, []); 

  const handleGenerateCharacter = async (index: number, char: CharacterSheetItem) => {
    const key = `char-${index}`;
    if (inFlightRef.current.has(key)) return;   // 去重：该资产已在生成
    inFlightRef.current.add(key);
    setGeneratingStates(prev => ({ ...prev, [key]: true }));
    setErrorStates(prev => ({ ...prev, [key]: '' }));

    try {
      const imageData = await generateCharacterReference(char.name, char.description, style, onUsageCallback);
      onUpdateCharacter(index, { ...char, referenceImage: imageData });
    } catch (err: any) {
      setErrorStates(prev => ({ ...prev, [key]: err?.name === 'AbortError' ? "已被用户中止" : (err.message || "Generation failed") }));
    } finally {
      inFlightRef.current.delete(key);
      setGeneratingStates(prev => ({ ...prev, [key]: false }));
    }
  };

  const handleGenerateProp = async (index: number, prop: PropSheetItem) => {
    if (!onUpdateProp) return;
    const key = `prop-${index}`;
    if (inFlightRef.current.has(key)) return;   // 去重：该资产已在生成
    inFlightRef.current.add(key);
    setGeneratingStates(prev => ({ ...prev, [key]: true }));
    setErrorStates(prev => ({ ...prev, [key]: '' }));

    try {
      // Pass mainCharacterName and storyMode to ensure consistent universe style
      const imageData = await generatePropReference(prop.name, prop.description, style, mainCharacterName, storyMode, onUsageCallback);
      onUpdateProp(index, { ...prop, referenceImage: imageData });
    } catch (err: any) {
      setErrorStates(prev => ({ ...prev, [key]: err?.name === 'AbortError' ? "已被用户中止" : (err.message || "Generation failed") }));
    } finally {
      inFlightRef.current.delete(key);
      setGeneratingStates(prev => ({ ...prev, [key]: false }));
    }
  };

  const handleFileUpload = (type: 'char' | 'prop', index: number, e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      
      const reader = new FileReader();
      reader.onload = (event) => {
          const result = event.target?.result as string;
          if (type === 'char') {
             onUpdateCharacter(index, { ...characters[index], referenceImage: result });
          } else if (type === 'prop' && onUpdateProp) {
             onUpdateProp(index, { ...props[index], referenceImage: result });
          }
      };
      reader.readAsDataURL(file);
  };

  return (
    <div className="w-full space-y-6 animate-fade-in">
      
      <div className="text-center space-y-2 mb-6">
         <h2 className="text-2xl font-bold text-white">Asset Studio</h2>
         <p className="text-slate-400 text-sm">Review definitions and generate consistent reference images for characters and items.</p>
      </div>
      
      {/* Asset Tabs */}
      <div className="flex justify-center space-x-4 mb-8">
        <button 
            onClick={() => setActiveTab('CHARACTERS')}
            className={`px-4 py-2 rounded-full text-sm font-bold transition-all ${activeTab === 'CHARACTERS' ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}
        >
            Characters ({characters.length})
        </button>
        <button 
            onClick={() => setActiveTab('PROPS')}
            className={`px-4 py-2 rounded-full text-sm font-bold transition-all ${activeTab === 'PROPS' ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}
        >
            Key Props / Items ({props.length})
        </button>
      </div>

      {activeTab === 'CHARACTERS' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 animate-fade-in">
            {characters.map((char, idx) => (
            <div key={idx} className="bg-slate-800 rounded-lg border border-slate-700 p-4 flex flex-col space-y-4 shadow-lg hover:border-indigo-500/50 transition-colors">
                <div className="flex items-center justify-between">
                    <h3 className="font-bold text-lg text-white truncate">{char.name}</h3>
                    <span className="text-xs text-slate-500 font-mono">CHAR #{idx + 1}</span>
                </div>
                <div className="relative aspect-[3/4] bg-black/40 rounded-md overflow-hidden border border-slate-600 group">
                    {char.referenceImage ? (
                        <img src={char.referenceImage} alt={char.name} className="w-full h-full object-cover" />
                    ) : (
                        <div className="w-full h-full flex items-center justify-center flex-col text-slate-500">
                            <span className="text-3xl mb-2">👤</span>
                            <span className="text-xs">No Reference</span>
                        </div>
                    )}
                    {generatingStates[`char-${idx}`] && (
                        <div className="absolute inset-0 bg-slate-900/80 flex items-center justify-center flex-col z-10">
                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500 mb-2"></div>
                            <span className="text-xs text-indigo-300">Generating...</span>
                        </div>
                    )}
                    {errorStates[`char-${idx}`] && (
                        <div className="absolute inset-0 bg-red-900/90 flex items-center justify-center p-2 text-center z-10">
                            <span className="text-xs text-red-200">{errorStates[`char-${idx}`]}</span>
                        </div>
                    )}
                </div>
                <textarea 
                className="w-full h-24 bg-slate-900 border border-slate-700 rounded p-2 text-xs text-slate-300 resize-none focus:outline-none focus:border-indigo-500"
                value={char.description}
                onChange={(e) => onUpdateCharacter(idx, { ...char, description: e.target.value })}
                placeholder="Required: 'From [Series Name]'. e.g. 'From Doraemon, a blue robot cat...'"
                />
                <div className="flex flex-col space-y-2 pt-2">
                    <button 
                    onClick={() => handleGenerateCharacter(idx, char)}
                    disabled={generatingStates[`char-${idx}`]}
                    className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 text-white text-xs font-bold rounded shadow-lg shadow-indigo-500/20 transition-all"
                    >
                    {char.referenceImage ? "Regenerate Reference" : "Generate Reference"}
                    </button>
                    <div className="flex justify-center">
                        <label className="cursor-pointer text-xs text-slate-500 hover:text-slate-300 flex items-center space-x-1">
                            <span>Upload Custom Image</span>
                            <input type="file" className="hidden" accept="image/*" onChange={(e) => handleFileUpload('char', idx, e)} />
                        </label>
                    </div>
                </div>
            </div>
            ))}
        </div>
      )}

      {activeTab === 'PROPS' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 animate-fade-in">
             {props.length === 0 && (
                 <div className="col-span-full text-center py-12 text-slate-500">
                     <p>No key props identified in the script.</p>
                     <p className="text-xs mt-2">The AI didn't find specific recurring items needed for consistency.</p>
                 </div>
             )}
             {props.map((prop, idx) => (
                <div key={idx} className="bg-slate-800 rounded-lg border border-slate-700 p-4 flex flex-col space-y-4 shadow-lg hover:border-purple-500/50 transition-colors">
                    <div className="flex items-center justify-between">
                        <h3 className="font-bold text-lg text-white truncate">{prop.name}</h3>
                        <span className="text-xs text-slate-500 font-mono">PROP #{idx + 1}</span>
                    </div>
                    <div className="relative aspect-square bg-black/40 rounded-md overflow-hidden border border-slate-600 group">
                        {prop.referenceImage ? (
                            <img src={prop.referenceImage} alt={prop.name} className="w-full h-full object-contain p-2" />
                        ) : (
                            <div className="w-full h-full flex items-center justify-center flex-col text-slate-500">
                                <span className="text-3xl mb-2">📦</span>
                                <span className="text-xs">No Reference</span>
                            </div>
                        )}
                        {generatingStates[`prop-${idx}`] && (
                            <div className="absolute inset-0 bg-slate-900/80 flex items-center justify-center flex-col z-10">
                                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500 mb-2"></div>
                                <span className="text-xs text-indigo-300">Generating...</span>
                            </div>
                        )}
                         {errorStates[`prop-${idx}`] && (
                            <div className="absolute inset-0 bg-red-900/90 flex items-center justify-center p-2 text-center z-10">
                                <span className="text-xs text-red-200">{errorStates[`prop-${idx}`]}</span>
                            </div>
                        )}
                    </div>
                    <textarea 
                        className="w-full h-24 bg-slate-900 border border-slate-700 rounded p-2 text-xs text-slate-300 resize-none focus:outline-none focus:border-purple-500"
                        value={prop.description}
                        onChange={(e) => onUpdateProp && onUpdateProp(idx, { ...prop, description: e.target.value })}
                        placeholder="Prop visual description..."
                    />
                    <div className="flex flex-col space-y-2 pt-2">
                        <button 
                            onClick={() => handleGenerateProp(idx, prop)}
                            disabled={generatingStates[`prop-${idx}`]}
                            className="w-full py-2 bg-purple-600 hover:bg-purple-500 disabled:bg-slate-700 text-white text-xs font-bold rounded shadow-lg shadow-purple-500/20 transition-all"
                        >
                        {prop.referenceImage ? "Regenerate Prop" : "Generate Prop"}
                        </button>
                        <div className="flex justify-center">
                            <label className="cursor-pointer text-xs text-slate-500 hover:text-slate-300 flex items-center space-x-1">
                                <span>Upload Custom Image</span>
                                <input type="file" className="hidden" accept="image/*" onChange={(e) => handleFileUpload('prop', idx, e)} />
                            </label>
                        </div>
                    </div>
                </div>
             ))}
        </div>
      )}

      <div className="flex justify-center pt-8 border-t border-slate-800">
         <button 
            onClick={onConfirm}
            className="px-12 py-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold text-lg rounded-xl shadow-lg shadow-indigo-500/20 transform hover:-translate-y-1 transition-all flex items-center"
         >
            Save & Go to Script Editor →
         </button>
      </div>

    </div>
  );
};

export default CharacterGenerator;

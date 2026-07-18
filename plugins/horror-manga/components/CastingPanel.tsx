
import React, { useRef } from 'react';
import { CharacterSheetItem } from '../types';

interface CastingPanelProps {
  characters: CharacterSheetItem[];
  onRegenerateCharacter: (index: number) => void;
  onUpdateCharacterImage: (index: number, base64Image: string) => void;
  onConfirm: () => void;
}

const CastingPanel: React.FC<CastingPanelProps> = ({ 
  characters, 
  onRegenerateCharacter, 
  onUpdateCharacterImage, 
  onConfirm 
}) => {
  const fileRefs = useRef<(HTMLInputElement | null)[]>([]);

  const handleFileUpload = (index: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      onUpdateCharacterImage(index, event.target?.result as string);
    };
    reader.readAsDataURL(file);
  };

  // Check if any character is still generating
  const isAnyGenerating = characters.some(c => c.isGenerating);
  const allHaveImages = characters.every(c => c.referenceImage);

  return (
    <div className="bg-[#0f0e0e] p-6 rounded-xl border border-red-900/30 shadow-2xl shadow-red-900/10 space-y-6 animate-fade-in">
      
      <div className="flex items-center justify-between border-b border-red-900/30 pb-4">
        <div className="flex items-center space-x-2">
           <span className="text-2xl">🎭</span>
           <h2 className="text-xl font-bold text-red-500 font-horror tracking-wider">Casting Ritual</h2>
        </div>
        <p className="text-xs text-slate-500 uppercase tracking-widest">Establish Character Consistency</p>
      </div>

      <p className="text-sm text-slate-400">
        The spirits have manifested these forms. Review the cast before binding them to the pages.
        You may re-summon (regenerate) or offer your own vessels (upload images).
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {characters.map((char, idx) => (
          <div key={idx} className="bg-[#1a0505] border border-red-900/30 rounded-lg overflow-hidden flex flex-col">
             {/* Character Image Area */}
             <div className="relative aspect-[3/4] bg-black group">
                {char.isGenerating ? (
                   <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-red-600 mb-2"></div>
                      <span className="text-xs text-red-500 font-mono animate-pulse">SUMMONING...</span>
                   </div>
                ) : char.referenceImage ? (
                   <img 
                     src={char.referenceImage} 
                     alt={char.name} 
                     className="w-full h-full object-cover object-top"
                   />
                ) : (
                   <div className="absolute inset-0 flex items-center justify-center text-slate-700">
                      <span>No Visage</span>
                   </div>
                )}
                
                {/* Overlay Actions */}
                {!char.isGenerating && (
                    <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-3 p-4">
                       <button 
                         onClick={() => onRegenerateCharacter(idx)}
                         className="px-4 py-2 bg-red-900/80 hover:bg-red-800 text-white text-xs rounded border border-red-500/50 w-full"
                       >
                         Redraw
                       </button>
                       <button 
                         onClick={() => fileRefs.current[idx]?.click()}
                         className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white text-xs rounded border border-slate-600 w-full"
                       >
                         Upload Image
                       </button>
                       <input 
                         type="file" 
                         ref={(el) => { fileRefs.current[idx] = el; }}
                         className="hidden"
                         accept="image/*"
                         onChange={(e) => handleFileUpload(idx, e)}
                       />
                    </div>
                )}
             </div>

             {/* Info */}
             <div className="p-3 border-t border-red-900/20 bg-[#0d0d0d] flex-grow">
                <h3 className="text-red-400 font-bold text-sm uppercase mb-1">{char.name}</h3>
                <p className="text-xs text-slate-500 line-clamp-3 leading-relaxed">{char.description}</p>
             </div>
          </div>
        ))}
      </div>

      <div className="pt-4 border-t border-red-900/30 flex justify-end">
         <button
           onClick={onConfirm}
           disabled={isAnyGenerating || !allHaveImages}
           className={`px-8 py-3 rounded-lg font-bold text-sm tracking-widest shadow-xl transition-all font-horror flex items-center space-x-2
             ${isAnyGenerating || !allHaveImages
               ? 'bg-slate-900 text-slate-600 cursor-not-allowed border border-slate-800' 
               : 'bg-red-900 hover:bg-red-800 text-white border border-red-700 shadow-red-900/50 animate-pulse'
             }`}
         >
           <span>CONFIRM CAST & START FILMING</span>
           <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14 5l7 7m0 0l-7 7m7-7H3"></path></svg>
         </button>
      </div>

    </div>
  );
};

export default CastingPanel;

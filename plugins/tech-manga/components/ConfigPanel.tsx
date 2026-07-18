

import React, { ChangeEvent, useRef, useEffect, useState } from 'react';
import { AppConfig, CharacterProfile, StoryMode } from '../types';
import { PRESET_CHARACTERS, STYLE_OPTIONS, ASPECT_RATIOS, STORY_MODES, PAGE_LENGTH_OPTIONS } from '../constants';

interface MulbyModelOption {
  id: string;
  label?: string;
}

interface ConfigPanelProps {
  config: AppConfig;
  onChange: (newConfig: AppConfig) => void;
  onGenerate: () => void;
  isLoading: boolean;
}

const ConfigPanel: React.FC<ConfigPanelProps> = ({ config, onChange, onGenerate, isLoading }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Mulby AI 模型列表（模型与密钥由 Mulby 宿主统一管理）
  const [textModels, setTextModels] = useState<MulbyModelOption[]>([]);
  const [imageModels, setImageModels] = useState<MulbyModelOption[]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);

  useEffect(() => {
    const ai = (window as Window).mulby?.ai;
    if (!ai) {
      setModelsLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const [allModels, imgModels] = await Promise.all([
          ai.allModels(),
          ai.allModels({ endpointType: 'image-generation' })
        ]);
        if (cancelled) return;
        const imgIds = new Set((imgModels || []).map((m: MulbyModelOption) => m.id));
        // 文本模型：排除纯图像生成模型
        setTextModels((allModels || []).filter((m: MulbyModelOption) => !imgIds.has(m.id)));
        setImageModels(imgModels || []);
      } catch (e) {
        console.error('Failed to load Mulby AI models', e);
      } finally {
        if (!cancelled) setModelsLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Define the special "Auto-detect" character profile
  const AUTO_DETECT_CHAR: CharacterProfile = {
      name: "Auto-detect (Historical Figures)",
      description: "Characters will be automatically identified from the historical source text."
  };

  const handleInputChange = (field: keyof AppConfig, value: any) => {
    // Logic to enforce Auto-detect character when switching TO Serious History
    if (field === 'storyMode') {
        if (value === StoryMode.HISTORY_SERIOUS) {
            onChange({ ...config, storyMode: value, character: AUTO_DETECT_CHAR });
            return;
        } else if (config.storyMode === StoryMode.HISTORY_SERIOUS && value !== StoryMode.HISTORY_SERIOUS) {
            // Switching FROM Serious History -> Reset to first preset if it's currently Auto
            onChange({ ...config, storyMode: value, character: PRESET_CHARACTERS[0] });
            return;
        }
    }
    onChange({ ...config, [field]: value });
  };

  const handleCharacterChange = (e: ChangeEvent<HTMLSelectElement>) => {
    const selectedName = e.target.value;
    if (selectedName === 'custom') {
      handleInputChange('character', { name: '', description: '' });
    } else if (selectedName === 'auto') {
      handleInputChange('character', AUTO_DETECT_CHAR);
    } else {
      const char = PRESET_CHARACTERS.find(c => c.name === selectedName);
      if (char) handleInputChange('character', char);
    }
  };

  const handleFileUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      handleInputChange('sourceText', text);
    };
    reader.readAsText(file);
  };

  const isCustomChar = !PRESET_CHARACTERS.some(c => c.name === config.character.name) && config.character.name !== AUTO_DETECT_CHAR.name;
  const isCustomStory = config.storyMode === StoryMode.CUSTOM;
  const isSeriousHistory = config.storyMode === StoryMode.HISTORY_SERIOUS;

  return (
    <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 shadow-xl space-y-6">
      
      {/* Header */}
      <div className="flex items-center space-x-2 border-b border-slate-700 pb-4">
        <span className="text-2xl">⚡</span>
        <h2 className="text-xl font-bold text-white">Story Configuration</h2>
      </div>

      {/* AI 模型选择（由 Mulby 宿主提供模型与密钥） */}
      <div className="bg-slate-900/50 p-3 rounded-lg space-y-3 border border-slate-700/50">
        {modelsLoading ? (
            <p className="text-xs text-slate-500 animate-pulse">正在从 Mulby 加载模型列表...</p>
        ) : (
            <>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="space-y-1">
                        <label className="text-xs text-slate-500">文本模型（剧本 / 润色）</label>
                        <select
                            className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-sm text-white focus:ring-2 focus:ring-indigo-500"
                            value={config.textModel || ''}
                            onChange={(e) => handleInputChange('textModel', e.target.value)}
                        >
                            <option value="">Mulby 默认模型</option>
                            {textModels.map(m => (
                                <option key={m.id} value={m.id}>{m.label || m.id}</option>
                            ))}
                        </select>
                    </div>
                    <div className="space-y-1">
                        <label className="text-xs text-slate-500">图像模型（角色 / 道具 / 页面）</label>
                        <select
                            className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-sm text-white focus:ring-2 focus:ring-indigo-500"
                            value={config.imageModel || ''}
                            onChange={(e) => handleInputChange('imageModel', e.target.value)}
                        >
                            <option value="">自动（第一个图像生成模型）</option>
                            {imageModels.map(m => (
                                <option key={m.id} value={m.id}>{m.label || m.id}</option>
                            ))}
                        </select>
                    </div>
                </div>
                {imageModels.length === 0 && (
                    <p className="text-[10px] text-yellow-500">
                        未找到图像生成模型。请在 Mulby 设置 → AI → 模型管理中添加端点类型为「图像生成」的模型。
                    </p>
                )}
            </>
        )}
      </div>

      {/* Input Area */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-slate-400 flex justify-between">
          <span>Source Content (Text/Code)</span>
          <button 
            onClick={() => fileInputRef.current?.click()}
            className="text-indigo-400 hover:text-indigo-300 text-xs underline"
          >
            Upload .txt/.md
          </button>
        </label>
        <textarea
          className="w-full h-32 bg-slate-900 border border-slate-700 rounded-lg p-3 text-sm text-slate-200 focus:ring-2 focus:ring-indigo-500 focus:outline-none resize-none"
          placeholder={isSeriousHistory ? "Paste historical event description or biography..." : "Paste your technical documentation, code snippet, or article here..."}
          value={config.sourceText}
          onChange={(e) => handleInputChange('sourceText', e.target.value)}
        />
        <input 
          type="file" 
          ref={fileInputRef} 
          className="hidden" 
          accept=".txt,.md" 
          onChange={handleFileUpload}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        
        {/* Style Selection */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-slate-400">Comic Style</label>
          <select
            className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-sm text-white focus:ring-2 focus:ring-indigo-500"
            value={config.style}
            onChange={(e) => handleInputChange('style', e.target.value)}
          >
            {STYLE_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
            <option value="custom">Custom Style...</option>
          </select>
        </div>

        {/* Story Mode Selection */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-slate-400">Story Mode</label>
          <select
            className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-sm text-white focus:ring-2 focus:ring-indigo-500"
            value={config.storyMode}
            onChange={(e) => handleInputChange('storyMode', e.target.value)}
          >
            {STORY_MODES.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

      </div>

      {/* Custom Story Prompt */}
      {isCustomStory && (
        <div className="space-y-2 animate-fade-in">
          <label className="text-sm font-medium text-indigo-400">Custom Story Rules</label>
          <textarea
            className="w-full h-24 bg-slate-900 border border-indigo-500/50 rounded-lg p-3 text-sm text-slate-200 focus:ring-2 focus:ring-indigo-500 focus:outline-none resize-none"
            placeholder="Describe your custom narrative rules (e.g. 'A Noir Detective story where bugs are crimes...')"
            value={config.customStoryPrompt || ''}
            onChange={(e) => handleInputChange('customStoryPrompt', e.target.value)}
          />
        </div>
      )}

      {/* Character Selection (Moved to full width below style/mode) */}
      <div className="space-y-2">
          <label className="text-sm font-medium text-slate-400">Main Character</label>
          <div className="relative">
            <select
                className={`w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-sm text-white focus:ring-2 focus:ring-indigo-500 ${isSeriousHistory ? 'opacity-50 cursor-not-allowed' : ''}`}
                value={config.character.name === AUTO_DETECT_CHAR.name ? 'auto' : (isCustomChar ? 'custom' : config.character.name)}
                onChange={handleCharacterChange}
                disabled={isSeriousHistory}
            >
                {/* Special Auto option used for display state */}
                <option value="auto">👥 Auto-detect Historical Figures</option>
                
                <option value="" disabled>Select a Character</option>
                {PRESET_CHARACTERS.map(c => (
                <option key={c.name} value={c.name}>{c.name}</option>
                ))}
                <option value="custom">Custom Character...</option>
            </select>
            {isSeriousHistory && (
                <div className="absolute top-0 right-0 h-full flex items-center pr-8 pointer-events-none">
                     <span className="text-xs text-yellow-500 font-bold bg-yellow-900/40 px-2 py-0.5 rounded">AUTO-CAST ACTIVE</span>
                </div>
            )}
          </div>
          {isSeriousHistory && (
              <p className="text-[10px] text-slate-500">
                  * In Serious History mode, characters are automatically extracted from the source text to ensure historical accuracy.
              </p>
          )}
        </div>

      {/* Custom Character Inputs */}
      {isCustomChar && !isSeriousHistory && (
        <div className="bg-slate-900/50 p-3 rounded-lg space-y-3 border border-slate-700/50">
           <div>
             <label className="text-xs text-slate-500">Character Name</label>
             <input 
                type="text"
                className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-sm text-white"
                value={config.character.name}
                onChange={(e) => handleInputChange('character', {...config.character, name: e.target.value})}
             />
           </div>
           <div>
             <label className="text-xs text-slate-500">Visual Description (Hair, Clothes, Vibe)</label>
             <textarea 
                className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-sm text-white h-16 resize-none"
                value={config.character.description}
                onChange={(e) => handleInputChange('character', {...config.character, description: e.target.value})}
             />
           </div>
        </div>
      )}

      {/* Length and Density Controls */}
      <div className="grid grid-cols-2 gap-4">
         {/* Page Length */}
         <div className="space-y-2">
            <label className="text-sm font-medium text-slate-400">Page Length</label>
            <select
                className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-sm text-white focus:ring-2 focus:ring-indigo-500"
                value={config.totalPages}
                onChange={(e) => handleInputChange('totalPages', e.target.value)}
            >
                {PAGE_LENGTH_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
            </select>
        </div>

        {/* Panel Density */}
        <div className="space-y-2">
            <label className="text-sm font-medium text-slate-400">Panels per Page</label>
            <select
                className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-sm text-white focus:ring-2 focus:ring-indigo-500"
                value={config.panelCount}
                onChange={(e) => handleInputChange('panelCount', Number(e.target.value))}
            >
                <option value={0}>Auto</option>
                <option value={3}>3 Panels</option>
                <option value={4}>4 Panels</option>
                <option value={6}>6 Panels</option>
            </select>
        </div>
      </div>
      
      {/* Aspect Ratio */}
      <div className="space-y-2">
            <label className="text-sm font-medium text-slate-400">Format Ratio</label>
            <select
                className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-sm text-white focus:ring-2 focus:ring-indigo-500"
                value={config.aspectRatio}
                onChange={(e) => handleInputChange('aspectRatio', e.target.value)}
            >
                {ASPECT_RATIOS.map(r => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                ))}
            </select>
        </div>

      <button
        onClick={onGenerate}
        disabled={isLoading || !config.sourceText.trim() || (!config.character.name && !isSeriousHistory)}
        className={`w-full py-4 rounded-lg font-bold text-lg tracking-wide shadow-lg transition-all 
          ${isLoading || !config.sourceText.trim() 
            ? 'bg-slate-700 text-slate-500 cursor-not-allowed' 
            : 'bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white shadow-indigo-500/30'
          }`}
      >
        {isLoading ? (
          <span className="flex items-center justify-center space-x-2">
            <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <span>Dreaming up your comic...</span>
          </span>
        ) : (
          "GENERATE COMIC"
        )}
      </button>

    </div>
  );
};

export default ConfigPanel;


import React, { ChangeEvent, useEffect, useRef, useState } from 'react';
import { AppConfig, WatermarkType } from '../types';
import { STYLE_OPTIONS, ASPECT_RATIOS, STORY_MODES, PAGE_LENGTH_OPTIONS, WATERMARK_TYPE_OPTIONS, ENDING_TYPE_OPTIONS, COLOR_MODE_OPTIONS } from '../constants';

interface MulbyModelOption {
  id: string;
  label?: string;
}

interface ConfigPanelProps {
  config: AppConfig;
  onChange: (newConfig: AppConfig) => void;
  onGenerate: () => void;
  onCancel: () => void;
  isLoading: boolean;
}

const ConfigPanel: React.FC<ConfigPanelProps> = ({ config, onChange, onGenerate, onCancel, isLoading }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const watermarkImgRef = useRef<HTMLInputElement>(null);
  const [showWatermark, setShowWatermark] = useState(false);
  const [showApiSettings, setShowApiSettings] = useState(false);

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

  const handleInputChange = (field: keyof AppConfig, value: any) => {
    onChange({ ...config, [field]: value });
  };

  const handleWatermarkChange = (field: string, value: any) => {
    onChange({
      ...config,
      watermark: { ...config.watermark, [field]: value }
    });
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

  const handleWatermarkImageUpload = (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (event) => {
        handleWatermarkChange('image', event.target?.result as string);
      };
      reader.readAsDataURL(file);
  };

  return (
    <div className="bg-[#0f0e0e] p-6 rounded-xl border border-red-900/30 shadow-2xl shadow-red-900/10 space-y-6">
      
      {/* Header */}
      <div className="flex items-center space-x-2 border-b border-red-900/30 pb-4">
        <span className="text-2xl">🩸</span>
        <h2 className="text-xl font-bold text-red-500 font-horror tracking-wider">Ritual Configuration</h2>
      </div>

      {/* AI 模型选择（由 Mulby 宿主提供模型与密钥） */}
      <div className="border border-red-900/20 rounded-lg bg-[#0a0a0a] overflow-hidden">
        <button
           onClick={() => setShowApiSettings(!showApiSettings)}
           className="w-full p-3 flex justify-between items-center text-xs font-bold text-slate-400 uppercase tracking-widest hover:bg-red-950/20 transition-colors"
        >
            <div className="flex items-center space-x-2">
                <span>🧠 Brain Source</span>
                <span className="text-[10px] px-2 py-0.5 rounded border bg-indigo-900/50 text-indigo-300 border-indigo-800">
                    {config.textModel || 'MULBY 默认模型'}
                </span>
            </div>
            <span>{showApiSettings ? '−' : '+'}</span>
        </button>

        {showApiSettings && (
            <div className="p-4 space-y-4 border-t border-red-900/20 animate-fade-in bg-[#080808]">
                {modelsLoading ? (
                    <p className="text-xs text-slate-500 animate-pulse">正在从 Mulby 加载模型列表...</p>
                ) : (
                    <>
                        <div className="space-y-1">
                            <label className="text-xs text-slate-500 uppercase">文本模型（剧本 / 润色）</label>
                            <select
                                className="w-full bg-[#1c1c1c] border border-slate-800 rounded p-2 text-xs text-slate-300 focus:border-red-800 focus:outline-none"
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
                            <label className="text-xs text-slate-500 uppercase">图像模型（封面 / 角色 / 页面）</label>
                            <select
                                className="w-full bg-[#1c1c1c] border border-slate-800 rounded p-2 text-xs text-slate-300 focus:border-red-800 focus:outline-none"
                                value={config.imageModel || ''}
                                onChange={(e) => handleInputChange('imageModel', e.target.value)}
                            >
                                <option value="">自动（第一个可用的图像生成模型）</option>
                                {imageModels.map(m => (
                                    <option key={m.id} value={m.id}>{m.label || m.id}</option>
                                ))}
                            </select>
                            {imageModels.length === 0 && (
                                <p className="text-[10px] text-red-400/80">
                                    未找到图像生成模型。请在 Mulby 设置 → AI → 模型管理中添加端点类型为「图像生成」的模型。
                                </p>
                            )}
                        </div>
                        <p className="text-[10px] text-slate-600 italic">
                           模型与 API Key 由 Mulby 统一管理（Mulby 设置 → AI）。角色参考图一致性需要支持多图输入的图像模型（如 Gemini 系列图像模型）。
                        </p>
                    </>
                )}
            </div>
        )}
      </div>

      {/* Input Area */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-red-400/80 flex justify-between uppercase tracking-widest">
          <span>The Nightmare (Story)</span>
          <button 
            onClick={() => fileInputRef.current?.click()}
            className="text-red-600 hover:text-red-400 text-xs underline"
          >
            Upload .txt
          </button>
        </label>
        <textarea
          className="w-full h-40 bg-[#1a0505] border border-red-900/50 rounded-lg p-3 text-sm text-red-100 placeholder-red-900/50 focus:ring-2 focus:ring-red-700 focus:outline-none resize-none font-serif"
          placeholder="Describe the horror story, the ghost, the killer, or the psychological torment here..."
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

      {/* Main Settings Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        
        {/* Style Selection */}
        <div className="space-y-2 col-span-1 md:col-span-2">
          <label className="text-sm font-medium text-slate-500 uppercase tracking-wide">Art Style</label>
          <select
            className="w-full bg-[#1c1c1c] border border-slate-800 rounded-lg p-2.5 text-sm text-slate-300 focus:ring-2 focus:ring-red-800"
            value={config.style}
            onChange={(e) => handleInputChange('style', e.target.value)}
          >
            {STYLE_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
            <option value="custom">Custom Style...</option>
          </select>
        </div>

        {/* Color Mode Selection */}
        <div className="space-y-2 col-span-1 md:col-span-2">
          <label className="text-sm font-medium text-slate-500 uppercase tracking-wide">Color Mode</label>
          <select
            className="w-full bg-[#1c1c1c] border border-slate-800 rounded-lg p-2.5 text-sm text-slate-300 focus:ring-2 focus:ring-red-800"
            value={config.colorMode}
            onChange={(e) => handleInputChange('colorMode', e.target.value)}
          >
            {COLOR_MODE_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        {/* Primary Mode */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-slate-500 uppercase tracking-wide">Primary Genre</label>
          <select
            className="w-full bg-[#1c1c1c] border border-slate-800 rounded-lg p-2.5 text-sm text-slate-300 focus:ring-2 focus:ring-red-800"
            value={config.storyMode}
            onChange={(e) => handleInputChange('storyMode', e.target.value)}
          >
            {STORY_MODES.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        {/* Secondary Mode (Cross-over) */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-slate-500 uppercase tracking-wide">Subgenre (Blend)</label>
          <select
            className="w-full bg-[#1c1c1c] border border-slate-800 rounded-lg p-2.5 text-sm text-slate-400 focus:ring-2 focus:ring-red-800"
            value={config.secondaryStoryMode || ""}
            onChange={(e) => handleInputChange('secondaryStoryMode', e.target.value || undefined)}
          >
            <option value="">None (Pure)</option>
            {STORY_MODES.map(opt => (
              <option key={opt.value} value={opt.value} disabled={opt.value === config.storyMode}>{opt.label}</option>
            ))}
          </select>
        </div>

      </div>

      {/* Ending & Length */}
      <div className="grid grid-cols-2 gap-4">
         {/* Ending Type */}
         <div className="space-y-2">
            <label className="text-sm font-medium text-slate-500 uppercase tracking-wide">Ending Style</label>
            <select
                className="w-full bg-[#1c1c1c] border border-slate-800 rounded-lg p-2.5 text-sm text-slate-300 focus:ring-2 focus:ring-red-800"
                value={config.endingType}
                onChange={(e) => handleInputChange('endingType', e.target.value)}
            >
                {ENDING_TYPE_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
            </select>
        </div>

         {/* Page Length */}
         <div className="space-y-2">
            <label className="text-sm font-medium text-slate-500 uppercase tracking-wide">Length</label>
            <select
                className="w-full bg-[#1c1c1c] border border-slate-800 rounded-lg p-2.5 text-sm text-slate-300 focus:ring-2 focus:ring-red-800"
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
            <label className="text-sm font-medium text-slate-500 uppercase tracking-wide">Panels/Page</label>
            <select
                className="w-full bg-[#1c1c1c] border border-slate-800 rounded-lg p-2.5 text-sm text-slate-300 focus:ring-2 focus:ring-red-800"
                value={config.panelCount}
                onChange={(e) => handleInputChange('panelCount', Number(e.target.value))}
            >
                <option value={0}>Auto (Pacing)</option>
                <option value={3}>3 Panels</option>
                <option value={4}>4 Panels</option>
                <option value={6}>6 Panels</option>
            </select>
        </div>
        
        {/* Aspect Ratio */}
        <div className="space-y-2">
            <label className="text-sm font-medium text-slate-500 uppercase tracking-wide">Format</label>
            <select
                className="w-full bg-[#1c1c1c] border border-slate-800 rounded-lg p-2.5 text-sm text-slate-300 focus:ring-2 focus:ring-red-800"
                value={config.aspectRatio}
                onChange={(e) => handleInputChange('aspectRatio', e.target.value)}
            >
                {ASPECT_RATIOS.map(r => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                ))}
            </select>
        </div>
      </div>

      {/* Watermark Section */}
      <div className="border border-red-900/30 rounded-lg bg-[#0a0a0a] overflow-hidden">
        <button 
           onClick={() => setShowWatermark(!showWatermark)}
           className="w-full p-3 flex justify-between items-center text-xs font-bold text-red-500 uppercase tracking-widest hover:bg-red-950/20 transition-colors"
        >
            <div className="flex items-center space-x-2">
                <span>© Cursed Seal (Watermark)</span>
                {config.watermark.enabled && <span className="w-2 h-2 rounded-full bg-green-500"></span>}
            </div>
            <span>{showWatermark ? '−' : '+'}</span>
        </button>
        
        {showWatermark && (
            <div className="p-4 space-y-4 border-t border-red-900/30 animate-fade-in">
                <div className="flex items-center justify-between">
                    <label className="text-sm text-slate-400">Enable Seal</label>
                    <div 
                        onClick={() => handleWatermarkChange('enabled', !config.watermark.enabled)}
                        className={`w-10 h-5 rounded-full cursor-pointer relative transition-colors ${config.watermark.enabled ? 'bg-red-700' : 'bg-slate-700'}`}
                    >
                        <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${config.watermark.enabled ? 'left-6' : 'left-1'}`}></div>
                    </div>
                </div>

                {config.watermark.enabled && (
                    <>
                        <div className="space-y-2">
                            <label className="text-xs text-slate-500 uppercase">Style</label>
                            <select
                                className="w-full bg-[#1c1c1c] border border-slate-800 rounded p-2 text-xs text-slate-300"
                                value={config.watermark.type}
                                onChange={(e) => handleWatermarkChange('type', e.target.value)}
                            >
                                {WATERMARK_TYPE_OPTIONS.map(opt => (
                                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                                ))}
                            </select>
                        </div>

                        {config.watermark.type.includes('TEXT') ? (
                            <div className="space-y-2">
                                <label className="text-xs text-slate-500 uppercase">Text Content</label>
                                <input
                                    type="text"
                                    className="w-full bg-[#1c1c1c] border border-slate-800 rounded p-2 text-xs text-slate-300 focus:border-red-800 focus:outline-none"
                                    value={config.watermark.text}
                                    onChange={(e) => handleWatermarkChange('text', e.target.value)}
                                    placeholder="e.g. @YourName"
                                />
                            </div>
                        ) : (
                             <div className="space-y-2">
                                <label className="text-xs text-slate-500 uppercase">Seal Image</label>
                                <div className="flex space-x-2">
                                    <button 
                                        onClick={() => watermarkImgRef.current?.click()}
                                        className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs py-2 rounded border border-slate-600 truncate px-2"
                                    >
                                        {config.watermark.image ? "Change Image" : "Upload Image"}
                                    </button>
                                    <input 
                                        type="file" 
                                        ref={watermarkImgRef} 
                                        className="hidden" 
                                        accept="image/*" 
                                        onChange={handleWatermarkImageUpload}
                                    />
                                    {config.watermark.image && (
                                        <div className="w-8 h-8 rounded border border-slate-600 bg-black overflow-hidden">
                                            <img src={config.watermark.image} alt="Watermark" className="w-full h-full object-cover" />
                                        </div>
                                    )}
                                </div>
                             </div>
                        )}

                        <div className="space-y-1">
                             <div className="flex justify-between text-xs text-slate-500">
                                <span>Opacity</span>
                                <span>{Math.round(config.watermark.opacity * 100)}%</span>
                             </div>
                             <input 
                                type="range" 
                                min="0.1" 
                                max="1" 
                                step="0.1"
                                value={config.watermark.opacity}
                                onChange={(e) => handleWatermarkChange('opacity', Number(e.target.value))}
                                className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-red-600"
                             />
                        </div>
                    </>
                )}
            </div>
        )}
      </div>

      {!isLoading ? (
        <button
          onClick={onGenerate}
          disabled={!config.sourceText.trim()}
          className={`w-full py-4 rounded-lg font-bold text-lg tracking-widest shadow-xl transition-all font-horror
            ${!config.sourceText.trim() 
              ? 'bg-slate-900 text-slate-700 cursor-not-allowed border border-slate-800' 
              : 'bg-red-900 hover:bg-red-800 text-white border border-red-700 shadow-red-900/50'
            }`}
        >
          MANIFEST HORROR
        </button>
      ) : (
        <button
          onClick={onCancel}
          className="w-full py-4 rounded-lg font-bold text-lg tracking-widest shadow-xl transition-all font-horror bg-red-950 hover:bg-red-900 text-red-200 border-2 border-red-600 animate-pulse flex items-center justify-center space-x-2"
        >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
            <span>CANCEL RITUAL</span>
        </button>
      )}

    </div>
  );
};

export default ConfigPanel;

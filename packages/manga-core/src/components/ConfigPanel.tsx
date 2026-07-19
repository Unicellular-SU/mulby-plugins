

import React, { ChangeEvent, useRef, useEffect, useState } from 'react';
import { AppConfig, CharacterProfile, StoryMode, WatermarkSettings } from '../engine-types';
import { ASPECT_RATIOS, PAGE_LENGTH_OPTIONS } from '../constants';
import { estimateScriptTokens } from '../services/mulbyAiService';
import { getTheme } from '../theme/registry';

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
  // 题材数据（画风 / 叙事模式 / 预设角色 / 文案）全部来自当前主题
  const theme = getTheme();
  const S = theme.strings;
  const PRESET_CHARACTERS = theme.characterPresets;
  const STYLE_OPTIONS = theme.artStyles;
  const STORY_MODES = theme.storyModes;
  const RATIO_OPTIONS = theme.aspectRatioOptions ?? ASPECT_RATIOS;
  const LENGTH_OPTIONS = theme.pageLengthOptions ?? PAGE_LENGTH_OPTIONS;
  // 题材不提供预设角色 = 全自动选角（角色区整段隐藏，剧本由 AI 自行分析角色）
  const hasCharacterPresets = PRESET_CHARACTERS.length > 0;

  const fileInputRef = useRef<HTMLInputElement>(null);
  // Phase 2 水印区（features.watermark）：折叠面板与图片上传
  const watermarkImgRef = useRef<HTMLInputElement>(null);
  const [showWatermark, setShowWatermark] = useState(false);

  const handleWatermarkChange = (field: keyof WatermarkSettings, value: any) => {
    if (!config.watermark) return;
    onChange({ ...config, watermark: { ...config.watermark, [field]: value } });
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

  // 方案 3.2 步骤 2：模型列表加载完成后校验持久化的模型是否仍存在，失效则回退并提示。
  // App 恢复 config 与本组件拉模型列表存在先后竞态，依赖数组同时监听两者。
  const [staleModelNotice, setStaleModelNotice] = useState<string | null>(null);
  useEffect(() => {
    if (modelsLoading) return;
    if (config.textModel && !textModels.some(m => m.id === config.textModel)) {
      setStaleModelNotice(`上次使用的文本模型「${config.textModel}」已不可用，已回退到 Mulby 默认模型`);
      onChange({ ...config, textModel: '' });
    } else if (config.imageModel && !imageModels.some(m => m.id === config.imageModel)) {
      setStaleModelNotice(`上次使用的图像模型「${config.imageModel}」已不可用，已回退到自动选择`);
      onChange({ ...config, imageModel: '' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelsLoading, config.textModel, config.imageModel, textModels, imageModels]);

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

  // 方案 5.5：上传优先走原生打开对话框（showOpenDialog 返回路径数组，空数组即取消），
  // 老宿主降级回 <input type=file>
  const [uploadError, setUploadError] = useState<string | null>(null);
  const handleUploadClick = async () => {
    const m = (window as Window).mulby;
    if (!m?.dialog?.showOpenDialog || !m?.filesystem?.readFile) {
      fileInputRef.current?.click();
      return;
    }
    setUploadError(null);
    try {
      const paths = await m.dialog.showOpenDialog({
        filters: [{ name: '文本', extensions: ['txt', 'md'] }],
        properties: ['openFile'],
      });
      const [path] = paths || [];
      if (!path) return; // 用户取消
      const content = await m.filesystem.readFile(path, 'utf-8');
      if (typeof content === 'string') handleInputChange('sourceText', content);
      else setUploadError(S.readFileFailed);
    } catch {
      setUploadError(S.readFileFailed);
    }
  };

  // 方案 5.2 步骤 6：pre-flight 输入 token 预估（debounce 800ms；tokens.estimate 不可用时隐藏）
  const [estimatedTokens, setEstimatedTokens] = useState<number | null>(null);
  useEffect(() => {
    if (!config.sourceText.trim()) { setEstimatedTokens(null); return; }
    let cancelled = false;
    const t = setTimeout(async () => {
      const n = await estimateScriptTokens({
        sourceText: config.sourceText,
        style: config.style,
        character: config.character,
        storyMode: config.storyMode,
        customStoryPrompt: config.customStoryPrompt,
        panelCount: config.panelCount,
        totalPages: config.totalPages,
        secondaryStoryMode: config.secondaryStoryMode,
        endingType: config.endingType,
        colorMode: config.colorMode,
      });
      if (!cancelled) setEstimatedTokens(n);
    }, 800);
    return () => { cancelled = true; clearTimeout(t); };
  }, [config.sourceText, config.style, config.character, config.storyMode,
      config.customStoryPrompt, config.panelCount, config.totalPages, config.textModel,
      config.secondaryStoryMode, config.endingType, config.colorMode]);

  const isCustomChar = !PRESET_CHARACTERS.some(c => c.name === config.character.name) && config.character.name !== AUTO_DETECT_CHAR.name;
  const isCustomStory = config.storyMode === StoryMode.CUSTOM;
  const isSeriousHistory = config.storyMode === StoryMode.HISTORY_SERIOUS;

  return (
    <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 shadow-xl space-y-6">
      
      {/* Header */}
      <div className="flex items-center space-x-2 border-b border-slate-700 pb-4">
        <span className="text-2xl">{S.configIcon}</span>
        <h2 className="text-xl font-bold text-white font-[var(--manga-heading-font)]">{S.configTitle}</h2>
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
                {staleModelNotice && (
                    <p className="text-[10px] text-yellow-500">{staleModelNotice}</p>
                )}
            </>
        )}
      </div>

      {/* Input Area */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-slate-400 flex justify-between">
          <span>{S.sourceLabel}</span>
          <button
            onClick={handleUploadClick}
            className="text-indigo-400 hover:text-indigo-300 text-xs underline"
          >
            {S.uploadSource}
          </button>
        </label>
        <textarea
          className="w-full h-32 bg-slate-900 border border-slate-700 rounded-lg p-3 text-sm text-slate-200 focus:ring-2 focus:ring-indigo-500 focus:outline-none resize-none"
          placeholder={isSeriousHistory ? S.sourcePlaceholderHistory : S.sourcePlaceholder}
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
        {uploadError && (
          <p className="text-[10px] text-red-400">{uploadError}</p>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        
        {/* Style Selection */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-slate-400">{S.styleLabel}</label>
          <select
            className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-sm text-white focus:ring-2 focus:ring-indigo-500"
            value={config.style}
            onChange={(e) => handleInputChange('style', e.target.value)}
          >
            {STYLE_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
            <option value="custom">{S.customStyleOption}</option>
          </select>
        </div>

        {/* 色彩模式（theme.colorModes 提供时显示；promptHint 参与图像 prompt） */}
        {theme.colorModes && theme.colorModes.length > 0 && (
        <div className="space-y-2">
          <label className="text-sm font-medium text-slate-400">{S.colorModeLabel}</label>
          <select
            className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-sm text-white focus:ring-2 focus:ring-indigo-500"
            value={config.colorMode || ''}
            onChange={(e) => handleInputChange('colorMode', e.target.value || undefined)}
          >
            {theme.colorModes.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
        )}

        {/* Story Mode Selection */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-slate-400">{S.storyModeLabel}</label>
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

        {/* Phase 2：副故事模式（features.secondaryStoryMode；含「无」，主模式自身禁选） */}
        {theme.features.secondaryStoryMode && (
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-400">{S.secondaryStoryModeLabel}</label>
            <select
              className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-sm text-white focus:ring-2 focus:ring-indigo-500"
              value={config.secondaryStoryMode || ''}
              onChange={(e) => handleInputChange('secondaryStoryMode', e.target.value || undefined)}
            >
              <option value="">{S.secondaryStoryModeNone}</option>
              {STORY_MODES.map(opt => (
                <option key={opt.value} value={opt.value} disabled={opt.value === config.storyMode}>{opt.label}</option>
              ))}
            </select>
          </div>
        )}

      </div>

      {/* Custom Story Prompt */}
      {isCustomStory && (
        <div className="space-y-2 animate-fade-in">
          <label className="text-sm font-medium text-indigo-400">{S.customStoryLabel}</label>
          <textarea
            className="w-full h-24 bg-slate-900 border border-indigo-500/50 rounded-lg p-3 text-sm text-slate-200 focus:ring-2 focus:ring-indigo-500 focus:outline-none resize-none"
            placeholder={S.customStoryPlaceholder}
            value={config.customStoryPrompt || ''}
            onChange={(e) => handleInputChange('customStoryPrompt', e.target.value)}
          />
        </div>
      )}

      {/* Character Selection (Moved to full width below style/mode)；无预设角色的题材整段隐藏（全自动选角） */}
      {hasCharacterPresets && (
      <div className="space-y-2">
          <label className="text-sm font-medium text-slate-400">{S.mainCharacterLabel}</label>
          <div className="relative">
            <select
                className={`w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-sm text-white focus:ring-2 focus:ring-indigo-500 ${isSeriousHistory ? 'opacity-50 cursor-not-allowed' : ''}`}
                value={config.character.name === AUTO_DETECT_CHAR.name ? 'auto' : (isCustomChar ? 'custom' : config.character.name)}
                onChange={handleCharacterChange}
                disabled={isSeriousHistory}
            >
                {/* Special Auto option used for display state */}
                <option value="auto">{S.autoDetectOption}</option>
                
                <option value="" disabled>{S.selectCharacterOption}</option>
                {PRESET_CHARACTERS.map(c => (
                <option key={c.name} value={c.name}>{c.name}</option>
                ))}
                <option value="custom">{S.customCharacterOption}</option>
            </select>
            {isSeriousHistory && (
                <div className="absolute top-0 right-0 h-full flex items-center pr-8 pointer-events-none">
                     <span className="text-xs text-yellow-500 font-bold bg-yellow-900/40 px-2 py-0.5 rounded">{S.autoCastBadge}</span>
                </div>
            )}
          </div>
          {isSeriousHistory && (
              <p className="text-[10px] text-slate-500">
                  {S.autoCastHint}
              </p>
          )}
        </div>
      )}

      {/* Custom Character Inputs */}
      {hasCharacterPresets && isCustomChar && !isSeriousHistory && (
        <div className="bg-slate-900/50 p-3 rounded-lg space-y-3 border border-slate-700/50">
           <div>
             <label className="text-xs text-slate-500">{S.charNameLabel}</label>
             <input 
                type="text"
                className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-sm text-white"
                value={config.character.name}
                onChange={(e) => handleInputChange('character', {...config.character, name: e.target.value})}
             />
           </div>
           <div>
             <label className="text-xs text-slate-500">{S.charDescLabel}</label>
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
         {/* Phase 2：结局类型（features.endings + theme.endings 数据驱动） */}
         {theme.features.endings && theme.endings && theme.endings.length > 0 && (
         <div className="space-y-2">
            <label className="text-sm font-medium text-slate-400">{S.endingLabel}</label>
            <select
                className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-sm text-white focus:ring-2 focus:ring-indigo-500"
                value={config.endingType || ''}
                onChange={(e) => handleInputChange('endingType', e.target.value || undefined)}
            >
                {theme.endings.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
            </select>
        </div>
         )}

         {/* Page Length */}
         <div className="space-y-2">
            <label className="text-sm font-medium text-slate-400">{S.pageLengthLabel}</label>
            <select
                className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-sm text-white focus:ring-2 focus:ring-indigo-500"
                value={config.totalPages}
                onChange={(e) => handleInputChange('totalPages', e.target.value)}
            >
                {LENGTH_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
            </select>
        </div>

        {/* Panel Density */}
        <div className="space-y-2">
            <label className="text-sm font-medium text-slate-400">{S.panelsLabel}</label>
            <select
                className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-sm text-white focus:ring-2 focus:ring-indigo-500"
                value={config.panelCount}
                onChange={(e) => handleInputChange('panelCount', Number(e.target.value))}
            >
                <option value={0}>{S.panelsAuto}</option>
                <option value={3}>{S.panelsN(3)}</option>
                <option value={4}>{S.panelsN(4)}</option>
                <option value={6}>{S.panelsN(6)}</option>
            </select>
        </div>
      </div>
      
      {/* Aspect Ratio */}
      <div className="space-y-2">
            <label className="text-sm font-medium text-slate-400">{S.ratioLabel}</label>
            <select
                className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-sm text-white focus:ring-2 focus:ring-indigo-500"
                value={config.aspectRatio}
                onChange={(e) => handleInputChange('aspectRatio', e.target.value)}
            >
                {RATIO_OPTIONS.map(r => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                ))}
            </select>
        </div>

      {/* Phase 2：水印设置（features.watermark；结构与 horror-manga 现有能力一致，题材默认值由 theme.watermark 提供） */}
      {theme.features.watermark && theme.watermark && config.watermark && (
      <div className="border border-slate-700 rounded-lg bg-slate-900/50 overflow-hidden">
        <button
           onClick={() => setShowWatermark(v => !v)}
           className="w-full p-3 flex justify-between items-center text-xs font-bold text-slate-400 uppercase tracking-widest hover:bg-slate-800/50 transition-colors"
        >
            <div className="flex items-center space-x-2">
                <span>{S.watermarkTitle}</span>
                {config.watermark.enabled && <span className="w-2 h-2 rounded-full bg-green-500"></span>}
            </div>
            <span>{showWatermark ? '−' : '+'}</span>
        </button>

        {showWatermark && (
            <div className="p-4 space-y-4 border-t border-slate-700 animate-fade-in">
                <div className="flex items-center justify-between">
                    <label className="text-sm text-slate-400">{S.watermarkEnable}</label>
                    <div
                        onClick={() => handleWatermarkChange('enabled', !config.watermark!.enabled)}
                        className={`w-10 h-5 rounded-full cursor-pointer relative transition-colors ${config.watermark.enabled ? 'bg-indigo-600' : 'bg-slate-700'}`}
                    >
                        <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${config.watermark.enabled ? 'left-6' : 'left-1'}`}></div>
                    </div>
                </div>

                {config.watermark.enabled && (
                    <>
                        <div className="space-y-2">
                            <label className="text-xs text-slate-500">{S.watermarkTypeLabel}</label>
                            <select
                                className="w-full bg-slate-800 border border-slate-600 rounded p-2 text-xs text-slate-300"
                                value={config.watermark.type}
                                onChange={(e) => handleWatermarkChange('type', e.target.value)}
                            >
                                {theme.watermark!.typeOptions.map(opt => (
                                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                                ))}
                            </select>
                        </div>

                        {config.watermark.type.includes('TEXT') ? (
                            <div className="space-y-2">
                                <label className="text-xs text-slate-500">{S.watermarkTextLabel}</label>
                                <input
                                    type="text"
                                    className="w-full bg-slate-800 border border-slate-600 rounded p-2 text-xs text-slate-300 focus:border-indigo-500 focus:outline-none"
                                    value={config.watermark.text}
                                    onChange={(e) => handleWatermarkChange('text', e.target.value)}
                                    placeholder={S.watermarkTextPlaceholder}
                                />
                            </div>
                        ) : (
                             <div className="space-y-2">
                                <label className="text-xs text-slate-500">{S.watermarkImageLabel}</label>
                                <div className="flex space-x-2">
                                    <button
                                        onClick={() => watermarkImgRef.current?.click()}
                                        className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs py-2 rounded border border-slate-600 truncate px-2"
                                    >
                                        {config.watermark.image ? S.watermarkChangeImage : S.watermarkUploadImage}
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
                                <span>{S.watermarkOpacityLabel}</span>
                                <span>{Math.round(config.watermark.opacity * 100)}%</span>
                             </div>
                             <input
                                type="range"
                                min="0.1"
                                max="1"
                                step="0.1"
                                value={config.watermark.opacity}
                                onChange={(e) => handleWatermarkChange('opacity', Number(e.target.value))}
                                className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                             />
                        </div>
                    </>
                )}
            </div>
        )}
      </div>
      )}

      {/* 方案 5.2：pre-flight 输入 token 预估（tokens.estimate 不可用时隐藏） */}
      {estimatedTokens != null && (
        <p className="text-[10px] text-slate-500 text-right -mb-3">
          {S.estimatedInputTokens(estimatedTokens.toLocaleString())}
        </p>
      )}

      <button
        onClick={onGenerate}
        disabled={isLoading || !config.sourceText.trim() || (!config.character.name && !isSeriousHistory && hasCharacterPresets)}
        className={`w-full py-4 rounded-lg font-bold text-lg tracking-wide shadow-lg transition-all
          ${isLoading || !config.sourceText.trim()
            ? 'bg-slate-700 text-slate-500 cursor-not-allowed'
            : 'bg-gradient-to-r from-[var(--manga-cta-from)] to-[var(--manga-cta-to)] hover:from-[var(--manga-cta-hover-from)] hover:to-[var(--manga-cta-hover-to)] text-white shadow-indigo-500/30'
          }`}
      >
        {isLoading ? (
          <span className="flex items-center justify-center space-x-2">
            <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <span>{S.generating}</span>
          </span>
        ) : (
          S.generateBtn
        )}
      </button>

    </div>
  );
};

export default ConfigPanel;


import React, { useState, useEffect, useRef } from 'react';
import { CharacterSheetItem, PropSheetItem, ImageProgress } from '../types';
import { generateCharacterReference, generatePropReference, getAbortEpoch } from '../services/mulbyAiService';
import { asyncPool, withRetryOnce } from '../services/asyncPool';
import { stageText } from '../utils/progressText';
import { S } from '../strings';

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

// ================= 跨挂载在途注册表（修复：标签页切换重挂载导致同一资产重复生成） =================
// 根因：本组件条件渲染于 storyboardTab（App 侧），切到 Script 标签即卸载、切回重挂载；
// 原先的在途去重（useRef）随实例销毁归零，重挂载后自动循环把"还没有图"的资产全部重新发起，
// 而上一个实例的请求仍在服务端进行——旧请求先写入一张图，重复请求随后再覆盖一张（双倍计费）。
// 修复：在途状态提升为模块级 Map，key 用稳定身份（char:<名字> / prop:<名字>，index 跨剧本编辑不稳定），
// value 为在途 Promise。新实例（或同实例的手动按钮）命中在途项时"领养"同一个 Promise——
// 只等待、不发起第二次请求；完成/失败/中止后 finally 从注册表移除，手动重试永远拿到新请求。
const assetInFlight = new Map<string, Promise<string>>();

const startOrAdoptFlight = (flightKey: string, start: () => Promise<string>): Promise<string> => {
  let flight = assetInFlight.get(flightKey);
  if (!flight) {
    flight = start();
    assetInFlight.set(flightKey, flight);
    // 注册表自身持有的引用不得产生 unhandledrejection（真实错误由领养方 await 处理）
    flight.finally(() => assetInFlight.delete(flightKey)).catch(() => { /* ignore */ });
  }
  return flight;
};

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
  // 方案 5.3：资产卡片实时进度（stage 文案 + 渐进预览）
  const [progressStates, setProgressStates] = useState<Record<string, ImageProgress>>({});
  
  const initializedRef = useRef(false);
  const charactersRef = useRef(characters);
  const propsRef = useRef(props);

  useEffect(() => {
    charactersRef.current = characters;
    propsRef.current = props;
  }, [characters, props]);

  // Auto-generate missing character references on mount
  // 方案 4.3：角色/道具互无数据依赖，与绘页阶段共用 asyncPool(limit=2)；删除 800ms 硬睡，
  // 限流交给并发上限 + 宿主内建退避 + withRetryOnce。
  useEffect(() => {
    const generateSequentially = async () => {
        if (initializedRef.current) return;
        initializedRef.current = true;

        // 捕获当前中止纪元；用户点击「中止全部任务」后纪元变化，池停止推进
        const epoch = getAbortEpoch();

        const charIndices = charactersRef.current
            .map((c, i) => (!c.referenceImage ? i : -1))
            .filter(i => i !== -1);
        const propIndices = (propsRef.current.length > 0 && onUpdateProp)
            ? propsRef.current.map((p, i) => (!p.referenceImage ? i : -1)).filter(i => i !== -1)
            : [];

        // 生成函数入口有 in-flight 单飞去重（方案 2.6），与手动按钮并发安全
        const charTasks = charIndices.map((idx) => async () => {
            if (getAbortEpoch() !== epoch) return;
            const c = charactersRef.current[idx];
            if (c && !c.referenceImage) await handleGenerateCharacter(idx, c);
        });
        const propTasks = propIndices.map((idx) => async () => {
            if (getAbortEpoch() !== epoch) return;
            const p = propsRef.current[idx];
            if (p && !p.referenceImage) await handleGenerateProp(idx, p);
        });

        await asyncPool([...charTasks, ...propTasks], 2);

        // 中止时给剩余缺图项标注可见状态（保留方案 2.6 可选项），避免静默停止；
        // 已有具体错误文案（含在途任务的"已被用户中止"）的项不覆盖
        if (getAbortEpoch() !== epoch) {
            setErrorStates(prev => {
                const next = { ...prev };
                charIndices.forEach(i => {
                    const c = charactersRef.current[i];
                    if (c && !c.referenceImage && !next[`char-${i}`]) next[`char-${i}`] = "已被用户中止";
                });
                propIndices.forEach(i => {
                    const p = propsRef.current[i];
                    if (p && !p.referenceImage && !next[`prop-${i}`]) next[`prop-${i}`] = "已被用户中止";
                });
                return next;
            });
        }
    };

    const timer = setTimeout(() => {
        generateSequentially();
    }, 500);

    return () => clearTimeout(timer);
  }, []); 

  // 方案 5.3：进度 chunk 写入该资产卡片（epoch 过滤已在 service 层完成）
  const makeProgressHandler = (key: string) => (p: ImageProgress) => {
    setProgressStates(prev => ({
      ...prev,
      [key]: { ...prev[key], ...p, preview: p.preview ?? prev[key]?.preview },
    }));
  };

  const handleGenerateCharacter = async (index: number, char: CharacterSheetItem) => {
    const key = `char-${index}`;            // UI 状态 key（spinner/错误/进度，按卡片位置）
    const flightKey = `char:${char.name}`;  // 在途身份 key（跨组件重挂载稳定）
    setGeneratingStates(prev => ({ ...prev, [key]: true }));
    setErrorStates(prev => ({ ...prev, [key]: '' }));

    try {
      // 单飞 + 领养：已有在途请求则等待它，绝不发起第二次；
      // 方案 4.3 的失败自动重试（AbortError/鉴权/纪元变化除外）包含在同一个在途 Promise 内
      const imageData = await startOrAdoptFlight(flightKey, () => withRetryOnce(() =>
        generateCharacterReference(char.name, char.description, style, onUsageCallback, makeProgressHandler(key))));
      onUpdateCharacter(index, { ...char, referenceImage: imageData });
    } catch (err: any) {
      setErrorStates(prev => ({ ...prev, [key]: err?.name === 'AbortError' ? "已被用户中止" : (err.message || "生成失败") }));
    } finally {
      setGeneratingStates(prev => ({ ...prev, [key]: false }));
      setProgressStates(prev => { const next = { ...prev }; delete next[key]; return next; });
    }
  };

  const handleGenerateProp = async (index: number, prop: PropSheetItem) => {
    if (!onUpdateProp) return;
    const key = `prop-${index}`;
    const flightKey = `prop:${prop.name}`;
    setGeneratingStates(prev => ({ ...prev, [key]: true }));
    setErrorStates(prev => ({ ...prev, [key]: '' }));

    try {
      // Pass mainCharacterName and storyMode to ensure consistent universe style
      // 单飞 + 领养（同上）；方案 4.3 重试包含在同一个在途 Promise 内
      const imageData = await startOrAdoptFlight(flightKey, () => withRetryOnce(() =>
        generatePropReference(prop.name, prop.description, style, mainCharacterName, storyMode, onUsageCallback, makeProgressHandler(key))));
      onUpdateProp(index, { ...prop, referenceImage: imageData });
    } catch (err: any) {
      setErrorStates(prev => ({ ...prev, [key]: err?.name === 'AbortError' ? "已被用户中止" : (err.message || "生成失败") }));
    } finally {
      setGeneratingStates(prev => ({ ...prev, [key]: false }));
      setProgressStates(prev => { const next = { ...prev }; delete next[key]; return next; });
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
         <h2 className="text-2xl font-bold text-white">{S.assetStudioTitle}</h2>
         <p className="text-slate-400 text-sm">{S.assetStudioSubtitle}</p>
      </div>
      
      {/* Asset Tabs */}
      <div className="flex justify-center space-x-4 mb-8">
        <button 
            onClick={() => setActiveTab('CHARACTERS')}
            className={`px-4 py-2 rounded-full text-sm font-bold transition-all ${activeTab === 'CHARACTERS' ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}
        >
            {S.charactersTab(characters.length)}
        </button>
        <button 
            onClick={() => setActiveTab('PROPS')}
            className={`px-4 py-2 rounded-full text-sm font-bold transition-all ${activeTab === 'PROPS' ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}
        >
            {S.propsTab(props.length)}
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
                {/* 方案 4.7：与立绘实际画布 1024x1536（2:3）一致，消除裁切 */}
                <div className="relative aspect-[2/3] bg-black/40 rounded-md overflow-hidden border border-slate-600 group">
                    {char.referenceImage ? (
                        <img src={char.referenceImage} alt={char.name} className="w-full h-full object-cover" />
                    ) : (
                        <div className="w-full h-full flex items-center justify-center flex-col text-slate-500">
                            <span className="text-3xl mb-2">👤</span>
                            <span className="text-xs">{S.noReference}</span>
                        </div>
                    )}
                    {generatingStates[`char-${idx}`] && (
                        <div className="absolute inset-0 bg-slate-900/80 flex items-center justify-center flex-col z-10">
                            {progressStates[`char-${idx}`]?.preview && (
                                <img src={progressStates[`char-${idx}`]!.preview} alt="" className="absolute inset-0 w-full h-full object-contain opacity-50" />
                            )}
                            <div className="relative animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500 mb-2"></div>
                            <span className="relative text-xs text-indigo-300">{stageText(progressStates[`char-${idx}`]) || S.generatingLabel}</span>
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
                placeholder={S.charDescPlaceholder}
                />
                <div className="flex flex-col space-y-2 pt-2">
                    <button 
                    onClick={() => handleGenerateCharacter(idx, char)}
                    disabled={generatingStates[`char-${idx}`]}
                    className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 text-white text-xs font-bold rounded shadow-lg shadow-indigo-500/20 transition-all"
                    >
                    {char.referenceImage ? S.regenerateRef : S.generateRef}
                    </button>
                    <div className="flex justify-center">
                        <label className="cursor-pointer text-xs text-slate-500 hover:text-slate-300 flex items-center space-x-1">
                            <span>{S.uploadCustomImage}</span>
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
                     <p>{S.noPropsFound}</p>
                     <p className="text-xs mt-2">{S.noPropsHint}</p>
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
                                <span className="text-xs">{S.noReference}</span>
                            </div>
                        )}
                        {generatingStates[`prop-${idx}`] && (
                            <div className="absolute inset-0 bg-slate-900/80 flex items-center justify-center flex-col z-10">
                                {progressStates[`prop-${idx}`]?.preview && (
                                    <img src={progressStates[`prop-${idx}`]!.preview} alt="" className="absolute inset-0 w-full h-full object-contain opacity-50" />
                                )}
                                <div className="relative animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500 mb-2"></div>
                                <span className="relative text-xs text-indigo-300">{stageText(progressStates[`prop-${idx}`]) || S.generatingLabel}</span>
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
                        placeholder={S.propDescPlaceholder}
                    />
                    <div className="flex flex-col space-y-2 pt-2">
                        <button 
                            onClick={() => handleGenerateProp(idx, prop)}
                            disabled={generatingStates[`prop-${idx}`]}
                            className="w-full py-2 bg-purple-600 hover:bg-purple-500 disabled:bg-slate-700 text-white text-xs font-bold rounded shadow-lg shadow-purple-500/20 transition-all"
                        >
                        {prop.referenceImage ? S.regenerateProp : S.generateProp}
                        </button>
                        <div className="flex justify-center">
                            <label className="cursor-pointer text-xs text-slate-500 hover:text-slate-300 flex items-center space-x-1">
                                <span>{S.uploadCustomImage}</span>
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
            {S.goToScriptEditor}
         </button>
      </div>

    </div>
  );
};

export default CharacterGenerator;

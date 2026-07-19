import React, { useEffect, useRef } from 'react';
import { getTheme } from '../theme/registry';

interface LogPanelProps {
  inputLog: string;
  outputLog: string;
  /** 推理模型思考流（chunkType==='reasoning'）；非推理模型/老宿主自然恒空，不渲染该块 */
  reasoningLog?: string;
  /** 当前流式相位徽标（如「生成剧本」/「自动审校」）；空串不显示 */
  phase?: string;
  /** 当前选择的文本模型 id；留空表示宿主默认路由（插件不可知实际模型），显示「Mulby 默认模型」 */
  textModel?: string;
}

const LogPanel: React.FC<LogPanelProps> = ({ inputLog, outputLog, reasoningLog, phase, textModel }) => {
  const S = getTheme().strings;
  const scrollRef = useRef<HTMLDivElement>(null);
  // 是否跟随流式滚动：用户往上翻看时置 false，不再被强行拽回底部
  const pinnedRef = useRef(true);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  };

  // 直接写 scrollTop（不用 scrollIntoView 的平滑滚动——高频流式下会抖动且可能带动整页），
  // 且仅在贴近底部时跟随。
  useEffect(() => {
    const el = scrollRef.current;
    if (el && pinnedRef.current) el.scrollTop = el.scrollHeight;
  }, [inputLog, outputLog, reasoningLog]);

  const streaming = !!(outputLog || reasoningLog);

  return (
    <div className="w-full h-full bg-[#0d1117] rounded-xl border border-slate-700 shadow-2xl overflow-hidden flex flex-col font-mono text-sm">
      {/* Terminal Header */}
      <div className="bg-[#161b22] px-4 py-2 border-b border-slate-700 flex items-center space-x-2 shrink-0">
        <div className="flex space-x-1.5">
          <div className="w-3 h-3 rounded-full bg-red-500/80"></div>
          <div className="w-3 h-3 rounded-full bg-yellow-500/80"></div>
          <div className="w-3 h-3 rounded-full bg-green-500/80"></div>
        </div>
        <div className="ml-4 text-slate-400 text-xs flex-1 text-center truncate">
           {S.terminalTitle(textModel || S.defaultModelLabel)}
        </div>
        {phase && (
          <span className="shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
            {phase}
          </span>
        )}
      </div>

      {/* Terminal Content */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-grow p-4 overflow-y-auto text-slate-300 space-y-6 scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-transparent"
      >

        {/* Input Section */}
        {inputLog && (
            <div className="border-l-2 border-indigo-500 pl-4 py-1">
                <h3 className="text-indigo-400 text-xs font-bold mb-2 opacity-75">USER_INPUT_PROMPT &gt;&gt;</h3>
                <pre className="whitespace-pre-wrap break-words leading-relaxed font-mono text-xs text-slate-400/90">
                    {inputLog}
                </pre>
            </div>
        )}

        {/* Reasoning / Thinking Section（推理模型思考流；填补思考期的死时间，明确「正在工作」而非卡死） */}
        {reasoningLog && (
            <div className="border-l-2 border-amber-500/70 pl-4 py-1">
                <h3 className="text-amber-400/90 text-xs font-bold mb-2 opacity-75 flex items-center gap-2">
                    <span>MODEL_THINKING_STREAM &gt;&gt;</span>
                    {!outputLog && <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />}
                </h3>
                <pre className="whitespace-pre-wrap break-words leading-relaxed font-mono text-xs italic text-slate-400/80">
                    {reasoningLog}
                </pre>
            </div>
        )}

        {/* Output Section */}
        {outputLog ? (
            <div className="border-l-2 border-green-500 pl-4 py-1">
                 <h3 className="text-green-400 text-xs font-bold mb-2 opacity-75">MODEL_RESPONSE_STREAM &gt;&gt;</h3>
                 <pre className="whitespace-pre-wrap break-words leading-relaxed font-mono text-xs md:text-sm text-slate-200">
                    {outputLog}
                    <span className="animate-pulse inline-block w-2 h-4 bg-green-500 ml-1 align-middle"></span>
                 </pre>
            </div>
        ) : !inputLog && !reasoningLog && (
           <div className="h-full flex flex-col items-center justify-center text-slate-600 space-y-2 opacity-50">
              <span className="text-4xl">⌨️</span>
              <p className="text-xs">{S.terminalReady}</p>
              <p className="text-xs">{S.terminalWaiting}</p>
           </div>
        )}
      </div>

      {/* Footer */}
      <div className="bg-[#161b22] px-4 py-1.5 border-t border-slate-700 text-xs text-slate-500 flex justify-between shrink-0">
        <span className={streaming ? "text-green-500" : "text-slate-500"}>
          {streaming ? S.terminalStreaming : S.terminalIdle}
        </span>
        <span>JSON MODE :: ENABLED</span>
      </div>
    </div>
  );
};

export default LogPanel;

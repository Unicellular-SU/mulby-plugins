import React, { useEffect, useRef } from 'react';
import { S } from '../strings';

interface LogPanelProps {
  inputLog: string;
  outputLog: string;
  /** 当前选择的文本模型 id；留空表示宿主默认路由（插件不可知实际模型），显示「Mulby 默认模型」 */
  textModel?: string;
}

const LogPanel: React.FC<LogPanelProps> = ({ inputLog, outputLog, textModel }) => {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (outputLog || inputLog) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [outputLog, inputLog]);

  return (
    <div className="w-full h-full bg-[#0d1117] rounded-xl border border-slate-700 shadow-2xl overflow-hidden flex flex-col font-mono text-sm">
      {/* Terminal Header */}
      <div className="bg-[#161b22] px-4 py-2 border-b border-slate-700 flex items-center space-x-2 shrink-0">
        <div className="flex space-x-1.5">
          <div className="w-3 h-3 rounded-full bg-red-500/80"></div>
          <div className="w-3 h-3 rounded-full bg-yellow-500/80"></div>
          <div className="w-3 h-3 rounded-full bg-green-500/80"></div>
        </div>
        <div className="ml-4 text-slate-400 text-xs flex-1 text-center pr-12 truncate">
           {S.terminalTitle(textModel || S.defaultModelLabel)}
        </div>
      </div>

      {/* Terminal Content */}
      <div className="flex-grow p-4 overflow-y-auto text-slate-300 space-y-6 scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-transparent">
        
        {/* Input Section */}
        {inputLog && (
            <div className="border-l-2 border-indigo-500 pl-4 py-1">
                <h3 className="text-indigo-400 text-xs font-bold mb-2 opacity-75">USER_INPUT_PROMPT &gt;&gt;</h3>
                <pre className="whitespace-pre-wrap break-words leading-relaxed font-mono text-xs text-slate-400/90">
                    {inputLog}
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
        ) : !inputLog && (
           <div className="h-full flex flex-col items-center justify-center text-slate-600 space-y-2 opacity-50">
              <span className="text-4xl">⌨️</span>
              <p className="text-xs">{S.terminalReady}</p>
              <p className="text-xs">{S.terminalWaiting}</p>
           </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Footer */}
      <div className="bg-[#161b22] px-4 py-1.5 border-t border-slate-700 text-xs text-slate-500 flex justify-between shrink-0">
        <span className={outputLog ? "text-green-500" : "text-slate-500"}>
          {outputLog ? S.terminalStreaming : S.terminalIdle}
        </span>
        <span>JSON MODE :: ENABLED</span>
      </div>
    </div>
  );
};

export default LogPanel;
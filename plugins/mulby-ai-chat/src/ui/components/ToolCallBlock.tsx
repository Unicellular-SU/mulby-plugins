import { useState } from 'react';
import { ToolCallEvent } from '../types';

interface ToolCallBlockProps {
  toolCalls: ToolCallEvent[];
}

// 复制按钮（带成功反馈）
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    // execCommand fallback：完全不依赖 Clipboard API
    const fallbackCopy = (t: string) => {
      const el = document.createElement('textarea');
      el.value = t;
      el.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
    };
    const markDone = () => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    };
    if (navigator.clipboard?.writeText) {
      // 现代路径：Clipboard API
      navigator.clipboard.writeText(text).then(markDone).catch(() => {
        fallbackCopy(text);
        markDone();
      });
    } else {
      // 降级路径：execCommand（沙箱 webview / 非安全上下文）
      fallbackCopy(text);
      markDone();
    }
  };

  return (
    <button className={`tool-copy-btn ${copied ? 'tool-copy-btn--ok' : ''}`} onClick={handleCopy} title="复制">
      {copied ? (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )}
    </button>
  );
}

// 格式化 JSON 展示（带截断上限，用于参数预览）
function formatJson(val: any, maxLen = 600): string {
  if (val === undefined || val === null) return '';
  try {
    const str = typeof val === 'string' ? val : JSON.stringify(val, null, 2);
    return str.length > maxLen ? str.slice(0, maxLen) + '\n…' : str;
  } catch {
    return String(val);
  }
}

// 格式化执行输出（不截断）
function formatResult(val: any): string {
  if (val === undefined || val === null) return '';
  try {
    return typeof val === 'string' ? val : JSON.stringify(val, null, 2);
  } catch {
    return String(val);
  }
}

// 从 args 中提取命令字符串（支持多种字段名）
function extractCommand(args: any): string | null {
  if (!args || typeof args !== 'object') return null;
  // 常见命令类工具的参数字段名
  const keys = ['command', 'cmd', 'bash', 'shell', 'script', 'input', 'code'];
  for (const key of keys) {
    if (typeof args[key] === 'string' && args[key].trim()) {
      return args[key].trim();
    }
  }
  return null;
}

// 根据工具名推断类型标签
type ToolType = 'cmd' | 'mcp' | 'skill' | 'tool';

function classifyTool(name: string): { type: ToolType; tag: string; cls: string } {
  const n = name.toLowerCase();
  // 命令执行类（bash, shell, terminal, run, execute, npx, npm, python 等）
  const cmdKeywords = ['bash', 'shell', 'terminal', 'execute', 'exec', 'run_command',
    'run_shell', 'run_script', 'execute_command', 'computer', 'cmd', 'powershell'];
  if (cmdKeywords.some(k => n === k || n.includes(k))) {
    return { type: 'cmd', tag: 'CMD', cls: 'tool-tag--cmd' };
  }
  if (n.includes('mcp') || n.startsWith('mcp_')) return { type: 'mcp', tag: 'MCP', cls: 'tool-tag--mcp' };
  if (n.includes('skill')) return { type: 'skill', tag: 'Skill', cls: 'tool-tag--skill' };
  return { type: 'tool', tag: '工具', cls: 'tool-tag--tool' };
}

// ── 单条工具调用 ──────────────────────────────────────────
function ToolCallItem({ tc }: { tc: ToolCallEvent }) {
  const [open, setOpen] = useState(false);
  const { type, tag, cls } = classifyTool(tc.name);
  const isDone = tc.status === 'done';
  const isCalling = tc.status === 'calling';
  const isCancelled = tc.status === 'cancelled';

  const dotCls = isCalling ? 'tool-status-dot--calling'
    : isDone ? 'tool-status-dot--done'
    : isCancelled ? 'tool-status-dot--cancelled'
    : 'tool-status-dot--error';

  const statusText = isCalling ? '运行中…'
    : isDone ? '完成'
    : isCancelled ? '已中断'
    : '失败';

  // 命令类工具：优先提取命令字符串显示在标题行
  const inlineCommand = type === 'cmd' ? extractCommand(tc.args) : null;

  const argsStr = formatJson(tc.args);
  const resultStr = formatResult(tc.result); // 输出不截断
  // 命令类且有 inlineCommand 时，展开只显示结果（参数已在标题行）
  const hasDetail = type === 'cmd' ? !!resultStr : !!(argsStr || resultStr);

  return (
    <div className={`tool-call-item ${isDone ? 'tool-call-item--done' : ''}`}>
      <button
        className="tool-call-header"
        onClick={() => hasDetail && setOpen(v => !v)}
        disabled={!hasDetail}
      >
        {/* 状态指示器 */}
        <span className={`tool-status-dot ${dotCls}`} />

        {/* 类型标签 */}
        <span className={`tool-tag ${cls}`}>{tag}</span>

        {/* 命令类：内联显示命令字符串；其他类：显示工具名 */}
        {inlineCommand ? (
          <code className="tool-call-cmd">{inlineCommand}</code>
        ) : (
          <span className="tool-call-name">{tc.name}</span>
        )}

        {/* 状态文字 */}
        <span className="tool-call-status">
          {statusText}
        </span>

        {/* 展开箭头 */}
        {hasDetail && (
          <svg
            className={`tool-chevron ${open ? 'tool-chevron--open' : ''}`}
            viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        )}
      </button>

      {/* 展开详情 */}
      {open && hasDetail && (
        <div className="tool-call-detail">
          {/* 非命令类才在详情中显示参数 */}
          {type !== 'cmd' && argsStr && (
            <div className="tool-detail-section">
              <div className="tool-detail-header">
                <div className="tool-detail-label">输入参数</div>
                <CopyButton text={argsStr} />
              </div>
              <pre className="tool-detail-code">{argsStr}</pre>
            </div>
          )}
          {/* 命令类显示完整命令（若 inline 截断了）和输出 */}
          {type === 'cmd' && inlineCommand && tc.args && (
            <div className="tool-detail-section">
              <div className="tool-detail-header">
                <div className="tool-detail-label">完整命令</div>
                <CopyButton text={inlineCommand} />
              </div>
              <pre className="tool-detail-code">{inlineCommand}</pre>
            </div>
          )}
          {resultStr && (
            <div className="tool-detail-section">
              <div className="tool-detail-header">
                <div className="tool-detail-label">执行输出</div>
                <CopyButton text={resultStr} />
              </div>
              <pre className="tool-detail-code">{resultStr}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── 工具调用列表 ──────────────────────────────────────────
export function ToolCallBlock({ toolCalls }: ToolCallBlockProps) {
  if (!toolCalls || toolCalls.length === 0) return null;
  return (
    <div className="tool-calls-container">
      {toolCalls.map(tc => (
        <ToolCallItem key={tc.id} tc={tc} />
      ))}
    </div>
  );
}

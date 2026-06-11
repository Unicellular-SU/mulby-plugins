import React, { useState, useEffect, useRef } from 'react';
import { Globe, Link2, Code2, FileCode2, ChevronDown, FolderOpen, FileDown } from 'lucide-react';
import { useMulby } from '../hooks/useMulby';
import { pdfService, WebToPdfSource } from '../services/PDFService';
import { PDFHeader, PDFUploadArea } from '../components/SharedPDFComponents';
import { notifyOutput } from '../utils/output';

type Mode = 'url' | 'html' | 'file';
type PageSize = 'A4' | 'A3' | 'Letter' | 'Legal';
type Orientation = 'portrait' | 'landscape';
type MarginMode = 'default' | 'none' | 'custom';
type WaitMode = 'none' | 'time' | 'selector';

const MODE_TABS: Array<{ id: Mode; label: string; icon: React.ReactNode }> = [
    { id: 'url', label: '网址', icon: <Link2 size={16} /> },
    { id: 'html', label: 'HTML 代码', icon: <Code2 size={16} /> },
    { id: 'file', label: '本地文件', icon: <FileCode2 size={16} /> },
];

const PAGE_SIZES: PageSize[] = ['A4', 'A3', 'Letter', 'Legal'];

const inputBaseStyle: React.CSSProperties = {
    width: '100%',
    padding: '12px 14px',
    borderRadius: '12px',
    border: '1px solid var(--border-subtle)',
    background: 'var(--input-bg)',
    fontSize: '14px',
    color: 'var(--text-primary)',
    outline: 'none',
    boxSizing: 'border-box',
};

const labelStyle: React.CSSProperties = {
    fontSize: '13px',
    fontWeight: 600,
    color: 'var(--text-secondary)',
    marginBottom: '6px',
    display: 'block',
};

const WebToPDF: React.FC = () => {
    const { dialog, notification, system } = useMulby('pdf-tools');

    const [mode, setMode] = useState<Mode>('url');
    const [url, setUrl] = useState('');
    const [html, setHtml] = useState('');
    const [filePath, setFilePath] = useState<string | null>(null);

    // 高级设置
    const [showAdvanced, setShowAdvanced] = useState(false);
    const [pageSize, setPageSize] = useState<PageSize>('A4');
    const [orientation, setOrientation] = useState<Orientation>('portrait');
    const [marginMode, setMarginMode] = useState<MarginMode>('default');
    const [margins, setMargins] = useState({ top: 10, right: 10, bottom: 10, left: 10 });
    const [scale, setScale] = useState(1);
    const [printBackground, setPrintBackground] = useState(true);
    const [preferCSSPageSize, setPreferCSSPageSize] = useState(false);
    const [waitMode, setWaitMode] = useState<WaitMode>('time');
    const [waitMs, setWaitMs] = useState(500);
    const [waitSelector, setWaitSelector] = useState('');
    const [autoScroll, setAutoScroll] = useState(false);

    const [processing, setProcessing] = useState(false);
    const [statusText, setStatusText] = useState('');
    const appliedInitRef = useRef(false);

    useEffect(() => {
        const applyInit = (payload?: { input?: unknown; attachments?: Array<{ path?: string; name?: string }> }) => {
            if (appliedInitRef.current) return;
            const text = typeof payload?.input === 'string' ? payload.input.trim() : '';
            const htmlFromAttach = (payload?.attachments || [])
                .map((a) => a?.path)
                .find((p) => typeof p === 'string' && /\.html?$/i.test(p));
            const htmlFile = htmlFromAttach || (/\.html?$/i.test(text) ? text : undefined);

            if (htmlFile) {
                appliedInitRef.current = true;
                setMode('file');
                setFilePath(htmlFile);
                return;
            }
            if (/^https?:\/\//i.test(text) || /^[\w-]+(\.[\w-]+)+(\/|$|:)/i.test(text)) {
                appliedInitRef.current = true;
                setMode('url');
                setUrl(text);
            }
        };

        const off = window.mulby?.onPluginInit?.((payload) => applyInit(payload));
        void (async () => {
            try {
                const res = await window.mulby?.host?.call('pdf-tools', 'getPendingInit');
                applyInit(res?.data as { input?: unknown; attachments?: Array<{ path?: string }> } | undefined);
                void window.mulby?.host?.call('pdf-tools', 'clearPendingInit');
            } catch {
                // host not ready, ignore
            }
        })();

        return () => {
            if (typeof off === 'function') off();
        };
    }, []);

    const handleSelectFile = async () => {
        const result = await dialog.showOpenDialog({
            title: '选择 HTML 文件',
            filters: [{ name: 'HTML Files', extensions: ['html', 'htm'] }],
            properties: ['openFile'],
        });
        if (result && result.length > 0) {
            setFilePath(result[0]);
        }
    };

    const handleDroppedFiles = (paths: string[]) => {
        const htmlPath = paths.find((p) => /\.html?$/i.test(p));
        if (htmlPath) {
            setFilePath(htmlPath);
        } else {
            notification.show('请拖入 .html 文件', 'warning');
        }
    };

    const buildPdfOptions = (): Record<string, unknown> => {
        const opts: Record<string, unknown> = {
            printBackground,
            preferCSSPageSize,
            landscape: orientation === 'landscape',
            pageSize,
            scale: Math.min(2, Math.max(0.1, scale)),
        };
        if (marginMode === 'none') {
            opts.margins = { top: 0, right: 0, bottom: 0, left: 0 };
        } else if (marginMode === 'custom') {
            const mmToInch = (v: number) => Math.max(0, Number(v) || 0) / 25.4;
            opts.margins = {
                top: mmToInch(margins.top),
                right: mmToInch(margins.right),
                bottom: mmToInch(margins.bottom),
                left: mmToInch(margins.left),
            };
        }
        return opts;
    };

    const buildSource = (): WebToPdfSource | null => {
        if (mode === 'url') {
            if (!url.trim()) {
                notification.show('请输入网址', 'warning');
                return null;
            }
            return { kind: 'url', url: url.trim() };
        }
        if (mode === 'html') {
            if (!html.trim()) {
                notification.show('请输入 HTML 内容', 'warning');
                return null;
            }
            return { kind: 'html', html };
        }
        if (!filePath) {
            notification.show('请选择 HTML 文件', 'warning');
            return null;
        }
        return { kind: 'file', path: filePath };
    };

    const buildFileName = (): string => {
        const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        if (mode === 'url') {
            try {
                const normalized = /^https?:\/\//i.test(url.trim()) ? url.trim() : `https://${url.trim()}`;
                const host = new URL(normalized).hostname.replace(/^www\./, '');
                return `${host || 'web'}_${stamp}.pdf`;
            } catch {
                return `web_${stamp}.pdf`;
            }
        }
        if (mode === 'file' && filePath) {
            const base = filePath.split(/[/\\]/).pop()?.replace(/\.html?$/i, '') || 'web';
            return `${base}.pdf`;
        }
        return `web_${Date.now()}.pdf`;
    };

    const handleGenerate = async () => {
        const source = buildSource();
        if (!source) return;

        try {
            setProcessing(true);
            setStatusText('正在渲染页面…');

            const downloadsPath = await system.getPath('downloads');
            const outputDir = downloadsPath || '.';

            const outputPath = await pdfService.webToPdf({
                source,
                pdfOptions: buildPdfOptions(),
                waitMs: waitMode === 'time' ? waitMs : undefined,
                waitSelector: waitMode === 'selector' ? waitSelector : undefined,
                autoScroll,
                outputDir,
                fileName: buildFileName(),
            });

            setStatusText('');
            notifyOutput(notification, outputPath, 'PDF 已生成');
        } catch (error: any) {
            setStatusText('');
            notification.show(`生成失败: ${error?.message || error}`, 'error');
        } finally {
            setProcessing(false);
        }
    };

    const renderModeInput = () => {
        if (mode === 'url') {
            return (
                <div>
                    <label style={labelStyle}>网址 URL</label>
                    <input
                        type="text"
                        value={url}
                        onChange={(e) => setUrl(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter' && !processing) void handleGenerate(); }}
                        placeholder="https://example.com 或 example.com"
                        style={inputBaseStyle}
                    />
                    <p style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginTop: '8px' }}>
                        将完整渲染该网页后导出为 PDF（仅支持公开可访问的页面）。
                    </p>
                </div>
            );
        }
        if (mode === 'html') {
            return (
                <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
                    <label style={labelStyle}>HTML 代码</label>
                    <textarea
                        value={html}
                        onChange={(e) => setHtml(e.target.value)}
                        placeholder={'<html>\n  <body>\n    <h1>Hello PDF</h1>\n  </body>\n</html>'}
                        style={{
                            ...inputBaseStyle,
                            flex: 1,
                            minHeight: '180px',
                            resize: 'none',
                            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                            lineHeight: 1.6,
                        }}
                    />
                </div>
            );
        }
        return (
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
                <label style={labelStyle}>本地 HTML 文件</label>
                {filePath ? (
                    <div style={{
                        display: 'flex', alignItems: 'center', gap: '12px',
                        padding: '16px', borderRadius: '12px',
                        background: 'var(--card-bg-strong)', border: '1px solid var(--border-subtle)',
                    }}>
                        <FileCode2 size={24} color="var(--primary-color)" />
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: '14px', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={filePath}>
                                {filePath.split(/[/\\]/).pop()}
                            </div>
                            <div style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>已选择</div>
                        </div>
                        <button onClick={handleSelectFile} style={{
                            display: 'flex', alignItems: 'center', gap: '6px',
                            padding: '8px 14px', borderRadius: '10px', border: '1px solid var(--border-subtle)',
                            background: 'var(--card-bg-strong)', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '13px',
                        }}>
                            <FolderOpen size={16} /> 更换
                        </button>
                    </div>
                ) : (
                    <div style={{ flex: 1, minHeight: '160px', display: 'flex' }}>
                        <PDFUploadArea
                            onClick={handleSelectFile}
                            onFileDrop={(paths) => handleDroppedFiles(paths)}
                            title="点击选择 HTML 文件"
                            subTitle="或将 .html / .htm 文件拖放到此处"
                            icon={<FileCode2 size={40} color="white" />}
                        />
                    </div>
                )}
            </div>
        );
    };

    return (
        <div style={{ padding: '16px', height: '100%', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <PDFHeader title="网页转 PDF" icon={<Globe size={28} color="var(--primary-color)" />} />

            {/* 输入模式切换 */}
            <div style={{
                display: 'flex', gap: '4px', padding: '4px',
                background: 'var(--track-bg)', borderRadius: '12px', alignSelf: 'flex-start',
            }}>
                {MODE_TABS.map((tab) => {
                    const active = mode === tab.id;
                    return (
                        <button
                            key={tab.id}
                            onClick={() => setMode(tab.id)}
                            style={{
                                display: 'flex', alignItems: 'center', gap: '6px',
                                padding: '8px 16px', borderRadius: '9px', border: 'none', cursor: 'pointer',
                                background: active ? 'var(--surface)' : 'transparent',
                                color: active ? 'var(--primary-color)' : 'var(--text-secondary)',
                                fontWeight: active ? 600 : 500, fontSize: '13px',
                                boxShadow: active ? '0 2px 8px rgba(0,0,0,0.08)' : 'none',
                                transition: 'all 0.2s ease',
                            }}
                        >
                            {tab.icon} {tab.label}
                        </button>
                    );
                })}
            </div>

            {/* 输入区 */}
            <div style={{
                background: 'var(--card-bg)', backdropFilter: 'blur(10px)',
                padding: '16px', borderRadius: '16px', border: 'var(--glass-border)',
                display: 'flex', flexDirection: 'column',
                flex: mode === 'url' ? '0 0 auto' : 1, minHeight: 0,
            }}>
                {renderModeInput()}
            </div>

            {/* 高级设置 */}
            <div style={{
                background: 'var(--card-bg)', borderRadius: '16px',
                border: 'var(--glass-border)', flexShrink: 0,
            }}>
                <button
                    onClick={() => setShowAdvanced((v) => !v)}
                    style={{
                        width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '14px 16px', background: 'transparent', border: 'none', cursor: 'pointer',
                        fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)',
                    }}
                >
                    <span>高级设置</span>
                    <ChevronDown size={18} style={{ transform: showAdvanced ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
                </button>

                {showAdvanced && (
                    <div style={{ padding: '0 16px 16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px' }}>
                            <div>
                                <label style={labelStyle}>纸张大小</label>
                                <select value={pageSize} onChange={(e) => setPageSize(e.target.value as PageSize)} style={inputBaseStyle}>
                                    {PAGE_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
                                </select>
                            </div>
                            <div>
                                <label style={labelStyle}>方向</label>
                                <select value={orientation} onChange={(e) => setOrientation(e.target.value as Orientation)} style={inputBaseStyle}>
                                    <option value="portrait">纵向</option>
                                    <option value="landscape">横向</option>
                                </select>
                            </div>
                            <div>
                                <label style={labelStyle}>边距</label>
                                <select value={marginMode} onChange={(e) => setMarginMode(e.target.value as MarginMode)} style={inputBaseStyle}>
                                    <option value="default">默认</option>
                                    <option value="none">无</option>
                                    <option value="custom">自定义</option>
                                </select>
                            </div>
                            <div>
                                <label style={labelStyle}>缩放（{scale.toFixed(2)}）</label>
                                <input type="range" min={0.5} max={2} step={0.05} value={scale}
                                    onChange={(e) => setScale(Number(e.target.value))}
                                    style={{ width: '100%', accentColor: 'var(--primary-color)', marginTop: '8px' }} />
                            </div>
                        </div>

                        {marginMode === 'custom' && (
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' }}>
                                {(['top', 'right', 'bottom', 'left'] as const).map((side) => (
                                    <div key={side}>
                                        <label style={labelStyle}>{({ top: '上', right: '右', bottom: '下', left: '左' } as const)[side]} (mm)</label>
                                        <input type="number" min={0} value={margins[side]}
                                            onChange={(e) => setMargins((m) => ({ ...m, [side]: Number(e.target.value) }))}
                                            style={inputBaseStyle} />
                                    </div>
                                ))}
                            </div>
                        )}

                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
                            <div>
                                <label style={labelStyle}>渲染等待</label>
                                <select value={waitMode} onChange={(e) => setWaitMode(e.target.value as WaitMode)} style={inputBaseStyle}>
                                    <option value="none">不等待</option>
                                    <option value="time">固定时间</option>
                                    <option value="selector">等待元素出现</option>
                                </select>
                            </div>
                            {waitMode === 'time' && (
                                <div>
                                    <label style={labelStyle}>等待毫秒</label>
                                    <input type="number" min={0} step={100} value={waitMs}
                                        onChange={(e) => setWaitMs(Number(e.target.value))} style={inputBaseStyle} />
                                </div>
                            )}
                            {waitMode === 'selector' && (
                                <div>
                                    <label style={labelStyle}>CSS 选择器</label>
                                    <input type="text" value={waitSelector} placeholder="#content"
                                        onChange={(e) => setWaitSelector(e.target.value)} style={inputBaseStyle} />
                                </div>
                            )}
                        </div>

                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '20px' }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--text-secondary)', cursor: 'pointer' }}>
                                <input type="checkbox" checked={printBackground} onChange={(e) => setPrintBackground(e.target.checked)} style={{ accentColor: 'var(--primary-color)' }} />
                                打印背景图/色
                            </label>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--text-secondary)', cursor: 'pointer' }}>
                                <input type="checkbox" checked={preferCSSPageSize} onChange={(e) => setPreferCSSPageSize(e.target.checked)} style={{ accentColor: 'var(--primary-color)' }} />
                                优先页面 CSS 尺寸
                            </label>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--text-secondary)', cursor: 'pointer' }}>
                                <input type="checkbox" checked={autoScroll} onChange={(e) => setAutoScroll(e.target.checked)} style={{ accentColor: 'var(--primary-color)' }} />
                                自动滚动加载
                            </label>
                        </div>
                    </div>
                )}
            </div>

            {/* 生成按钮 */}
            <button
                onClick={handleGenerate}
                disabled={processing}
                style={{
                    width: '100%', padding: '16px', border: 'none', borderRadius: '14px',
                    background: processing ? 'rgba(0,0,0,0.05)' : 'linear-gradient(135deg, #007AFF 0%, #0056b3 100%)',
                    color: processing ? 'var(--text-secondary)' : 'white',
                    fontSize: '16px', fontWeight: 600, cursor: processing ? 'not-allowed' : 'pointer',
                    boxShadow: processing ? 'none' : '0 8px 20px rgba(0, 122, 255, 0.3)',
                    transition: 'all 0.3s ease', flexShrink: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                }}
            >
                {!processing && <FileDown size={20} />}
                {processing ? (statusText || '生成中…') : '生成 PDF'}
            </button>
        </div>
    );
};

export default WebToPDF;

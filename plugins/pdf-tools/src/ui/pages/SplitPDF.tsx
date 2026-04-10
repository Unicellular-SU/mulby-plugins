import React, { useEffect, useRef, useState } from 'react';
import { Scissors, Plus, Trash2, ArrowRight, LayoutGrid, List } from 'lucide-react';
import { PDFHeader, PDFUploadArea, PDFPageThumbnail } from '../components/SharedPDFComponents';
import { useMulby } from '../hooks/useMulby';
import { pdfService } from '../services/PDFService';
import '../types';
import { PDFInfo, SplitRange } from '../types';

// PDFPageThumbnail moved to SharedPDFComponents

const SplitPDF: React.FC = () => {
    const { dialog, notification, system } = useMulby('pdf-tools');
    const [file, setFile] = useState<string | null>(null);
    const [info, setInfo] = useState<PDFInfo | null>(null);
    const [pdfDoc, setPdfDoc] = useState<any>(null);
    const [mode, setMode] = useState<'auto' | 'manual'>('auto');
    const [ranges, setRanges] = useState<SplitRange[]>([]);
    const [splitting, setSplitting] = useState(false);
    const appliedInitRef = useRef(false);

    const loadFile = async (filePath: string) => {
        setFile(filePath);
        try {
            const nextInfo = await window.pdfApi?.getPDFInfo(filePath);
            setInfo(nextInfo || null);
            setRanges([{ start: 1, end: nextInfo?.pageCount || 1, name: 'part_1' }]);

            const doc = await pdfService.getDocument(filePath);
            setPdfDoc(doc);
        } catch (error) {
            console.error(error);
            notification.show('读取PDF失败', 'error');
        }
    };

    const handleDroppedFiles = async (paths: string[], rawFiles: File[] = []) => {
        const pdfPath = paths.find(path => /\.pdf$/i.test(path));
        if (pdfPath) {
            await loadFile(pdfPath);
            return;
        }

        const droppedPdf = rawFiles.find(file => file.type === 'application/pdf' || /\.pdf$/i.test(file.name || ''));
        if (!droppedPdf) {
            notification.show('请拖入 PDF 文件', 'warning');
            return;
        }

        try {
            const bytes = new Uint8Array(await droppedPdf.arrayBuffer());
            const tempPath = await window.pdfApi?.saveTempFileFromDrop(droppedPdf.name || 'dropped.pdf', bytes);
            if (!tempPath) {
                notification.show('拖放文件读取失败，请重试', 'error');
                return;
            }
            await loadFile(tempPath);
        } catch (error) {
            notification.show('拖放文件读取失败，请重试', 'error');
        }
    };

    const handleSelectFile = async () => {
        const result = await dialog.showOpenDialog({
            title: '选择 PDF 文件',
            filters: [{ name: 'PDF Files', extensions: ['pdf'] }],
            properties: ['openFile']
        });

        if (result && result.length > 0) {
            const filePath = result[0];
            await loadFile(filePath);
        }
    };

    useEffect(() => {
        const applyFromInit = (payload?: { input?: string; attachments?: Array<{ path?: string }> }) => {
            if (appliedInitRef.current) return;
            const attachmentPath = payload?.attachments?.find(item => typeof item.path === 'string' && /\.pdf$/i.test(item.path || ''))?.path;
            const inputPath = typeof payload?.input === 'string' && /\.pdf$/i.test(payload.input) ? payload.input : undefined;
            const initPath = attachmentPath || inputPath;
            if (!initPath) return;
            appliedInitRef.current = true;
            void loadFile(initPath);
        };

        const off = window.mulby?.onPluginInit?.((payload) => {
            applyFromInit(payload);
        });

        void (async () => {
            try {
                const res = await window.mulby?.host?.call('pdf-tools', 'getPendingInit');
                applyFromInit(res?.data as { input?: string; attachments?: Array<{ path?: string }> } | undefined);
            } catch {
                // host not ready, ignore
            }
        })();

        return () => {
            if (typeof off === 'function') {
                off();
            }
        };
    }, []);

    const handleSplit = async () => {
        if (!file) return;

        try {
            setSplitting(true);
            const downloadsPath = await system.getPath('downloads');
            const outputDir = downloadsPath || '.';
            const filename = file.split('/').pop()?.replace('.pdf', '') || 'split';

            if (mode === 'auto') {
                await window.pdfApi?.splitPDFByPage(file, outputDir, filename);
            } else {
                await window.pdfApi?.splitPDFByRanges(file, ranges, outputDir);
            }

            notification.show('拆分成功！文件已保存到下载目录', 'success');
        } catch (error: any) {
            notification.show(`拆分失败: ${error.message}`, 'error');
        } finally {
            setSplitting(false);
        }
    };

    const addRange = () => {
        setRanges([...ranges, { start: 1, end: info?.pageCount || 1, name: `part_${ranges.length + 1}` }]);
    };

    const updateRange = (index: number, field: 'start' | 'end' | 'name', value: number | string) => {
        const newRanges = [...ranges];
        if (field === 'start' || field === 'end') {
            newRanges[index][field] = Math.max(1, Math.min(info?.pageCount || 1, value as number));
        } else {
            newRanges[index][field] = value as string;
        }
        setRanges(newRanges);
    };

    const removeRange = (index: number) => {
        setRanges(ranges.filter((_, i) => i !== index));
    };

    const isPageInRange = (pageNum: number) => {
        if (mode === 'auto') return true;
        return ranges.some(range => pageNum >= range.start && pageNum <= range.end);
    };

    return (
        <div style={{ padding: '16px', height: '100%', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <PDFHeader
                title="拆分 PDF"
                icon={<Scissors color="var(--primary-color)" size={28} />}
                actionButton={file ? {
                    label: "更换文件",
                    onClick: handleSelectFile
                } : undefined}
            />

            {!file ? (
                <PDFUploadArea onClick={handleSelectFile} title="点击选择 PDF 文件" onFileDrop={(paths, rawFiles) => { void handleDroppedFiles(paths, rawFiles); }} />
            ) : (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '16px', overflow: 'hidden' }}>
                    {/* Settings Area */}
                    <div style={{ display: 'flex', gap: '16px', alignItems: 'center', background: 'rgba(255,255,255,0.6)', padding: '12px', borderRadius: '16px', backdropFilter: 'blur(10px)' }}>

                        {/* Mode Toggle */}
                        <div style={{ display: 'flex', background: 'rgba(0,0,0,0.05)', borderRadius: '10px', padding: '4px' }}>
                            <button
                                onClick={() => setMode('auto')}
                                style={{
                                    border: 'none', background: mode === 'auto' ? '#fff' : 'transparent',
                                    borderRadius: '8px', padding: '6px 12px', cursor: 'pointer',
                                    fontWeight: mode === 'auto' ? '600' : '500',
                                    boxShadow: mode === 'auto' ? '0 2px 8px rgba(0,0,0,0.1)' : 'none',
                                    color: mode === 'auto' ? '#000' : 'var(--text-secondary)',
                                    display: 'flex', alignItems: 'center', gap: '6px'
                                }}
                            >
                                <LayoutGrid size={16} /> 自动拆分
                            </button>
                            <button
                                onClick={() => setMode('manual')}
                                style={{
                                    border: 'none', background: mode === 'manual' ? '#fff' : 'transparent',
                                    borderRadius: '8px', padding: '6px 12px', cursor: 'pointer',
                                    fontWeight: mode === 'manual' ? '600' : '500',
                                    boxShadow: mode === 'manual' ? '0 2px 8px rgba(0,0,0,0.1)' : 'none',
                                    color: mode === 'manual' ? '#000' : 'var(--text-secondary)',
                                    display: 'flex', alignItems: 'center', gap: '6px'
                                }}
                            >
                                <List size={16} /> 手动范围
                            </button>
                        </div>

                        {/* Manual Mode Inputs */}
                        {mode === 'manual' && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflowX: 'auto', flex: 1 }}>
                                {ranges.map((range, index) => (
                                    <div key={index} style={{
                                        display: 'flex', alignItems: 'center', background: '#fff',
                                        padding: '4px 8px', borderRadius: '8px', border: '1px solid #eee',
                                        gap: '6px', minWidth: 'fit-content'
                                    }}>
                                        <div style={{ fontSize: '12px', fontWeight: '500', width: '40px', color: '#666', borderRight: '1px solid #eee', paddingRight: '6px' }}>
                                            Part {index + 1}
                                        </div>
                                        <input
                                            type="number" min="1" max={range.end}
                                            value={range.start}
                                            onChange={(e) => updateRange(index, 'start', parseInt(e.target.value) || 1)}
                                            style={{ width: '40px', border: 'none', background: 'transparent', textAlign: 'center', fontWeight: '600' }}
                                        />
                                        <ArrowRight size={14} color="#999" />
                                        <input
                                            type="number" min={range.start} max={info?.pageCount || 1}
                                            value={range.end}
                                            onChange={(e) => updateRange(index, 'end', parseInt(e.target.value) || 1)}
                                            style={{ width: '40px', border: 'none', background: 'transparent', textAlign: 'center', fontWeight: '600' }}
                                        />
                                        {ranges.length > 1 && (
                                            <button onClick={() => removeRange(index)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: '2px' }}>
                                                <Trash2 size={14} color="#FF3B30" />
                                            </button>
                                        )}
                                    </div>
                                ))}
                                <button onClick={addRange} style={{
                                    border: 'none', background: 'var(--primary-color)', color: 'white',
                                    borderRadius: '8px', width: '28px', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    cursor: 'pointer', flexShrink: 0
                                }}>
                                    <Plus size={16} />
                                </button>
                            </div>
                        )}

                        {/* Auto Mode Info (Optional place holder) */}
                        {mode === 'auto' && (
                            <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginLeft: '8px' }}>
                                每页拆分为单独的 PDF 文件
                            </div>
                        )}
                    </div>

                    {/* Preview Area */}
                    <div style={{ flex: 1, overflowY: 'auto', background: 'rgba(0,0,0,0.02)', borderRadius: '16px', padding: '16px' }}>
                        {pdfDoc ? (
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '16px' }}>
                                {Array.from({ length: info?.pageCount || 0 }).map((_, i) => {
                                    const pageNum = i + 1;
                                    const isInRange = isPageInRange(pageNum);
                                    return (
                                        <div key={i} style={{ opacity: isInRange ? 1 : 0.3, transition: 'opacity 0.2s', position: 'relative' }}>
                                            <PDFPageThumbnail pdfDoc={pdfDoc} pageNum={pageNum} />
                                        </div>
                                    );
                                })}
                            </div>
                        ) : (
                            <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#999' }}>
                                加载预览中...
                            </div>
                        )}
                    </div>

                    {/* Footer / Action */}
                    <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: '16px' }}>
                        <button
                            onClick={handleSplit}
                            disabled={splitting || !file}
                            style={{
                                width: '200px',
                                padding: '14px',
                                background: splitting || !file ? 'rgba(0,0,0,0.05)' : 'linear-gradient(135deg, #007AFF 0%, #0056b3 100%)',
                                color: splitting || !file ? 'var(--text-secondary)' : 'white',
                                border: 'none',
                                borderRadius: '12px',
                                fontSize: '16px',
                                fontWeight: '600',
                                cursor: splitting || !file ? 'not-allowed' : 'pointer',
                                boxShadow: splitting || !file ? 'none' : '0 4px 12px rgba(0, 122, 255, 0.3)',
                                transition: 'all 0.3s ease',
                                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px'
                            }}
                        >
                            {splitting ? '拆分中...' : <><Scissors size={18} /> 开始拆分</>}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default SplitPDF;

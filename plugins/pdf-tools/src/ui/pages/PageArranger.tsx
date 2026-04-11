import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    Crop,
    FileEdit,
    RotateCw,
    RotateCcw,
    Scissors,
    Trash2,
    Undo2,
    Save,
} from 'lucide-react';
import { PDFHeader, PDFUploadArea, PDFPageThumbnail } from '../components/SharedPDFComponents';
import { useMulby } from '../hooks/useMulby';
import { pdfService } from '../services/PDFService';
import { getInitPdfPaths } from '../utils/initPayload';
import '../types';

type CropMode = 'none' | 'box' | 'margin';
type ResizeHandle = 'nw' | 'ne' | 'sw' | 'se';

interface CropBoxRatio {
    left: number;
    bottom: number;
    width: number;
    height: number;
}

interface CropMarginRatio {
    top: number;
    right: number;
    bottom: number;
    left: number;
}

interface PageCropState {
    mode: CropMode;
    box: CropBoxRatio;
    margin: CropMarginRatio;
}

interface ArrangerPage {
    sourceIndex: number;
    width: number;
    height: number;
    rotate: number;
    crop: PageCropState;
}

interface DragState {
    type: 'move' | 'resize';
    handle?: ResizeHandle;
    startX: number;
    startY: number;
    startBox: CropBoxRatio;
}

const DEFAULT_BOX: CropBoxRatio = { left: 0.1, bottom: 0.1, width: 0.8, height: 0.8 };
const DEFAULT_MARGIN: CropMarginRatio = { top: 0, right: 0, bottom: 0, left: 0 };

const normalizeRotate = (value: number) => ((Math.round(value / 90) * 90) % 360 + 360) % 360;

const clonePages = (pages: ArrangerPage[]): ArrangerPage[] => pages.map((page) => ({
    ...page,
    crop: {
        mode: page.crop.mode,
        box: { ...page.crop.box },
        margin: { ...page.crop.margin },
    },
}));

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const PageArranger: React.FC = () => {
    const { dialog, notification, system, clipboard } = useMulby('pdf-tools');
    const [file, setFile] = useState<string | null>(null);
    const [pdfDoc, setPdfDoc] = useState<any>(null);
    const [pages, setPages] = useState<ArrangerPage[]>([]);
    const [selectedIds, setSelectedIds] = useState<number[]>([]);
    const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
    const [processing, setProcessing] = useState(false);
    const [overwriteOriginal, setOverwriteOriginal] = useState(false);
    const [undoSnapshot, setUndoSnapshot] = useState<ArrangerPage[] | null>(null);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [previewLoading, setPreviewLoading] = useState(false);
    const [dragState, setDragState] = useState<DragState | null>(null);
    const [appliedInit, setAppliedInit] = useState(false);
    const previewRef = useRef<HTMLDivElement>(null);

    const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
    const selectedPages = useMemo(() => pages.filter(page => selectedSet.has(page.sourceIndex)), [pages, selectedSet]);
    const activePage = selectedPages[0] || null;

    const loadFile = async (filePath: string) => {
        setFile(filePath);
        try {
            const meta = await window.pdfApi?.getPDFPageMeta(filePath);
            const nextPages: ArrangerPage[] = (meta?.pages || []).map((page: { index: number; width: number; height: number; rotation?: number }) => ({
                sourceIndex: page.index,
                width: page.width,
                height: page.height,
                rotate: normalizeRotate(page.rotation || 0),
                crop: {
                    mode: 'none',
                    box: { ...DEFAULT_BOX },
                    margin: { ...DEFAULT_MARGIN },
                },
            }));
            setPages(nextPages);
            setSelectedIds(nextPages.length ? [nextPages[0].sourceIndex] : []);
            setUndoSnapshot(null);
            const doc = await pdfService.getDocument(filePath);
            setPdfDoc(doc);
        } catch (error: any) {
            notification.show(`读取PDF失败: ${error.message || error}`, 'error');
        }
    };

    const handleSelectFile = async () => {
        const result = await dialog.showOpenDialog({
            title: '选择 PDF 文件',
            filters: [{ name: 'PDF Files', extensions: ['pdf'] }],
            properties: ['openFile'],
        });
        if (result?.length) {
            await loadFile(result[0]);
        }
    };

    const handleDroppedFiles = async (paths: string[], rawFiles: File[] = []) => {
        const pathPdf = paths.find(path => /\.pdf$/i.test(path));
        if (pathPdf) {
            await loadFile(pathPdf);
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
        } catch {
            notification.show('拖放文件读取失败，请重试', 'error');
        }
    };

    useEffect(() => {
        const applyFromInit = async (payload?: { input?: unknown; attachments?: Array<{ path?: string; name?: string }> }) => {
            if (appliedInit) return;
            const paths = await getInitPdfPaths(payload, clipboard.readFiles);
            if (!paths.length) return;
            setAppliedInit(true);
            await loadFile(paths[0]);
            if (paths.length > 1) {
                notification.show(`检测到 ${paths.length} 个 PDF，页面编排仅加载第一个`, 'info');
            }
            void window.mulby?.host?.call('pdf-tools', 'clearPendingInit');
        };

        const off = window.mulby?.onPluginInit?.((payload) => {
            void applyFromInit(payload);
        });

        void (async () => {
            try {
                const res = await window.mulby?.host?.call('pdf-tools', 'getPendingInit');
                await applyFromInit(res?.data as { input?: unknown; attachments?: Array<{ path?: string; name?: string }> } | undefined);
            } catch {
                // ignore host not ready
            }
        })();

        return () => {
            if (typeof off === 'function') off();
        };
    }, [appliedInit, clipboard.readFiles]);

    useEffect(() => {
        if (!file || !activePage) {
            setPreviewUrl(null);
            return;
        }
        setPreviewLoading(true);
        void pdfService.renderPageToDataURL(file, activePage.sourceIndex, 0.9, activePage.rotate)
            .then(setPreviewUrl)
            .catch(() => setPreviewUrl(null))
            .finally(() => setPreviewLoading(false));
    }, [file, activePage?.sourceIndex, activePage?.rotate]);

    useEffect(() => {
        if (!dragState) return;
        const onPointerMove = (event: PointerEvent) => {
            if (!activePage || activePage.crop.mode !== 'box' || !previewRef.current) return;
            const rect = previewRef.current.getBoundingClientRect();
            if (!rect.width || !rect.height) return;
            const dx = (event.clientX - dragState.startX) / rect.width;
            const dy = (event.clientY - dragState.startY) / rect.height;

            const { startBox } = dragState;
            const next = { ...startBox };
            const minSize = 0.05;

            if (dragState.type === 'move') {
                next.left = clamp(startBox.left + dx, 0, 1 - startBox.width);
                next.bottom = clamp(startBox.bottom - dy, 0, 1 - startBox.height);
            } else {
                switch (dragState.handle) {
                    case 'nw': {
                        const top = startBox.bottom + startBox.height - dy;
                        const right = startBox.left + startBox.width;
                        next.left = clamp(startBox.left + dx, 0, right - minSize);
                        next.bottom = clamp(startBox.bottom, 0, top - minSize);
                        next.width = clamp(right - next.left, minSize, 1);
                        next.height = clamp(top - next.bottom, minSize, 1);
                        break;
                    }
                    case 'ne': {
                        const top = startBox.bottom + startBox.height - dy;
                        next.left = clamp(startBox.left, 0, 1 - minSize);
                        next.bottom = clamp(startBox.bottom, 0, top - minSize);
                        next.width = clamp(startBox.width + dx, minSize, 1 - next.left);
                        next.height = clamp(top - next.bottom, minSize, 1);
                        break;
                    }
                    case 'sw': {
                        const right = startBox.left + startBox.width;
                        next.left = clamp(startBox.left + dx, 0, right - minSize);
                        next.bottom = clamp(startBox.bottom - dy, 0, 1 - minSize);
                        next.width = clamp(right - next.left, minSize, 1);
                        next.height = clamp(startBox.height + dy, minSize, 1 - next.bottom);
                        break;
                    }
                    case 'se': {
                        next.left = clamp(startBox.left, 0, 1 - minSize);
                        next.bottom = clamp(startBox.bottom - dy, 0, 1 - minSize);
                        next.width = clamp(startBox.width + dx, minSize, 1 - next.left);
                        next.height = clamp(startBox.height + dy, minSize, 1 - next.bottom);
                        break;
                    }
                }
            }

            setPages(prev => prev.map(page =>
                page.sourceIndex === activePage.sourceIndex
                    ? { ...page, crop: { ...page.crop, mode: 'box', box: next } }
                    : page
            ));
        };

        const onPointerUp = () => setDragState(null);
        window.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerup', onPointerUp);
        return () => {
            window.removeEventListener('pointermove', onPointerMove);
            window.removeEventListener('pointerup', onPointerUp);
        };
    }, [dragState, activePage]);

    const selectPage = (sourceIndex: number, multi: boolean) => {
        if (!multi) {
            setSelectedIds([sourceIndex]);
            return;
        }
        setSelectedIds(prev => {
            if (prev.includes(sourceIndex)) {
                const next = prev.filter(id => id !== sourceIndex);
                return next.length ? next : [sourceIndex];
            }
            return [...prev, sourceIndex];
        });
    };

    const reorderPage = (from: number, to: number) => {
        if (from === to || from < 0 || to < 0) return;
        setPages(prev => {
            const next = [...prev];
            const [moved] = next.splice(from, 1);
            next.splice(to, 0, moved);
            return next;
        });
    };

    const rotateSelected = (delta: number) => {
        if (!selectedIds.length) return;
        setPages(prev => prev.map(page =>
            selectedSet.has(page.sourceIndex)
                ? { ...page, rotate: normalizeRotate(page.rotate + delta) }
                : page
        ));
    };

    const removeSelected = () => {
        if (!selectedIds.length) return;
        setUndoSnapshot(clonePages(pages));
        const next = pages.filter(page => !selectedSet.has(page.sourceIndex));
        setPages(next);
        setSelectedIds(next.length ? [next[0].sourceIndex] : []);
    };

    const undoDelete = () => {
        if (!undoSnapshot) return;
        setPages(clonePages(undoSnapshot));
        setSelectedIds(undoSnapshot.length ? [undoSnapshot[0].sourceIndex] : []);
        setUndoSnapshot(null);
    };

    const updateActiveCropMode = (mode: CropMode) => {
        if (!activePage) return;
        setPages(prev => prev.map(page =>
            page.sourceIndex === activePage.sourceIndex
                ? { ...page, crop: { ...page.crop, mode } }
                : page
        ));
    };

    const updateMargin = (key: keyof CropMarginRatio, value: number) => {
        if (!activePage) return;
        const safe = clamp(value, 0, 0.45);
        setPages(prev => prev.map(page =>
            page.sourceIndex === activePage.sourceIndex
                ? { ...page, crop: { ...page.crop, mode: 'margin', margin: { ...page.crop.margin, [key]: safe } } }
                : page
        ));
    };

    const applyActiveCropToSelected = () => {
        if (!activePage || selectedPages.length <= 1) return;
        setPages(prev => prev.map(page =>
            selectedSet.has(page.sourceIndex)
                ? {
                    ...page,
                    crop: {
                        mode: activePage.crop.mode,
                        box: { ...activePage.crop.box },
                        margin: { ...activePage.crop.margin },
                    },
                }
                : page
        ));
    };

    const buildArrangePages = (sourcePages: ArrangerPage[]) => sourcePages.map(page => {
        let crop: any = undefined;
        if (page.crop.mode === 'box') {
            crop = { mode: 'box', unit: 'ratio', box: page.crop.box };
        } else if (page.crop.mode === 'margin') {
            crop = { mode: 'margin', unit: 'ratio', margin: page.crop.margin };
        }
        return {
            sourceIndex: page.sourceIndex,
            rotate: page.rotate,
            crop,
        };
    });

    const exportPages = async (targetPages: ArrangerPage[], suffix: string) => {
        if (!file || !targetPages.length) return;
        setProcessing(true);
        try {
            const downloadsPath = await system.getPath('downloads');
            const outputDir = downloadsPath || '.';
            const baseName = file.split(/[/\\]/).pop()?.replace(/\.pdf$/i, '') || 'arranged';
            const fileName = `${baseName}_${suffix}.pdf`;
            const result = await window.pdfApi?.arrangePDF({
                sourcePath: file,
                pages: buildArrangePages(targetPages),
                outputDir,
                fileName,
                overwriteOriginal,
            });
            if (result?.outputPath) {
                const name = result.outputPath.split(/[/\\]/).pop() || result.outputPath;
                const overwriteNote = result.overwritten ? '（已覆盖原文件）' : '';
                notification.show(`导出成功：${name}${overwriteNote}`, 'success');
            }
        } catch (error: any) {
            notification.show(`导出失败: ${error.message || error}`, 'error');
        } finally {
            setProcessing(false);
        }
    };

    const handleExportAll = async () => {
        await exportPages(pages, 'arranged');
    };

    const handleExtractSelected = async () => {
        if (!selectedPages.length) {
            notification.show('请先选择要提取的页面', 'warning');
            return;
        }
        const target = pages.filter(page => selectedSet.has(page.sourceIndex));
        await exportPages(target, 'extracted');
    };

    const boxRectStyle = activePage?.crop.box
        ? {
            left: `${activePage.crop.box.left * 100}%`,
            bottom: `${activePage.crop.box.bottom * 100}%`,
            width: `${activePage.crop.box.width * 100}%`,
            height: `${activePage.crop.box.height * 100}%`,
        }
        : null;

    return (
        <div style={{ padding: '16px', height: '100%', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <PDFHeader
                title="页面编排器"
                icon={<FileEdit color="var(--primary-color)" size={28} />}
                actionButton={file ? { label: '更换文件', onClick: handleSelectFile } : undefined}
                secondaryAction={undoSnapshot ? { label: '撤销删除', icon: <Undo2 size={16} />, onClick: undoDelete } : undefined}
            />

            {!file ? (
                <PDFUploadArea
                    onClick={handleSelectFile}
                    title="点击选择单个 PDF 文件"
                    subTitle="支持拖入 PDF 后进行页面编排"
                    onFileDrop={(paths, rawFiles) => { void handleDroppedFiles(paths, rawFiles); }}
                />
            ) : (
                <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateRows: '1fr 170px', gap: '16px' }}>
                    <div style={{ minHeight: 0, display: 'grid', gridTemplateColumns: '1fr 320px', gap: '16px' }}>
                        <div style={{
                            background: 'rgba(255,255,255,0.55)',
                            border: '1px solid rgba(255,255,255,0.45)',
                            borderRadius: '16px',
                            padding: '12px',
                            position: 'relative',
                            overflow: 'hidden',
                        }}>
                            {!activePage ? (
                                <div style={emptyStateStyle}>请选择页面查看裁剪预览</div>
                            ) : (
                                <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '8px' }}>
                                    <div
                                        ref={previewRef}
                                        style={{
                                            position: 'relative',
                                            height: '100%',
                                            maxHeight: '100%',
                                            aspectRatio: '1/1.414',
                                            maxWidth: '100%',
                                            background: '#fff',
                                            borderRadius: '10px',
                                            boxShadow: '0 10px 26px rgba(0,0,0,0.08)',
                                            overflow: 'hidden',
                                        }}
                                    >
                                        {previewUrl && <img src={previewUrl} alt="preview" style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />}
                                        {previewLoading && <div style={loadingOverlayStyle}>加载中...</div>}

                                        {activePage.crop.mode === 'box' && boxRectStyle && (
                                            <div
                                                style={{
                                                    position: 'absolute',
                                                    border: '2px solid #007AFF',
                                                    background: 'rgba(0,122,255,0.12)',
                                                    cursor: 'move',
                                                    ...boxRectStyle,
                                                }}
                                                onPointerDown={(e) => {
                                                    e.preventDefault();
                                                    setDragState({
                                                        type: 'move',
                                                        startX: e.clientX,
                                                        startY: e.clientY,
                                                        startBox: { ...activePage.crop.box },
                                                    });
                                                }}
                                            >
                                                {(['nw', 'ne', 'sw', 'se'] as ResizeHandle[]).map(handle => (
                                                    <div
                                                        key={handle}
                                                        onPointerDown={(e) => {
                                                            e.preventDefault();
                                                            e.stopPropagation();
                                                            setDragState({
                                                                type: 'resize',
                                                                handle,
                                                                startX: e.clientX,
                                                                startY: e.clientY,
                                                                startBox: { ...activePage.crop.box },
                                                            });
                                                        }}
                                                        style={{
                                                            position: 'absolute',
                                                            width: 10,
                                                            height: 10,
                                                            borderRadius: '50%',
                                                            background: '#007AFF',
                                                            border: '1px solid #fff',
                                                            ...handlePosStyle(handle),
                                                        }}
                                                    />
                                                ))}
                                            </div>
                                        )}

                                        {activePage.crop.mode === 'margin' && (
                                            <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
                                                <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: `${activePage.crop.margin.top * 100}%`, background: 'rgba(0,0,0,0.25)' }} />
                                                <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: `${activePage.crop.margin.bottom * 100}%`, background: 'rgba(0,0,0,0.25)' }} />
                                                <div style={{ position: 'absolute', left: 0, top: `${activePage.crop.margin.top * 100}%`, bottom: `${activePage.crop.margin.bottom * 100}%`, width: `${activePage.crop.margin.left * 100}%`, background: 'rgba(0,0,0,0.25)' }} />
                                                <div style={{ position: 'absolute', right: 0, top: `${activePage.crop.margin.top * 100}%`, bottom: `${activePage.crop.margin.bottom * 100}%`, width: `${activePage.crop.margin.right * 100}%`, background: 'rgba(0,0,0,0.25)' }} />
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>

                        <div style={{
                            background: 'rgba(255,255,255,0.65)',
                            border: '1px solid rgba(255,255,255,0.45)',
                            borderRadius: '16px',
                            padding: '14px',
                            overflowY: 'auto',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '12px',
                        }}>
                            <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                                已选择 {selectedIds.length} 页，共 {pages.length} 页
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                                <button onClick={() => rotateSelected(90)} style={toolButtonStyle}><RotateCw size={16} /> 右转</button>
                                <button onClick={() => rotateSelected(-90)} style={toolButtonStyle}><RotateCcw size={16} /> 左转</button>
                                <button onClick={removeSelected} style={dangerButtonStyle}><Trash2 size={16} /> 删除页</button>
                                <button onClick={handleExtractSelected} disabled={processing} style={toolButtonStyle}><Scissors size={16} /> 提取页</button>
                            </div>

                            <div style={{ borderTop: '1px solid rgba(0,0,0,0.08)', paddingTop: '10px' }}>
                                <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                    <Crop size={15} /> 裁剪设置
                                </div>
                                <div style={{ display: 'flex', gap: '8px', marginBottom: '8px', flexWrap: 'wrap' }}>
                                    {(['none', 'box', 'margin'] as CropMode[]).map(mode => (
                                        <button
                                            key={mode}
                                            onClick={() => updateActiveCropMode(mode)}
                                            style={{
                                                ...chipStyle,
                                                background: activePage?.crop.mode === mode ? 'var(--primary-color)' : 'rgba(0,0,0,0.04)',
                                                color: activePage?.crop.mode === mode ? '#fff' : 'var(--text-secondary)',
                                            }}
                                        >
                                            {mode === 'none' ? '不裁剪' : mode === 'box' ? '矩形框' : '页边距'}
                                        </button>
                                    ))}
                                </div>

                                {activePage?.crop.mode === 'margin' && (
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                                        {(['top', 'right', 'bottom', 'left'] as Array<keyof CropMarginRatio>).map(key => (
                                            <label key={key} style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                                {key.toUpperCase()}
                                                <input
                                                    type="number"
                                                    min={0}
                                                    max={45}
                                                    step={1}
                                                    value={Math.round(activePage.crop.margin[key] * 100)}
                                                    onChange={(e) => updateMargin(key, (Number(e.target.value) || 0) / 100)}
                                                    style={{
                                                        border: '1px solid rgba(0,0,0,0.12)',
                                                        borderRadius: '8px',
                                                        height: '30px',
                                                        padding: '0 8px',
                                                        background: '#fff',
                                                        color: 'var(--text-primary)',
                                                        fontSize: '12px',
                                                    }}
                                                />
                                                <span style={{ color: 'var(--text-tertiary)' }}>%</span>
                                            </label>
                                        ))}
                                    </div>
                                )}

                                <button
                                    onClick={applyActiveCropToSelected}
                                    disabled={selectedIds.length <= 1}
                                    style={{ ...toolButtonStyle, width: '100%', marginTop: '8px' }}
                                >
                                    将当前裁剪应用到已选页面
                                </button>
                            </div>

                            <div style={{ borderTop: '1px solid rgba(0,0,0,0.08)', paddingTop: '10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                <label style={{ fontSize: '13px', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <input
                                        type="checkbox"
                                        checked={overwriteOriginal}
                                        onChange={(e) => setOverwriteOriginal(e.target.checked)}
                                    />
                                    覆盖原文件（默认关闭）
                                </label>
                                <button onClick={handleExportAll} disabled={processing || !pages.length} style={{ ...primaryButtonStyle }}>
                                    {processing ? '导出中...' : <><Save size={16} /> 导出编排结果</>}
                                </button>
                            </div>
                        </div>
                    </div>

                    <div style={{
                        background: 'rgba(255,255,255,0.55)',
                        border: '1px solid rgba(255,255,255,0.45)',
                        borderRadius: '16px',
                        padding: '10px',
                        overflowX: 'auto',
                        overflowY: 'hidden',
                    }}>
                        <div style={{ display: 'flex', gap: '10px', minHeight: '100%' }}>
                            {pages.map((page, index) => (
                                <div
                                    key={page.sourceIndex}
                                    draggable
                                    onDragStart={() => setDraggingIndex(index)}
                                    onDragOver={(e) => e.preventDefault()}
                                    onDrop={() => {
                                        if (draggingIndex !== null) reorderPage(draggingIndex, index);
                                        setDraggingIndex(null);
                                    }}
                                    onClick={(e) => selectPage(page.sourceIndex, e.metaKey || e.ctrlKey)}
                                    style={{
                                        width: '96px',
                                        minWidth: '96px',
                                        borderRadius: '10px',
                                        border: selectedSet.has(page.sourceIndex)
                                            ? '2px solid var(--primary-color)'
                                            : '1px solid rgba(0,0,0,0.1)',
                                        padding: '6px',
                                        cursor: 'pointer',
                                        background: selectedSet.has(page.sourceIndex) ? 'rgba(0,122,255,0.08)' : '#fff',
                                        userSelect: 'none',
                                    }}
                                >
                                    <div>
                                        {pdfDoc ? <PDFPageThumbnail pdfDoc={pdfDoc} pageNum={page.sourceIndex} scale={0.12} /> : null}
                                    </div>
                                    <div style={{ fontSize: '12px', marginTop: '6px', color: 'var(--text-secondary)' }}>
                                        页 {page.sourceIndex} · {page.rotate}°
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

const toolButtonStyle: React.CSSProperties = {
    border: '1px solid rgba(0,0,0,0.12)',
    borderRadius: '10px',
    background: 'rgba(255,255,255,0.85)',
    color: 'var(--text-secondary)',
    fontSize: '13px',
    height: '34px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px',
    cursor: 'pointer',
};

const dangerButtonStyle: React.CSSProperties = {
    ...toolButtonStyle,
    border: '1px solid rgba(255,59,48,0.25)',
    color: '#FF3B30',
};

const chipStyle: React.CSSProperties = {
    border: 'none',
    borderRadius: '8px',
    padding: '6px 10px',
    fontSize: '12px',
    cursor: 'pointer',
};

const primaryButtonStyle: React.CSSProperties = {
    border: 'none',
    borderRadius: '10px',
    padding: '10px 12px',
    background: 'linear-gradient(135deg, #007AFF 0%, #0056b3 100%)',
    color: '#fff',
    fontSize: '14px',
    fontWeight: 600,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px',
    cursor: 'pointer',
};

const emptyStateStyle: React.CSSProperties = {
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'var(--text-secondary)',
    fontSize: '14px',
};

const loadingOverlayStyle: React.CSSProperties = {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(255,255,255,0.55)',
    color: '#666',
    fontSize: '12px',
};

const handlePosStyle = (handle: ResizeHandle): React.CSSProperties => {
    switch (handle) {
        case 'nw':
            return { left: -5, top: -5, cursor: 'nwse-resize' };
        case 'ne':
            return { right: -5, top: -5, cursor: 'nesw-resize' };
        case 'sw':
            return { left: -5, bottom: -5, cursor: 'nesw-resize' };
        case 'se':
            return { right: -5, bottom: -5, cursor: 'nwse-resize' };
    }
};

export default PageArranger;

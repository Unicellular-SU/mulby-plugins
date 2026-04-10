import React, { useState, useEffect, useRef } from 'react';
import { Minimize2, Trash2, FileText, CheckCircle, AlertCircle, RefreshCcw } from 'lucide-react';
import { PDFHeader, PDFUploadArea } from '../components/SharedPDFComponents';
import { useMulby } from '../hooks/useMulby';
import { pdfService } from '../services/PDFService';
import { getInitPdfPaths } from '../utils/initPayload';

interface FileStatus {
    status: 'pending' | 'processing' | 'success' | 'error';
    progress: number;
    message?: string;
    originalSize?: number;
    compressedSize?: number;
    outputPath?: string;
}

const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

const FileItem: React.FC<{
    file: string;
    status: FileStatus;
    onRemove: () => void;
}> = ({ file, status, onRemove }) => {
    const [preview, setPreview] = useState<string | null>(null);

    useEffect(() => {
        pdfService.renderPageToDataURL(file, 1, 0.2).then(setPreview).catch(console.error);
    }, [file]);

    const getStatusColor = () => {
        switch (status.status) {
            case 'success': return '#34C759';
            case 'error': return '#FF3B30';
            case 'processing': return '#007AFF';
            default: return 'var(--text-secondary)';
        }
    };

    const renderStatusContent = () => {
        if (status.status === 'processing') {
            return (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{
                        width: '16px', height: '16px', borderRadius: '50%',
                        border: '2px solid rgba(0, 122, 255, 0.3)', borderTopColor: '#007AFF',
                        animation: 'spin 1s linear infinite'
                    }} />
                    <span>压缩中 {Math.round(status.progress * 100)}%</span>
                </div>
            );
        }
        if (status.status === 'success' && status.originalSize && status.compressedSize) {
            const savings = Math.round((1 - status.compressedSize / status.originalSize) * 100);
            return (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#34C759', fontWeight: 600 }}>
                        <CheckCircle size={14} />
                        <span>已完成</span>
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                        {formatFileSize(status.originalSize)} ➝ {formatFileSize(status.compressedSize)}
                        <span style={{ color: '#34C759', marginLeft: '6px', fontWeight: 600 }}>(-{savings}%)</span>
                    </div>
                </div>
            );
        }
        if (status.status === 'error') {
            return (
                <div style={{ color: '#FF3B30', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <AlertCircle size={14} />
                    <span>失败: {status.message}</span>
                </div>
            );
        }
        return <span>准备压缩</span>;
    };

    return (
        <div style={{
            display: 'flex',
            alignItems: 'center',
            padding: '12px 16px',
            background: 'rgba(255, 255, 255, 0.6)',
            backdropFilter: 'blur(10px)',
            marginBottom: '10px',
            borderRadius: '16px',
            gap: '16px',
            border: '1px solid rgba(255,255,255,0.4)',
            transition: 'all 0.2s ease',
        }}
            onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'translateY(-2px)';
                e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.05)';
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.85)';
            }}
            onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'none';
                e.currentTarget.style.boxShadow = 'none';
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.6)';
            }}
        >
            <div style={{
                width: '44px',
                height: '56px',
                background: '#fff',
                borderRadius: '8px',
                boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                overflow: 'hidden',
                flexShrink: 0
            }}>
                {preview ? (
                    <img src={preview} alt="Thumb" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                    <FileText size={24} color="var(--primary-color)" />
                )}
            </div>

            <div style={{ flex: 1, overflow: 'hidden' }}>
                <div style={{ fontSize: '15px', fontWeight: '600', color: 'var(--text-primary)', marginBottom: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {file.split(/[/\\]/).pop()}
                </div>
                <div style={{ fontSize: '13px', color: getStatusColor() }}>
                    {renderStatusContent()}
                </div>
            </div>

            <button onClick={(e) => { e.stopPropagation(); onRemove(); }} style={{
                border: 'none', background: 'rgba(255, 59, 48, 0.1)', borderRadius: '8px', width: '32px', height: '32px', minWidth: '32px', padding: 0,
                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
            }}><Trash2 size={16} color="#FF3B30" /></button>
            <style>{`
                @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
            `}</style>
        </div>
    );
};

const CompressPDF: React.FC = () => {
    const { dialog, notification, system, clipboard } = useMulby('pdf-tools');
    const [files, setFiles] = useState<string[]>([]);
    const [statusMap, setStatusMap] = useState<Record<string, FileStatus>>({});
    const [processing, setProcessing] = useState(false);
    const [qualityLevel, setQualityLevel] = useState<'high' | 'medium' | 'low'>('medium');
    const appliedInitRef = useRef(false);

    const addFiles = (incoming: string[]) => {
        const uniqueIncoming = incoming.filter(path => /\.pdf$/i.test(path));
        if (!uniqueIncoming.length) return;

        const existing = new Set(files);
        const appended = uniqueIncoming.filter(path => !existing.has(path));
        if (!appended.length) return;

        setFiles(prev => [...prev, ...appended]);
        setStatusMap(prev => {
            const next = { ...prev };
            appended.forEach(path => {
                next[path] = next[path] || { status: 'pending', progress: 0 };
            });
            return next;
        });
    };

    useEffect(() => {
        const applyFromInit = async (payload?: { input?: unknown; attachments?: Array<{ path?: string; name?: string }> }) => {
            if (appliedInitRef.current) return;
            const allPaths = await getInitPdfPaths(payload, clipboard.readFiles);
            if (!allPaths.length) return;
            appliedInitRef.current = true;
            addFiles(allPaths);
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
                // host not ready, ignore
            }
        })();

        return () => {
            if (typeof off === 'function') off();
        };
    }, []);

    const handleAddFiles = async () => {
        const result = await dialog.showOpenDialog({
            title: '选择 PDF 文件',
            filters: [{ name: 'PDF Files', extensions: ['pdf'] }],
            properties: ['openFile', 'multiSelections']
        });

        if (result && result.length > 0) {
            addFiles(result);
        }
    };

    const handleDroppedFiles = async (paths: string[], rawFiles: File[] = []) => {
        const pathPdfs = paths.filter(path => /\.pdf$/i.test(path));
        const tempFiles: string[] = [];

        for (const rawFile of rawFiles) {
            const isPdf = rawFile.type === 'application/pdf' || /\.pdf$/i.test(rawFile.name || '');
            if (!isPdf) continue;

            const hasPath = typeof (rawFile as File & { path?: string }).path === 'string' && Boolean((rawFile as File & { path?: string }).path);
            if (hasPath) continue;

            try {
                const bytes = new Uint8Array(await rawFile.arrayBuffer());
                const tempPath = await window.pdfApi?.saveTempFileFromDrop(rawFile.name || 'dropped.pdf', bytes);
                if (tempPath) tempFiles.push(tempPath);
            } catch {
                // ignore single file persistence failure and continue others
            }
        }

        const finalFiles = [...new Set([...pathPdfs, ...tempFiles])];
        if (!finalFiles.length) {
            notification.show('请拖入 PDF 文件', 'warning');
            return;
        }
        addFiles(finalFiles);
    };

    const handleRemoveFile = (index: number) => {
        const fileToRemove = files[index];
        const newFiles = [...files];
        newFiles.splice(index, 1);
        setFiles(newFiles);

        const newStatus = { ...statusMap };
        delete newStatus[fileToRemove];
        setStatusMap(newStatus);
    };

    const handleClearAll = () => {
        setFiles([]);
        setStatusMap({});
    };

    const getQualityValue = () => {
        switch (qualityLevel) {
            case 'high': return 0.8;
            case 'medium': return 0.6;
            case 'low': return 0.4;
            default: return 0.6;
        }
    };

    const updateFileStatus = (file: string, update: Partial<FileStatus>) => {
        setStatusMap(prev => ({
            ...prev,
            [file]: { ...prev[file], ...update }
        }));
    };

    const handleCompress = async () => {
        if (files.length === 0) return;

        // Reset previous success/error states to pending if re-running?
        // Actually usually we only process pending ones or all? 
        // Let's process all currently in list to allow re-compression with different settings.

        try {
            setProcessing(true);
            const downloadsPath = await system.getPath('downloads');
            const outputDir = downloadsPath || '.';
            const quality = getQualityValue();

            let successCount = 0;

            for (const file of files) {
                try {
                    // Update status to processing
                    updateFileStatus(file, { status: 'processing', progress: 0, message: '' });

                    // Get Original Size
                    const originalSize = await pdfService.getFileSize(file);
                    updateFileStatus(file, { originalSize });

                    // Compress
                    const outputPath = await pdfService.compressPDF(file, outputDir, quality, (progress) => { // progress callback from service
                        updateFileStatus(file, {
                            status: 'processing',
                            progress: progress.current / progress.total
                        });
                    });

                    // Get Compressed Size
                    const compressedSize = await pdfService.getFileSize(outputPath);

                    // Update Success
                    updateFileStatus(file, {
                        status: 'success',
                        progress: 1,
                        compressedSize,
                        outputPath
                    });
                    successCount++;

                } catch (e: any) {
                    console.error(`Failed to compress ${file}`, e);
                    updateFileStatus(file, { status: 'error', message: e.message });
                }
            }

            if (successCount > 0) {
                notification.show(`压缩完成！成功处理 ${successCount} 个文件`, 'success');
            } else {
                notification.show('没有文件被成功压缩', 'warning');
            }
        } catch (error: any) {
            notification.show(`压缩过程出错: ${error.message}`, 'error');
        } finally {
            setProcessing(false);
        }
    };

    return (
        <div style={{ padding: '16px', height: '100%', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <PDFHeader
                title="压缩 PDF"
                icon={<Minimize2 color="var(--primary-color)" size={28} />}
                actionButton={files.length > 0 ? {
                    label: "添加文件",
                    onClick: handleAddFiles
                } : undefined}
                secondaryAction={Object.values(statusMap).some(s => s.status === 'success') ? {
                    icon: <RefreshCcw size={16} />,
                    label: "清空列表",
                    onClick: handleClearAll
                } : undefined}
            />

            {files.length > 0 && (
                <div style={{
                    background: 'rgba(255, 255, 255, 0.5)',
                    backdropFilter: 'blur(10px)',
                    padding: '16px',
                    borderRadius: '16px',
                    border: '1px solid rgba(255,255,255,0.4)',
                    display: 'flex',
                    gap: '24px',
                    alignItems: 'center',
                    animation: 'fadeIn 0.3s ease'
                }}>
                    <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '14px' }}>压缩质量:</span>
                    <div style={{ display: 'flex', gap: '12px' }}>
                        {[
                            { id: 'high', label: '高质量 (大文件)', desc: '0.8' },
                            { id: 'medium', label: '均衡 (推荐)', desc: '0.6' },
                            { id: 'low', label: '强力压缩 (可能模糊)', desc: '0.4' }
                        ].map(opt => (
                            <button
                                key={opt.id}
                                onClick={() => setQualityLevel(opt.id as any)}
                                style={{
                                    padding: '8px 16px',
                                    borderRadius: '8px',
                                    border: qualityLevel === opt.id ? '2px solid var(--primary-color)' : '1px solid rgba(0,0,0,0.1)',
                                    background: qualityLevel === opt.id ? 'rgba(0, 122, 255, 0.1)' : 'transparent',
                                    color: qualityLevel === opt.id ? 'var(--primary-color)' : 'var(--text-secondary)',
                                    fontWeight: qualityLevel === opt.id ? 600 : 400,
                                    cursor: 'pointer',
                                    fontSize: '13px',
                                    transition: 'all 0.2s'
                                }}
                            >
                                {opt.label}
                            </button>
                        ))}
                    </div>
                    <div style={{ marginLeft: 'auto', fontSize: '12px', color: 'var(--text-tertiary)' }}>
                        注意：此模式会将页面转为图片，文字将不可复制
                    </div>
                </div>
            )}

            {files.length === 0 ? (
                <PDFUploadArea
                    onClick={handleAddFiles}
                    title="点击添加 PDF 文件"
                    onFileDrop={(paths, rawFiles) => { void handleDroppedFiles(paths, rawFiles); }}
                />
            ) : (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '16px', overflow: 'hidden' }}>
                    <div style={{ flex: 1, overflowY: 'auto', paddingRight: '4px' }}>
                        {files.map((file, index) => (
                            <FileItem
                                key={file}
                                file={file}
                                status={statusMap[file] || { status: 'pending', progress: 0 }}
                                onRemove={() => handleRemoveFile(index)}
                            />
                        ))}
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: '16px', borderTop: '1px solid rgba(0,0,0,0.05)' }}>
                        <button
                            onClick={handleCompress}
                            disabled={processing}
                            style={{
                                padding: '12px 32px',
                                background: processing ? 'rgba(0,0,0,0.05)' : 'linear-gradient(135deg, #007AFF 0%, #0056b3 100%)',
                                color: processing ? 'var(--text-secondary)' : 'white',
                                border: 'none',
                                borderRadius: '12px',
                                fontSize: '16px',
                                fontWeight: '600',
                                cursor: processing ? 'not-allowed' : 'pointer',
                                boxShadow: processing ? 'none' : '0 4px 12px rgba(0, 122, 255, 0.3)',
                                transition: 'all 0.3s ease',
                                display: 'flex', alignItems: 'center', gap: '8px'
                            }}
                        >
                            {processing ? '压缩中...' : <><Minimize2 size={20} /> 开始批量压缩</>}
                        </button>
                    </div>
                </div>
            )}
            <style>{`
                @keyframes fadeIn { from { opacity: 0; transform: translateY(-5px); } to { opacity: 1; transform: translateY(0); } }
            `}</style>
        </div>
    );
};

export default CompressPDF;

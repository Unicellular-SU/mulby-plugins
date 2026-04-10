import React, { useState, useEffect } from 'react';
import { Image as ImageIcon, Trash2, FileText, Layers } from 'lucide-react';
import { PDFHeader, PDFUploadArea } from '../components/SharedPDFComponents';
import { useMulby } from '../hooks/useMulby';
import { pdfService } from '../services/PDFService';
import '../types';

const FileItem: React.FC<{
    file: string;
    onRemove: () => void;
}> = ({ file, onRemove }) => {
    const [preview, setPreview] = useState<string | null>(null);
    const [pageCount, setPageCount] = useState<number>(0);

    useEffect(() => {
        // Load preview and page count
        pdfService.renderPageToDataURL(file, 1, 0.2).then(setPreview).catch(console.error);
        pdfService.getPageCount(file).then(setPageCount).catch(console.error);
    }, [file]);

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
            transition: 'transform 0.2s ease, box-shadow 0.2s ease',
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
                <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                    {pageCount} 页
                </div>
            </div>

            <button onClick={(e) => { e.stopPropagation(); onRemove(); }} style={{
                border: 'none', background: 'rgba(255, 59, 48, 0.1)', borderRadius: '8px', width: '32px', height: '32px', minWidth: '32px', padding: 0,
                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
            }}><Trash2 size={16} color="#FF3B30" /></button>
        </div>
    );
};

const ExtractImages: React.FC = () => {
    const { dialog, notification, system } = useMulby('pdf-tools');
    const [files, setFiles] = useState<string[]>([]);
    const [processing, setProcessing] = useState(false);

    const handleAddFiles = async () => {
        const result = await dialog.showOpenDialog({
            title: '选择 PDF 文件',
            filters: [{ name: 'PDF Files', extensions: ['pdf'] }],
            properties: ['openFile', 'multiSelections']
        });

        if (result && result.length > 0) {
            // Filter duplicates
            const newFiles = result.filter(f => !files.includes(f));
            setFiles([...files, ...newFiles]);
        }
    };

    const handleRemoveFile = (index: number) => {
        const newFiles = [...files];
        newFiles.splice(index, 1);
        setFiles(newFiles);
    };

    const handleExtract = async () => {
        if (files.length === 0) return;

        try {
            setProcessing(true);
            const downloadsPath = await system.getPath('downloads');
            const baseOutputDir = downloadsPath || '.';

            let successCount = 0;

            // Process files sequentially to avoid overwhelming the system
            for (const file of files) {
                const fileName = file.split(/[/\\]/).pop()?.replace('.pdf', '') || 'unknown';
                const outputDir = `${baseOutputDir}/${fileName}_images`;

                const outputPaths = await pdfService.extractImages(file, outputDir);
                if (outputPaths && outputPaths.length > 0) {
                    successCount++;
                }
            }

            if (successCount > 0) {
                notification.show(`成功从 ${successCount} 个文件提取图片！`, 'success');
                setFiles([]);
            } else {
                notification.show('未提取到图片', 'warning');
            }

        } catch (error: any) {
            notification.show(`提取失败: ${error.message}`, 'error');
        } finally {
            setProcessing(false);
        }
    };

    return (
        <div style={{ padding: '16px', height: '100%', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <PDFHeader
                title="提取图片"
                icon={<ImageIcon color="var(--primary-color)" size={28} />}
                actionButton={files.length > 0 ? {
                    label: "添加文件",
                    onClick: handleAddFiles
                } : undefined}
            />

            {files.length === 0 ? (
                <PDFUploadArea onClick={handleAddFiles} title="点击添加 PDF 文件" />
            ) : (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '16px', overflow: 'hidden' }}>
                    <div style={{ flex: 1, overflowY: 'auto', paddingRight: '4px' }}>
                        {files.map((file, index) => (
                            <FileItem
                                key={file}
                                file={file}
                                onRemove={() => handleRemoveFile(index)}
                            />
                        ))}
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: '16px', borderTop: '1px solid rgba(0,0,0,0.05)' }}>
                        <button
                            onClick={handleExtract}
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
                                display: 'flex', alignItems: 'center', gap: '8px',
                                minWidth: '160px',
                                justifyContent: 'center'
                            }}
                        >
                            {processing ? '提取中...' : <><Layers size={20} /> 开始批量提取</>}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ExtractImages;

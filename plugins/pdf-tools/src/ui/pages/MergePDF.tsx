import React, { useState } from 'react';
import { Combine, Trash2, FileText, ArrowUp, ArrowDown } from 'lucide-react';
import { PDFHeader, PDFUploadArea } from '../components/SharedPDFComponents';
import { useMulby } from '../hooks/useMulby';
import { pdfService } from '../services/PDFService';
import '../types';

const FileItem: React.FC<{
    file: string;
    index: number;
    total: number;
    onMove: (index: number, direction: 'up' | 'down') => void;
    onRemove: (index: number) => void;
}> = ({ file, index, total, onMove, onRemove }) => {
    const [preview, setPreview] = React.useState<string | null>(null);
    const [pageCount, setPageCount] = React.useState<number>(0);

    React.useEffect(() => {
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
            cursor: 'grab'
        }}
            onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'translateY(-2px)';
                e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.05)';
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.6)';
            }}
            onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'none';
                e.currentTarget.style.boxShadow = 'none';
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.4)';
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

            <div style={{ display: 'flex', gap: '8px' }}>
                <button onClick={(e) => { e.stopPropagation(); onMove(index, 'up'); }} disabled={index === 0} style={{
                    border: 'none', background: 'rgba(0,0,0,0.05)', borderRadius: '8px', width: '32px', height: '32px', minWidth: '32px', padding: 0,
                    cursor: index === 0 ? 'default' : 'pointer', opacity: index === 0 ? 0.3 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
                }}><ArrowUp size={16} color="var(--text-primary)" /></button>
                <button onClick={(e) => { e.stopPropagation(); onMove(index, 'down'); }} disabled={index === total - 1} style={{
                    border: 'none', background: 'rgba(0,0,0,0.05)', borderRadius: '8px', width: '32px', height: '32px', minWidth: '32px', padding: 0,
                    cursor: index === total - 1 ? 'default' : 'pointer', opacity: index === total - 1 ? 0.3 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
                }}><ArrowDown size={16} color="var(--text-primary)" /></button>
                <button onClick={(e) => { e.stopPropagation(); onRemove(index); }} style={{
                    border: 'none', background: 'rgba(255, 59, 48, 0.1)', borderRadius: '8px', width: '32px', height: '32px', minWidth: '32px', padding: 0,
                    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
                }}><Trash2 size={16} color="#FF3B30" /></button>
            </div>
        </div>
    );
};

const MergePDF: React.FC = () => {
    const { dialog, notification, system } = useMulby('pdf-tools');
    const [files, setFiles] = useState<string[]>([]);
    const [merging, setMerging] = useState(false);

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

    const handleMerge = async () => {
        if (files.length < 2) {
            notification.show('请至少选择两个文件进行合并', 'warning');
            return;
        }

        try {
            setMerging(true);
            const downloadsPath = await system.getPath('downloads');
            const outputDir = downloadsPath || '.'; // Fallback

            const outputPath = await window.pdfApi?.mergePDFs(files, outputDir);

            if (outputPath) {
                notification.show('合并成功！', 'success');
                // shell.showItemInFolder(outputPath); // Prevent hiding window
                setFiles([]); // Clear after success
            }
        } catch (error: any) {
            notification.show(`合并失败: ${error.message}`, 'error');
        } finally {
            setMerging(false);
        }
    };

    const moveFile = (index: number, direction: 'up' | 'down') => {
        if ((direction === 'up' && index === 0) || (direction === 'down' && index === files.length - 1)) return;

        const newFiles = [...files];
        const targetIndex = direction === 'up' ? index - 1 : index + 1;
        [newFiles[index], newFiles[targetIndex]] = [newFiles[targetIndex], newFiles[index]];
        setFiles(newFiles);
    };

    return (
        <div style={{ padding: '16px', height: '100%', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <PDFHeader
                title="合并 PDF"
                icon={<Combine color="var(--primary-color)" size={28} />}
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
                                index={index}
                                total={files.length}
                                onMove={moveFile}
                                onRemove={handleRemoveFile}
                            />
                        ))}
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: '16px', borderTop: '1px solid rgba(0,0,0,0.05)' }}>
                        <button
                            onClick={handleMerge}
                            disabled={merging || files.length < 2}
                            style={{
                                padding: '12px 32px',
                                background: merging || files.length < 2 ? 'rgba(0,0,0,0.05)' : 'linear-gradient(135deg, #007AFF 0%, #0056b3 100%)',
                                color: merging || files.length < 2 ? 'var(--text-secondary)' : 'white',
                                border: 'none',
                                borderRadius: '12px',
                                fontSize: '16px',
                                fontWeight: '600',
                                cursor: merging || files.length < 2 ? 'not-allowed' : 'pointer',
                                boxShadow: merging || files.length < 2 ? 'none' : '0 4px 12px rgba(0, 122, 255, 0.3)',
                                transition: 'all 0.3s ease',
                                display: 'flex', alignItems: 'center', gap: '8px'
                            }}
                        >
                            {merging ? '合并中...' : <><Combine size={20} /> 开始合并</>}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default MergePDF;


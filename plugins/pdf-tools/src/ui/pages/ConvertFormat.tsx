import React, { useState, useEffect } from 'react';
import { FileText, Presentation, Sheet, FileQuestion } from 'lucide-react';
import { useMulby } from '../hooks/useMulby';
import { pdfService } from '../services/PDFService';
import { PDFHeader, PDFUploadArea, PDFPageThumbnail } from '../components/SharedPDFComponents';
import '../types';
import { PDFInfo } from '../types';

interface ConvertFormatProps {
    type: 'word' | 'ppt' | 'excel';
}

const ConvertFormat: React.FC<ConvertFormatProps> = ({ type }) => {
    const { dialog, shell, notification, system } = useMulby('pdf-tools');
    const [file, setFile] = useState<string | null>(null);
    const [info, setInfo] = useState<PDFInfo | null>(null);
    const [pdfDoc, setPdfDoc] = useState<any>(null); // pdfjs-dist document proxy
    const [processing, setProcessing] = useState(false);

    const titles = {
        word: 'PDF 转 Word',
        ppt: 'PDF 转 PPT',
        excel: 'PDF 转 Excel'
    };

    const getIcon = () => {
        switch (type) {
            case 'word': return <FileText size={28} color="var(--primary-color)" />;
            case 'ppt': return <Presentation size={28} color="var(--primary-color)" />;
            case 'excel': return <Sheet size={28} color="var(--primary-color)" />;
            default: return <FileQuestion size={28} color="var(--primary-color)" />;
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
            setFile(filePath);

            try {
                // Get info
                const info = await window.pdfApi?.getPDFInfo(filePath);
                setInfo(info || null);

                // Load doc for preview
                const doc = await pdfService.getDocument(filePath);
                setPdfDoc(doc);
            } catch (error) {
                console.error(error);
                notification.show('读取PDF失败', 'error');
            }
        }
    };

    const handleConvert = async () => {
        if (!file) return;

        try {
            setProcessing(true);
            const downloadsPath = await system.getPath('downloads');
            const outputDir = downloadsPath || '.';

            let outputPath;
            switch (type) {
                case 'word':
                    outputPath = await pdfService.convertToWord(file, outputDir);
                    break;
                case 'ppt':
                    outputPath = await pdfService.convertToPPT(file, outputDir);
                    break;
                case 'excel':
                    outputPath = await pdfService.convertToExcel(file, outputDir);
                    break;
            }

            if (outputPath) {
                notification.show('转换成功！', 'success');
                shell.showItemInFolder(outputPath);
            }
        } catch (error: any) {
            notification.show(`转换失败: ${error.message}`, 'error');
        } finally {
            setProcessing(false);
        }
    };

    // Clean up pdfDoc when unmounting or changing file
    useEffect(() => {
        return () => {
            // If we needed to destroy the doc, pdfjs usually handles it, 
            // but good to reset state if file changes handled by setFile(null) logic if needed.
        };
    }, [file]);

    return (
        <div style={{ padding: '16px', height: '100%', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <PDFHeader
                title={titles[type]}
                icon={getIcon()}
                actionButton={file ? {
                    label: "更换文件",
                    onClick: handleSelectFile
                } : undefined}
            />

            {!file ? (
                <PDFUploadArea onClick={handleSelectFile} title="点击选择 PDF 文件" />
            ) : (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '16px', overflow: 'hidden' }}>
                    {/* Settings / Info Area */}
                    <div style={{
                        background: 'rgba(255, 255, 255, 0.6)',
                        backdropFilter: 'blur(10px)',
                        padding: '16px',
                        borderRadius: '16px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '20px',
                        border: '1px solid rgba(255,255,255,0.4)',
                        boxShadow: '0 4px 20px rgba(0,0,0,0.03)',
                        flexShrink: 0
                    }}>
                        <div style={{
                            width: '48px',
                            height: '48px',
                            background: '#fff',
                            borderRadius: '12px',
                            boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                            display: 'flex',
                            justifyContent: 'center',
                            alignItems: 'center',
                            color: 'var(--primary-color)'
                        }}>
                            {getIcon()}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{
                                fontSize: '16px',
                                fontWeight: '600',
                                marginBottom: '4px',
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis'
                            }} title={file.split(/[/\\]/).pop()}>
                                {file.split(/[/\\]/).pop()}
                            </div>
                            <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                                {info?.pageCount || 0} 页 &bull; 目标格式: {type.toUpperCase()}
                            </div>
                        </div>

                        <div style={{
                            fontSize: '13px',
                            color: 'var(--text-secondary)',
                            background: 'rgba(0,0,0,0.03)',
                            padding: '8px 12px',
                            borderRadius: '8px',
                            maxWidth: '200px',
                            flexShrink: 0
                        }}>
                            注意: 复杂版式或扫描件可能无法完美还原
                        </div>
                    </div>

                    {/* Preview Grid */}
                    <div style={{
                        flex: 1,
                        overflowY: 'auto',
                        background: 'rgba(0,0,0,0.02)',
                        borderRadius: '16px',
                        padding: '16px'
                    }}>
                        {pdfDoc ? (
                            <div style={{
                                display: 'grid',
                                gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
                                gap: '16px'
                            }}>
                                {Array.from({ length: info?.pageCount || 0 }).map((_, i) => {
                                    const pageNum = i + 1;
                                    return (
                                        <div key={i} style={{
                                            transition: 'transform 0.2s',
                                        }}
                                            onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-2px)' }}
                                            onMouseLeave={(e) => { e.currentTarget.style.transform = 'none' }}
                                        >
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
                    <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: '8px' }}>
                        <button
                            onClick={handleConvert}
                            disabled={processing}
                            style={{
                                width: '100%',
                                padding: '16px',
                                border: 'none',
                                borderRadius: '14px',
                                background: processing ? 'rgba(0,0,0,0.05)' : 'linear-gradient(135deg, #007AFF 0%, #0056b3 100%)',
                                color: processing ? 'var(--text-secondary)' : 'white',
                                fontSize: '16px',
                                fontWeight: '600',
                                cursor: processing ? 'not-allowed' : 'pointer',
                                boxShadow: processing ? 'none' : '0 8px 20px rgba(0, 122, 255, 0.3)',
                                transition: 'all 0.3s ease',
                                letterSpacing: '-0.3px',
                                flexShrink: 0
                            }}
                        >
                            {processing ? '转换中...' : '开始转换'}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ConvertFormat;

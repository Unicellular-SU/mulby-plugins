import React, { useRef, useState, useEffect } from 'react';
import { Upload, Plus } from 'lucide-react';

interface PDFHeaderProps {
    title: string;
    icon: React.ReactNode;
    actionButton?: {
        label: string;
        icon?: React.ReactNode;
        onClick: () => void;
    };
    secondaryAction?: {
        label: string;
        icon?: React.ReactNode;
        onClick: () => void;
    };
}

export const PDFHeader: React.FC<PDFHeaderProps> = ({ title, icon, actionButton, secondaryAction }) => {
    return (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ fontSize: '24px', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '12px', margin: 0 }}>
                {icon} {title}
            </h2>
            <div style={{ display: 'flex', gap: '8px' }}>
                {actionButton && (
                    <button onClick={actionButton.onClick} style={{
                        display: 'flex', alignItems: 'center', gap: '6px',
                        padding: '8px 16px', borderRadius: '12px', border: 'none',
                        background: 'var(--primary-color)', color: 'white', cursor: 'pointer', fontWeight: '500',
                        fontSize: '14px',
                        boxShadow: '0 2px 8px rgba(0, 122, 255, 0.25)'
                    }}>
                        {actionButton.icon || <Plus size={18} />} {actionButton.label}
                    </button>
                )}
                {secondaryAction && (
                    <button onClick={secondaryAction.onClick} style={{
                        display: 'flex', alignItems: 'center', gap: '6px',
                        padding: '8px 16px', borderRadius: '12px',
                        border: '1px solid rgba(0,0,0,0.1)',
                        background: 'rgba(255,255,255,0.8)',
                        color: 'var(--text-secondary)',
                        cursor: 'pointer', fontWeight: '500',
                        fontSize: '14px'
                    }}>
                        {secondaryAction.icon} {secondaryAction.label}
                    </button>
                )}
            </div>
        </div>
    );
};

interface PDFUploadAreaProps {
    onClick: () => void;
    title?: string;
    subTitle?: string;
    icon?: React.ReactNode;
    onFileDrop?: (paths: string[], rawFiles?: File[]) => void;
    compact?: boolean; // For when there is a list but we still want an upload button? Or just full page.
}

export const PDFUploadArea: React.FC<PDFUploadAreaProps> = ({
    onClick,
    title = "点击选择 PDF 文件",
    subTitle = "或将文件拖放到此处",
    icon,
    onFileDrop
}) => {
    const [isDragging, setIsDragging] = useState(false);

    const parseDroppedPathText = (raw: string): string[] => {
        if (!raw) return [];

        const lines = raw
            .split(/\r?\n/)
            .map(line => line.trim())
            .filter(Boolean)
            .filter(line => !line.startsWith('#'));

        return lines.map(line => {
            if (line.startsWith('file://')) {
                try {
                    return decodeURIComponent(line.replace(/^file:\/\//, ''));
                } catch {
                    return line.replace(/^file:\/\//, '');
                }
            }
            return line;
        });
    };

    const collectFilePaths = (event: React.DragEvent<HTMLDivElement>): string[] => {
        const dt = event.dataTransfer;
        if (!dt) return [];

        const candidates = new Set<string>();

        const fileList = dt.files;
        for (let i = 0; i < (fileList?.length || 0); i++) {
            const file = fileList[i] as File & { path?: string };
            if (typeof file.path === 'string' && file.path.length > 0) {
                candidates.add(file.path);
            }
        }

        const uriList = dt.getData('text/uri-list');
        for (const path of parseDroppedPathText(uriList)) {
            candidates.add(path);
        }

        const plainText = dt.getData('text/plain');
        for (const path of parseDroppedPathText(plainText)) {
            candidates.add(path);
        }

        return [...candidates].filter(Boolean);
    };

    const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        event.stopPropagation();
        setIsDragging(false);

        if (!onFileDrop) {
            return;
        }

        const dt = event.dataTransfer;
        const filePaths = collectFilePaths(event);
        const rawFiles = dt?.files ? Array.from(dt.files) : [];

        if (filePaths.length > 0 || rawFiles.length > 0) {
            onFileDrop(filePaths, rawFiles);
        }
    };

    return (
        <div
            onClick={onClick}
            onDragOver={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setIsDragging(true);
            }}
            onDragEnter={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setIsDragging(true);
            }}
            onDragLeave={(event) => {
                event.preventDefault();
                event.stopPropagation();
                if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
                setIsDragging(false);
            }}
            onDrop={handleDrop}
            style={{
                flex: 1,
                background: isDragging ? 'rgba(0, 122, 255, 0.06)' : 'rgba(255,255,255,0.5)',
                borderRadius: '24px',
                border: `3px dashed ${isDragging ? 'var(--primary-color)' : 'rgba(0, 122, 255, 0.2)'}`,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                transition: 'all 0.3s ease',
                boxShadow: '0 8px 32px rgba(0, 0, 0, 0.02)'
            }}
            onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(0, 122, 255, 0.03)';
                e.currentTarget.style.borderColor = 'var(--primary-color)';
                e.currentTarget.style.transform = 'scale(0.99)';
            }}
            onMouseLeave={(e) => {
                e.currentTarget.style.background = isDragging ? 'rgba(0, 122, 255, 0.06)' : 'rgba(255,255,255,0.5)';
                e.currentTarget.style.borderColor = isDragging ? 'var(--primary-color)' : 'rgba(0, 122, 255, 0.2)';
                e.currentTarget.style.transform = 'none';
            }}
        >
            <div style={{
                width: '96px',
                height: '96px',
                background: 'linear-gradient(135deg, #007AFF 0%, #0056b3 100%)',
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: '24px',
                boxShadow: '0 12px 24px rgba(0, 122, 255, 0.3)'
            }}>
                {icon || <Upload size={40} color="white" />}
            </div>
            <p style={{ fontSize: '20px', fontWeight: '600', color: 'var(--text-primary)', marginBottom: '8px' }}>{title}</p>
            <p style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>{subTitle}</p>
        </div>
    );
};

export const PDFPageThumbnail: React.FC<{
    pdfDoc: any; // Using any to avoid complex type setup in this file, ideally PDFDocumentProxy
    pageNum: number;
    scale?: number;
}> = ({ pdfDoc, pageNum, scale = 0.2 }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let mounted = true;
        const renderPage = async () => {
            if (!pdfDoc || !canvasRef.current) return;
            try {
                const page = await pdfDoc.getPage(pageNum);
                if (!mounted) return;

                const viewport = page.getViewport({ scale });
                const canvas = canvasRef.current;
                const context = canvas.getContext('2d');

                if (context) {
                    canvas.width = viewport.width;
                    canvas.height = viewport.height;

                    await page.render({
                        canvasContext: context,
                        viewport: viewport
                    }).promise;
                }
                setLoading(false);
            } catch (err) {
                console.error(`Error rendering page ${pageNum}:`, err);
            }
        };
        renderPage();
        return () => { mounted = false; };
    }, [pdfDoc, pageNum, scale]);

    return (
        <div style={{
            position: 'relative',
            borderRadius: '8px',
            overflow: 'hidden',
            boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
            background: '#fff',
            aspectRatio: '1/1.414',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
        }}>
            <canvas ref={canvasRef} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
            <div style={{
                position: 'absolute',
                bottom: '4px',
                right: '4px',
                background: 'rgba(0,0,0,0.5)',
                color: 'white',
                fontSize: '10px',
                padding: '2px 6px',
                borderRadius: '4px'
            }}>
                {pageNum}
            </div>
            {loading && (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f5f5f7' }}>
                    <div style={{ width: '16px', height: '16px', border: '2px solid rgba(0,0,0,0.1)', borderTopColor: 'var(--primary-color)', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                </div>
            )}
        </div>
    );
};

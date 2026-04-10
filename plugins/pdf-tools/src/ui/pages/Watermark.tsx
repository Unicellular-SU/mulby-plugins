import React, { useState, useEffect } from 'react';
import { Droplet, FileText, Image as ImageIcon, Type, Trash2, LayoutGrid, Maximize } from 'lucide-react';
import { useMulby } from '../hooks/useMulby';
import { pdfService } from '../services/PDFService';
import { WatermarkConfig } from '../types';
import { PDFHeader, PDFUploadArea } from '../components/SharedPDFComponents';

const Watermark: React.FC = () => {
    const { dialog, notification, system } = useMulby('pdf-tools');
    const [files, setFiles] = useState<string[]>([]);
    const [processing, setProcessing] = useState(false);
    const [preview, setPreview] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<'settings' | 'files'>('settings');

    // Layout Calculation State
    const resizeObserverRef = React.useRef<ResizeObserver | null>(null);
    const [imgNaturalSize, setImgNaturalSize] = useState<{ w: number; h: number } | null>(null);
    const [containerDimensions, setContainerDimensions] = useState({ width: 0, height: 0 });

    // Handle Container Resize via Callback Ref (handles conditional rendering)
    const onContainerRefChange = React.useCallback((node: HTMLDivElement | null) => {
        if (node) {
            // Node mounted
            resizeObserverRef.current = new ResizeObserver(entries => {
                for (const entry of entries) {
                    setContainerDimensions({
                        width: entry.contentRect.width,
                        height: entry.contentRect.height
                    });
                }
            });
            resizeObserverRef.current.observe(node);
        } else {
            // Node unmounting
            if (resizeObserverRef.current) {
                resizeObserverRef.current.disconnect();
                resizeObserverRef.current = null;
            }
        }
    }, []);

    // Handle Image Size
    useEffect(() => {
        if (!preview) {
            setImgNaturalSize(null);
            return;
        }
        const img = new Image();
        img.onload = () => {
            setImgNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
        };
        img.src = preview;
    }, [preview]);

    const getDisplaySize = () => {
        if (!imgNaturalSize || !containerDimensions.width || !containerDimensions.height) {
            return { width: 0, height: 0, valid: false };
        }

        const padding = 0.95;
        const maxW = containerDimensions.width * padding;
        const maxH = containerDimensions.height * padding;
        const ratio = imgNaturalSize.w / imgNaturalSize.h;

        let w = maxW;
        let h = w / ratio;

        if (h > maxH) {
            h = maxH;
            w = h * ratio;
        }

        return { width: w, height: h, valid: true };
    };

    const displaySize = getDisplaySize();

    // Config State
    const [config, setConfig] = useState<WatermarkConfig>({
        type: 'text',
        text: 'Confidential',
        layout: 'center',
        scale: 0.5,
        opacity: 0.5,
        rotate: 45,
        color: '#ff0000',
        fontSize: 50,
        gap: 200
    });

    const handleSelectFiles = async () => {
        const result = await dialog.showOpenDialog({
            title: '选择 PDF 文件',
            filters: [{ name: 'PDF Files', extensions: ['pdf'] }],
            properties: ['openFile', 'multiSelections']
        });

        if (result && result.length > 0) {
            setFiles(prev => [...new Set([...prev, ...result])]);
        }
    };

    const handleSelectImage = async () => {
        const result = await dialog.showOpenDialog({
            title: '选择图片水印',
            filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg'] }],
            properties: ['openFile']
        });

        if (result && result.length > 0) {
            setConfig(prev => ({ ...prev, imagePath: result[0], type: 'image' }));
        }
    };

    const removeFile = (index: number) => {
        const newFiles = [...files];
        newFiles.splice(index, 1);
        setFiles(newFiles);
    };

    // Update preview when files[0] changes
    useEffect(() => {
        if (files.length > 0) {
            pdfService.renderPageToDataURL(files[0], 1, 0.4).then(setPreview).catch(console.error);
        } else {
            setPreview(null);
        }
    }, [files]);

    const handleApply = async () => {
        if (files.length === 0) return;
        if (config.type === 'image' && !config.imagePath) {
            notification.show('请先选择水印图片', 'error');
            return;
        }

        try {
            setProcessing(true);
            const downloadsPath = await system.getPath('downloads');
            const outputDir = downloadsPath || '.';

            let count = 0;
            for (const file of files) {
                await window.pdfApi?.watermarkPDF(file, config, outputDir);
                count++;
            }

            notification.show(`成功为 ${count} 个文件添加水印！`, 'success');
        } catch (error: any) {
            console.error(error);
            notification.show(`添加水印失败: ${error.message}`, 'error');
        } finally {
            setProcessing(false);
        }
    };

    return (
        <div style={{ padding: '16px', height: '100%', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <PDFHeader
                title="PDF 水印"
                icon={<Droplet color="var(--primary-color)" size={28} />}
                actionButton={files.length > 0 ? {
                    label: "添加文件",
                    onClick: handleSelectFiles
                } : undefined}
            />

            {files.length === 0 ? (
                <PDFUploadArea onClick={handleSelectFiles} />
            ) : (
                <div style={{ flex: 1, display: 'flex', gap: '16px', overflow: 'hidden' }}>

                    {/* Left Sidebar: Controls & Files */}
                    <div style={{ width: '320px', display: 'flex', flexDirection: 'column', gap: '12px', background: 'rgba(255,255,255,0.6)', backdropFilter: 'blur(10px)', borderRadius: '16px', padding: '16px', border: '1px solid rgba(255,255,255,0.4)', overflow: 'hidden' }}>

                        {/* Tabs */}
                        <div style={{ display: 'flex', padding: '4px', background: 'rgba(118, 118, 128, 0.12)', borderRadius: '10px' }}>
                            <button
                                onClick={() => setActiveTab('settings')}
                                style={{
                                    flex: 1, padding: '6px', border: 'none', borderRadius: '8px',
                                    background: activeTab === 'settings' ? '#fff' : 'transparent',
                                    color: activeTab === 'settings' ? '#000' : 'var(--text-secondary)',
                                    fontWeight: activeTab === 'settings' ? '600' : '500',
                                    boxShadow: activeTab === 'settings' ? '0 2px 4px rgba(0,0,0,0.08)' : 'none',
                                    cursor: 'pointer', transition: 'all 0.2s', fontSize: '13px'
                                }}
                            >
                                设置
                            </button>
                            <button
                                onClick={() => setActiveTab('files')}
                                style={{
                                    flex: 1, padding: '6px', border: 'none', borderRadius: '8px',
                                    background: activeTab === 'files' ? '#fff' : 'transparent',
                                    color: activeTab === 'files' ? '#000' : 'var(--text-secondary)',
                                    fontWeight: activeTab === 'files' ? '600' : '500',
                                    boxShadow: activeTab === 'files' ? '0 2px 4px rgba(0,0,0,0.08)' : 'none',
                                    cursor: 'pointer', transition: 'all 0.2s', fontSize: '13px'
                                }}
                            >
                                文件 ({files.length})
                            </button>
                        </div>

                        {/* Content Area */}
                        <div style={{ flex: 1, overflowY: 'auto', paddingRight: '2px' }}>
                            {activeTab === 'settings' ? (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

                                    {/* Type Selection */}
                                    <div style={{ display: 'flex', gap: '12px' }}>
                                        {(['text', 'image'] as const).map(m => (
                                            <div
                                                key={m}
                                                onClick={() => setConfig({ ...config, type: m })}
                                                style={{
                                                    flex: 1, cursor: 'pointer',
                                                    border: `2px solid ${config.type === m ? 'var(--primary-color)' : 'transparent'}`,
                                                    background: config.type === m ? 'rgba(0,122,255,0.05)' : 'rgba(0,0,0,0.03)',
                                                    borderRadius: '10px', padding: '8px',
                                                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px',
                                                    transition: 'all 0.2s'
                                                }}
                                            >
                                                {m === 'text' ? <Type size={18} color={config.type === m ? 'var(--primary-color)' : '#999'} /> : <ImageIcon size={18} color={config.type === m ? 'var(--primary-color)' : '#999'} />}
                                                <span style={{ fontSize: '12px', fontWeight: '500', color: config.type === m ? 'var(--primary-color)' : '#666' }}>
                                                    {m === 'text' ? '文字' : '图片'}
                                                </span>
                                            </div>
                                        ))}
                                    </div>

                                    {/* Main Input */}
                                    {config.type === 'text' ? (
                                        <div>
                                            <label style={{ display: 'block', margin: '0 0 6px 4px', fontWeight: '600', fontSize: '12px', color: '#555' }}>内容</label>
                                            <input
                                                type="text" value={config.text}
                                                onChange={e => setConfig({ ...config, text: e.target.value })}
                                                style={{
                                                    width: '100%', padding: '10px', borderRadius: '10px', border: '1px solid #ddd',
                                                    fontSize: '14px', outline: 'none', background: '#fff'
                                                }}
                                                placeholder="输入水印文字"
                                            />
                                        </div>
                                    ) : (
                                        <div>
                                            <label style={{ display: 'block', margin: '0 0 6px 4px', fontWeight: '600', fontSize: '12px', color: '#555' }}>源文件</label>
                                            <div
                                                onClick={handleSelectImage}
                                                style={{
                                                    border: '1px dashed #ccc', borderRadius: '10px', padding: '10px',
                                                    textAlign: 'center', cursor: 'pointer', background: '#fff',
                                                    color: config.imagePath ? 'var(--primary-color)' : 'var(--text-secondary)',
                                                    fontSize: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px'
                                                }}
                                            >
                                                <ImageIcon size={14} />
                                                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>
                                                    {config.imagePath ? config.imagePath.split(/[/\\]/).pop() : '点击选择图片'}
                                                </span>
                                            </div>
                                        </div>
                                    )}

                                    {/* Layout Grid */}
                                    <div>
                                        <label style={{ display: 'block', margin: '0 0 6px 4px', fontWeight: '600', fontSize: '12px', color: '#555' }}>排列方式</label>
                                        <div style={{ display: 'flex', gap: '8px' }}>
                                            <button
                                                onClick={() => setConfig({ ...config, layout: 'center' })}
                                                style={{
                                                    flex: 1, padding: '8px', borderRadius: '10px', border: `1px solid ${config.layout === 'center' ? 'var(--primary-color)' : '#e0e0e0'}`,
                                                    background: config.layout === 'center' ? '#fff' : 'rgba(255,255,255,0.5)',
                                                    color: config.layout === 'center' ? 'var(--primary-color)' : '#666', cursor: 'pointer', fontSize: '12px',
                                                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px'
                                                }}
                                            >
                                                <Maximize size={14} /> 居中
                                            </button>
                                            <button
                                                onClick={() => setConfig({ ...config, layout: 'tile' })}
                                                style={{
                                                    flex: 1, padding: '8px', borderRadius: '10px', border: `1px solid ${config.layout === 'tile' ? 'var(--primary-color)' : '#e0e0e0'}`,
                                                    background: config.layout === 'tile' ? '#fff' : 'rgba(255,255,255,0.5)',
                                                    color: config.layout === 'tile' ? 'var(--primary-color)' : '#666', cursor: 'pointer', fontSize: '12px',
                                                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px'
                                                }}
                                            >
                                                <LayoutGrid size={14} /> 平铺
                                            </button>
                                        </div>
                                    </div>

                                    {/* Sliders Area */}
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', background: 'rgba(0,0,0,0.02)', padding: '12px', borderRadius: '12px' }}>
                                        {/* Row 1 */}
                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                                            <div>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                                                    <span style={{ fontSize: '11px', color: '#666' }}>旋转</span>
                                                    <span style={{ fontSize: '11px', fontWeight: '600' }}>{config.rotate}°</span>
                                                </div>
                                                <input type="range" min="0" max="360" value={config.rotate} onChange={e => setConfig({ ...config, rotate: parseInt(e.target.value) })} style={{ width: '100%', height: '4px', accentColor: 'var(--primary-color)' }} />
                                            </div>
                                            <div>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                                                    <span style={{ fontSize: '11px', color: '#666' }}>透明度</span>
                                                    <span style={{ fontSize: '11px', fontWeight: '600' }}>{config.opacity}</span>
                                                </div>
                                                <input type="range" min="0" max="1" step="0.1" value={config.opacity} onChange={e => setConfig({ ...config, opacity: parseFloat(e.target.value) })} style={{ width: '100%', height: '4px', accentColor: 'var(--primary-color)' }} />
                                            </div>
                                        </div>

                                        {/* Row 2 */}
                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                                            <div>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                                                    <span style={{ fontSize: '11px', color: '#666' }}>{config.type === 'image' ? '缩放' : '字号'}</span>
                                                    <span style={{ fontSize: '11px', fontWeight: '600' }}>{config.type === 'image' ? config.scale : config.fontSize}</span>
                                                </div>
                                                {config.type === 'image' ? (
                                                    <input type="range" min="0.1" max="2" step="0.1" value={config.scale || 0.5} onChange={e => setConfig({ ...config, scale: parseFloat(e.target.value) })} style={{ width: '100%', height: '4px', accentColor: 'var(--primary-color)' }} />
                                                ) : (
                                                    <input type="range" min="10" max="200" value={config.fontSize || 50} onChange={e => setConfig({ ...config, fontSize: parseInt(e.target.value) })} style={{ width: '100%', height: '4px', accentColor: 'var(--primary-color)' }} />
                                                )}
                                            </div>
                                            {config.layout === 'tile' && (
                                                <div>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                                                        <span style={{ fontSize: '11px', color: '#666' }}>间距</span>
                                                        <span style={{ fontSize: '11px', fontWeight: '600' }}>{config.gap}</span>
                                                    </div>
                                                    <input type="range" min="50" max="500" value={config.gap || 200} onChange={e => setConfig({ ...config, gap: parseInt(e.target.value) })} style={{ width: '100%', height: '4px', accentColor: 'var(--primary-color)' }} />
                                                </div>
                                            )}
                                        </div>

                                        {config.type === 'text' && (
                                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: '4px' }}>
                                                <span style={{ fontSize: '12px', color: '#666' }}>文字颜色</span>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: '#fff', padding: '4px 8px', borderRadius: '20px', border: '1px solid #eee' }}>
                                                    <input type="color" value={config.color} onChange={e => setConfig({ ...config, color: e.target.value })} style={{ width: '16px', height: '16px', border: 'none', padding: 0, background: 'transparent', cursor: 'pointer' }} />
                                                    <span style={{ fontSize: '11px', fontFamily: 'monospace' }}>{config.color}</span>
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                </div>
                            ) : (
                                // File List
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                    {files.map((f, i) => (
                                        <div key={i} style={{
                                            display: 'flex', alignItems: 'center', padding: '10px', background: 'rgba(255,255,255,0.8)', borderRadius: '10px',
                                            border: '1px solid rgba(0,0,0,0.05)', gap: '10px'
                                        }}>
                                            <FileText size={18} color="var(--primary-color)" />
                                            <div style={{ flex: 1, overflow: 'hidden' }}>
                                                <div style={{ fontSize: '13px', fontWeight: '500', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                    {f.split(/[/\\]/).pop()}
                                                </div>
                                            </div>
                                            <button onClick={() => removeFile(i)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: '4px', opacity: 0.6, transition: 'opacity 0.2s' }} onMouseEnter={e => e.currentTarget.style.opacity = '1'} onMouseLeave={e => e.currentTarget.style.opacity = '0.6'}>
                                                <Trash2 size={14} color="#FF3B30" />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Footer Button */}
                        <div style={{ paddingTop: '12px', borderTop: '1px solid rgba(0,0,0,0.05)' }}>
                            <button
                                onClick={handleApply}
                                disabled={processing || files.length === 0}
                                style={{
                                    width: '100%', padding: '12px', border: 'none', borderRadius: '12px',
                                    background: processing || files.length === 0 ? 'rgba(0,0,0,0.05)' : 'linear-gradient(135deg, #007AFF 0%, #0056b3 100%)',
                                    color: processing || files.length === 0 ? 'var(--text-secondary)' : 'white',
                                    fontSize: '15px', fontWeight: '600', cursor: processing || files.length === 0 ? 'not-allowed' : 'pointer',
                                    boxShadow: processing || files.length === 0 ? 'none' : '0 4px 12px rgba(0, 122, 255, 0.3)',
                                    transition: 'all 0.3s', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px'
                                }}
                            >
                                {processing ? (
                                    '处理中...'
                                ) : (
                                    <>
                                        <Droplet size={18} />
                                        添加水印
                                    </>
                                )}
                            </button>
                        </div>
                    </div>

                    {/* Right Main: Preview Area */}
                    <div
                        ref={onContainerRefChange}
                        style={{
                            flex: 1,
                            background: '#e0e0e0',
                            borderRadius: '16px',
                            overflow: 'hidden',
                            position: 'relative',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            boxShadow: 'inset 0 0 20px rgba(0,0,0,0.05)',
                            minHeight: '400px'
                        }}
                    >
                        {preview && imgNaturalSize ? (
                            <div style={{
                                width: displaySize.valid ? `${displaySize.width}px` : '100%',
                                height: displaySize.valid ? `${displaySize.height}px` : '100%',
                                position: 'relative',
                                boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
                                background: 'white'
                            }}>
                                <img
                                    src={preview}
                                    alt="Preview"
                                    style={{ width: '100%', height: '100%', display: 'block', objectFit: 'contain' }}
                                />

                                {/* Overlay */}
                                <div style={{
                                    position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden',
                                    display: config.layout === 'center' ? 'flex' : 'block',
                                    alignItems: 'center', justifyContent: 'center',
                                }}>
                                    {config.layout === 'tile' ? (
                                        // Refactored to match backend geometric logic exactly
                                        (() => {
                                            if (!displaySize.valid) return null;

                                            const w = displaySize.width;
                                            const h = displaySize.height;
                                            const cx = w / 2;
                                            const cy = h / 2;

                                            // Match backend scaler
                                            const realGap = config.gap || 200;
                                            const realFontSize = config.fontSize || 50;

                                            // Calculate coverage radius
                                            const radius = Math.sqrt(w * w + h * h);
                                            const count = Math.ceil(radius / realGap);

                                            // Precompute rotation
                                            // UI uses negative rotation for visual correction
                                            const rads = ((-config.rotate) * Math.PI) / 180;
                                            const cos = Math.cos(rads);
                                            const sin = Math.sin(rads);

                                            const items = [];
                                            for (let r = -count; r <= count; r++) {
                                                for (let c = -count; c <= count; c++) {
                                                    const gx = c * realGap;
                                                    const gy = r * realGap;

                                                    // Rotate
                                                    const rx = gx * cos - gy * sin;
                                                    const ry = gx * sin + gy * cos;

                                                    // Translate to center
                                                    const px = cx + rx;
                                                    const py = cy + ry;

                                                    // Bounds check (visual optim)
                                                    const margin = 200;
                                                    if (px > -margin && px < w + margin &&
                                                        py > -margin && py < h + margin) {
                                                        items.push(
                                                            <div key={`${r}-${c}`} style={{
                                                                position: 'absolute',
                                                                left: px,
                                                                top: py,
                                                                transform: `translate(-50%, -50%) rotate(${-config.rotate}deg)`,
                                                                opacity: config.opacity,
                                                                fontSize: `${realFontSize}px`,
                                                                color: config.color,
                                                                whiteSpace: 'nowrap',
                                                                pointerEvents: 'none'
                                                            }}>
                                                                {config.type === 'text' ? config.text : (
                                                                    <div style={{ width: '50px', height: '50px', background: 'rgba(0,0,0,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>IMG</div>
                                                                )}
                                                            </div>
                                                        );
                                                    }
                                                }
                                            }
                                            return <>{items}</>;
                                        })()
                                    ) : (
                                        <div style={{
                                            transform: `rotate(${-config.rotate}deg)`,
                                            opacity: config.opacity,
                                            fontSize: `${config.fontSize || 50}px`,
                                            color: config.color,
                                            whiteSpace: 'nowrap',
                                        }}>
                                            {config.type === 'text' ? config.text : (
                                                <div style={{
                                                    width: `${100 * (config.scale || 0.5)}px`, height: `${100 * (config.scale || 0.5)}px`,
                                                    background: 'rgba(0,122,255,0.3)', border: '2px dashed var(--primary-color)',
                                                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px'
                                                }}>
                                                    图片水印预览
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>

                                <div style={{ position: 'absolute', bottom: '16px', right: '16px', background: 'rgba(0,0,0,0.6)', color: 'white', fontSize: '12px', padding: '6px 12px', borderRadius: '20px', backdropFilter: 'blur(4px)' }}>
                                    预览模式
                                </div>
                            </div>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', color: '#999' }}>
                                <div style={{ width: '64px', height: '64px', borderRadius: '50%', background: 'rgba(0,0,0,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    <FileText size={32} opacity={0.5} />
                                </div>
                                <span>选择文件以预览效果</span>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default Watermark;

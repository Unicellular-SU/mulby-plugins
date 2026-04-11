import React from 'react';
import {
    Combine,
    Scissors,
    Droplet,
    Image as ImageIcon,
    FileImage,
    FileText,
    Presentation,
    Sheet,
    Minimize2,
    GalleryVerticalEnd
} from 'lucide-react';

interface SidebarProps {
    activePath: string;
    onNavigate: (path: string) => void;
}

const NAV_ITEMS = [
    { id: 'merge', icon: Combine, label: 'PDF 合并' },
    { id: 'split', icon: Scissors, label: 'PDF 拆分' },
    { id: 'arrange', icon: GalleryVerticalEnd, label: '页面编排器' },
    { id: 'compress', icon: Minimize2, label: 'PDF 压缩' },
    { id: 'watermark', icon: Droplet, label: 'PDF 水印' },
    { id: 'extract-img', icon: ImageIcon, label: '提取图片' },
    { id: 'pdf-to-img', icon: FileImage, label: 'PDF 转图片' },
    { id: 'pdf-to-word', icon: FileText, label: 'PDF 转 Word' },
    { id: 'pdf-to-ppt', icon: Presentation, label: 'PDF 转 PPT' },
    { id: 'pdf-to-excel', icon: Sheet, label: 'PDF 转 Excel' },
];

const Sidebar: React.FC<SidebarProps> = ({ activePath, onNavigate }) => {
    return (
        <aside className="glass-panel" style={{
            width: 'var(--sidebar-width)',
            height: '100%',
            borderRadius: 'var(--radius-lg)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            padding: '24px 0',
            background: 'var(--glass-bg)',
            backdropFilter: 'var(--glass-blur)',
            border: 'var(--glass-border)',
            transition: 'width 0.3s ease'
        }}>
            {/* Logo / Brand */}
            <div style={{
                marginBottom: '30px',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                width: '48px',
                height: '48px',
                background: 'linear-gradient(135deg, #007AFF 0%, #5856D6 100%)',
                borderRadius: '14px',
                boxShadow: '0 8px 16px rgba(0, 122, 255, 0.25)',
                color: 'white'
            }}>
                <span style={{ fontSize: '20px', fontWeight: 'bold' }}>P</span>
            </div>

            {/* Navigation */}
            <nav style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '16px',
                flex: 1,
                width: '100%',
                alignItems: 'center',
                overflowY: 'auto',
                paddingBottom: '16px',
                /* Custom Scrollbar Styles */
                scrollbarWidth: 'thin',
                scrollbarColor: 'rgba(0,0,0,0.2) transparent'
            }}>
                <style>{`
                    nav::-webkit-scrollbar {
                        width: 4px;
                        display: block; /* Force show */
                    }
                    nav::-webkit-scrollbar-track {
                        background: transparent;
                    }
                    nav::-webkit-scrollbar-thumb {
                        background: rgba(0, 0, 0, 0.2);
                        border-radius: 4px;
                    }
                    nav::-webkit-scrollbar-thumb:hover {
                        background: rgba(0, 0, 0, 0.3);
                    }
                `}</style>
                {NAV_ITEMS.map((item) => {
                    const Icon = item.icon;
                    const isActive = activePath === item.id;
                    return (
                        <button
                            key={item.id}
                            onClick={() => onNavigate(item.id)}
                            title={item.label}
                            style={{
                                display: 'flex',
                                justifyContent: 'center',
                                alignItems: 'center',
                                width: '48px',
                                height: '48px',
                                flexShrink: 0, /* Prevent shrinking */
                                border: 'none',
                                background: isActive ? 'var(--primary-color)' : 'transparent',
                                borderRadius: '14px',
                                color: isActive ? '#fff' : 'var(--text-secondary)',
                                cursor: 'pointer',
                                transition: 'all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1)',
                                boxShadow: isActive ? '0 4px 12px rgba(0, 122, 255, 0.3)' : 'none',
                                position: 'relative'
                            }}
                            onMouseEnter={(e) => {
                                if (!isActive) {
                                    e.currentTarget.style.background = 'rgba(0,0,0,0.05)';
                                    e.currentTarget.style.transform = 'scale(1.05)';
                                }
                            }}
                            onMouseLeave={(e) => {
                                if (!isActive) {
                                    e.currentTarget.style.background = 'transparent';
                                    e.currentTarget.style.transform = 'scale(1)';
                                }
                            }}
                        >
                            <Icon size={24} strokeWidth={isActive ? 2.5 : 2} />
                        </button>
                    );
                })}
            </nav>

            {/* Footer / Version */}
            <div style={{
                marginTop: 'auto',
                padding: '16px 0',
                color: 'var(--text-tertiary)',
                fontSize: '10px',
                textAlign: 'center'
            }}>
                v1.0
            </div>
        </aside>
    );
};

export default Sidebar;

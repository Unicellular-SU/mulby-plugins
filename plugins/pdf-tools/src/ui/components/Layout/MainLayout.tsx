import React from 'react';
import Sidebar from './Sidebar.tsx';

interface MainLayoutProps {
    children: React.ReactNode;
    activePath: string;
    onNavigate: (path: string) => void;
}

const MainLayout: React.FC<MainLayoutProps> = ({ children, activePath, onNavigate }) => {
    return (
        <div style={{
            display: 'flex',
            height: '100vh',
            width: '100vw',
            padding: '20px',
            gap: '24px',
            background: 'transparent',
            color: 'var(--text-primary)'
        }}>
            <Sidebar activePath={activePath} onNavigate={onNavigate} />
            <main className="glass-panel" style={{
                flex: 1,
                borderRadius: 'var(--radius-lg)',
                padding: '30px',
                overflowY: 'auto',
                position: 'relative',
                display: 'flex',
                flexDirection: 'column'
            }}>
                {children}
            </main>
        </div>
    );
};

export default MainLayout;

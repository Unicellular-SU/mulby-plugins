import React, { useEffect, useRef, useState } from 'react';
import MainLayout from './components/Layout/MainLayout';
import './styles/global.css';

// Pages
import MergePDF from './pages/MergePDF';
import SplitPDF from './pages/SplitPDF';
import Watermark from './pages/Watermark';
import ExtractImages from './pages/ExtractImages';
import PDFToImage from './pages/PDFToImage';
import ConvertFormat from './pages/ConvertFormat';
import CompressPDF from './pages/CompressPDF';

const App: React.FC = () => {
  const [activePath, setActivePath] = useState('merge');
  const appliedInitRef = useRef(false);

  const featureRouteMap: Record<string, string> = {
    merge: 'merge',
    split: 'split',
    compress: 'compress',
    watermark: 'watermark',
    'extract-img': 'extract-img',
    'pdf-to-img': 'pdf-to-img',
    'pdf-to-word': 'pdf-to-word',
    'pdf-to-ppt': 'pdf-to-ppt',
    'pdf-to-excel': 'pdf-to-excel',
  };

  useEffect(() => {
    const applyInitRoute = (payload?: { featureCode?: string; route?: string; input?: string; attachments?: Array<{ path?: string }> }) => {
      if (appliedInitRef.current) return;
      const hasPdf = Boolean(
        payload?.attachments?.some(item => typeof item.path === 'string' && /\.pdf$/i.test(item.path || '')) ||
        (typeof payload?.input === 'string' && /\.pdf$/i.test(payload.input))
      );

      const mappedRoute = (payload?.route && featureRouteMap[payload.route]) ||
        (payload?.featureCode && featureRouteMap[payload.featureCode]);

      if (mappedRoute) {
        setActivePath(mappedRoute);
        appliedInitRef.current = true;
        return;
      }

      if (hasPdf) {
        setActivePath('split');
        appliedInitRef.current = true;
      }
    };

    window.mulby?.onPluginInit?.((payload) => {
      applyInitRoute(payload);
    });

    void (async () => {
      try {
        const res = await window.mulby?.host?.call('pdf-tools', 'getPendingInit');
        applyInitRoute(res?.data as { featureCode?: string; route?: string; input?: string; attachments?: Array<{ path?: string }> } | undefined);
      } catch {
        // host not ready, ignore
      }
    })();
  }, []);

  const renderContent = () => {
    switch (activePath) {
      case 'merge':
        return <MergePDF />;
      case 'split':
        return <SplitPDF />;
      case 'watermark':
        return <Watermark />;
      case 'extract-img':
        return <ExtractImages />;
      case 'pdf-to-img':
        return <PDFToImage />;
      case 'pdf-to-word':
        return <ConvertFormat type="word" />;
      case 'pdf-to-ppt':
        return <ConvertFormat type="ppt" />;
      case 'pdf-to-excel':
        return <ConvertFormat type="excel" />;
      case 'compress':
        return <CompressPDF />;
      default:
        return <MergePDF />;
    }
  };

  return (
    <MainLayout activePath={activePath} onNavigate={setActivePath}>
      {renderContent()}
    </MainLayout>
  );
};

export default App;

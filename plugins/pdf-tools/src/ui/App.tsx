import React, { useState } from 'react';
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

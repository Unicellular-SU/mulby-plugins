import React from 'react';
import { useHash, parseHashParams } from './hooks/useMulby';
import Search from './pages/Search';
import Settings from './pages/Settings';
import IDEList from './pages/IDEList';
import AddIDE from './pages/AddIDE';

export default function App() {
  const hash = useHash();
  const { route, params } = parseHashParams(hash);

  let content: React.ReactNode;

  switch (route) {
    case 'search':
      content = <Search code={params.code || ''} />;
      break;
    case 'settings':
      content = <Settings code={params.code || ''} />;
      break;
    case 'ide-list':
      content = <IDEList />;
      break;
    case 'add-ide':
      content = <AddIDE />;
      break;
    default:
      content = <IDEList />;
  }

  return <div className="app-container">{content}</div>;
}

import React from 'react';
import ReactDOM from 'react-dom/client';
import { MangaApp, setTheme } from '@mulby-plugins/manga-core';
import horrorTheme from './theme';
import './index.css';

// 题材即数据：注入 horror 主题后渲染共享引擎（packages/manga-core）
setTheme(horrorTheme);

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <MangaApp />
  </React.StrictMode>
);

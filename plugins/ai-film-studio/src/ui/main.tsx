import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@xyflow/react/dist/style.css'
import App from './App'
import './styles.css'
// Toonflow 式重构 · 阶段1：Skill 系统（按需在此暴露调试入口，确保技能 .md 被打包）
import { listArtStyles, listSkills } from './services/skillSystem'
;(window as unknown as { __afsSkills?: unknown }).__afsSkills = { styles: listArtStyles(), count: listSkills().length }

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import AiView from './AiView'
import './styles.css'

/** 读取启动模式（兼容 search 与 hash 两种查询位置）。 */
function getLaunchMode(): string {
  const fromSearch = new URLSearchParams(window.location.search).get('mode')
  if (fromSearch) return fromSearch
  const hashQuery = window.location.hash.indexOf('?')
  if (hashQuery >= 0) {
    return new URLSearchParams(window.location.hash.slice(hashQuery + 1)).get('mode') ?? ''
  }
  return ''
}

const isAiWindow = getLaunchMode() === 'ai'

createRoot(document.getElementById('root')!).render(
  <StrictMode>{isAiWindow ? <AiView /> : <App />}</StrictMode>
)

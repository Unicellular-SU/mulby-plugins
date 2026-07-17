import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import AiView from './AiView'
import PinView from './PinView'
import './styles.css'
import { readLaunchQueryParam } from './utils/launch'

const launchMode = readLaunchQueryParam('mode') ?? ''

createRoot(document.getElementById('root')!).render(
  <StrictMode>{launchMode === 'ai' ? <AiView /> : launchMode === 'pin' ? <PinView /> : <App />}</StrictMode>
)

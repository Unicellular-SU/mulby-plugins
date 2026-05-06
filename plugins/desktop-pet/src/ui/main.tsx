import React from 'react'
import ReactDOM from 'react-dom/client'
import './styles.css'

const params = new URLSearchParams(window.location.search)
const view = params.get('view')

function Root() {
  if (view === 'settings') {
    const SettingsView = React.lazy(() => import('./settings/SettingsView'))
    return <React.Suspense fallback={null}><SettingsView /></React.Suspense>
  }
  if (view === 'bubble') {
    const BubbleView = React.lazy(() => import('./BubbleView'))
    return <React.Suspense fallback={null}><BubbleView /></React.Suspense>
  }
  if (view === 'chat-input') {
    const ChatInputView = React.lazy(() => import('./ChatInputView'))
    return <React.Suspense fallback={null}><ChatInputView /></React.Suspense>
  }
  if (view === 'bubble-popup') {
    const BubblePopupView = React.lazy(() => import('./BubblePopupView'))
    return <React.Suspense fallback={null}><BubblePopupView /></React.Suspense>
  }
  if (view === 'bubble-overlay') {
    const BubbleOverlayView = React.lazy(() => import('./BubbleOverlayView'))
    return <React.Suspense fallback={null}><BubbleOverlayView /></React.Suspense>
  }
  const PetView = React.lazy(() => import('./PetView'))
  return <React.Suspense fallback={null}><PetView /></React.Suspense>
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
)

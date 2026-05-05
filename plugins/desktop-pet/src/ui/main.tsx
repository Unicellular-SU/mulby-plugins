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
  const PetView = React.lazy(() => import('./PetView'))
  return <React.Suspense fallback={null}><PetView /></React.Suspense>
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
)

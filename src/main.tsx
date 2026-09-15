import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App.tsx'
import { setServiceWorkerRegistration, watchForegroundUpdates } from './lib/appUpdate'

// Installed copies update themselves once a check finds a new build; iOS does not
// reliably run one on relaunch, so foreground returns trigger it too.
registerSW({
  immediate: true,
  onRegisteredSW: (_url, registration) => {
    setServiceWorkerRegistration(registration)
    watchForegroundUpdates()
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

if (typeof window !== 'undefined') {
  const { protocol, port, pathname, search, hash } = window.location
  const hostname = window.location.hostname
  if (hostname === '127.0.0.1' || hostname === '0.0.0.0') {
    const target = `${protocol}//localhost${port ? `:${port}` : ''}${pathname}${search}${hash}`
    window.location.replace(target)
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

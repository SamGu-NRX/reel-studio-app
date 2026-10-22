import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import { App } from './App'
import { titlebarHeight } from '../../shared/chrome'

document.documentElement.style.setProperty('--titlebar', `${titlebarHeight(/Mac/.test(navigator.platform) ? 'darwin' : 'win32')}px`)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)

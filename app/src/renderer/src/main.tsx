import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import { App } from './App'
import { TITLEBAR_HEIGHT } from '../../shared/chrome'

document.documentElement.style.setProperty('--titlebar', `${TITLEBAR_HEIGHT}px`)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)

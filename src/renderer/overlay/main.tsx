import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Palette } from './Palette'
import { Peek } from './Peek'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Peek />
    <Palette />
  </StrictMode>
)

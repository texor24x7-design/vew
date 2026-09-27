import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Palette } from './Palette'
import { Peek } from './Peek'
import { FindBar } from './FindBar'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <FindBar />
    <Peek />
    <Palette />
  </StrictMode>
)

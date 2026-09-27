import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Palette } from './Palette'
import { Peek } from './Peek'
import { FindBar } from './FindBar'
import { PopupCatcher } from './PopupCatcher'
import { Label } from './Label'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Label />
    <PopupCatcher />
    <FindBar />
    <Peek />
    <Palette />
  </StrictMode>
)

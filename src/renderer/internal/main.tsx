import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HistoryPage } from './History'
import { SettingsPage } from './Settings'
import './index.css'

const page = location.host === 'settings' ? <SettingsPage /> : <HistoryPage />
document.title = location.host === 'settings' ? 'Settings' : 'History'

createRoot(document.getElementById('root')!).render(<StrictMode>{page}</StrictMode>)

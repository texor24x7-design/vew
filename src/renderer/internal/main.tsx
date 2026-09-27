import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HistoryPage } from './History'
import { SettingsPage } from './Settings'
import { WelcomePage } from './Welcome'
import './index.css'

const pages: Record<string, [string, React.JSX.Element]> = {
  settings: ['Settings', <SettingsPage key="s" />],
  welcome: ['Welcome to Vew', <WelcomePage key="w" />],
  history: ['History', <HistoryPage key="h" />]
}
const [title, page] = pages[location.host] ?? pages.history
document.title = title

createRoot(document.getElementById('root')!).render(<StrictMode>{page}</StrictMode>)

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../styles.css'
import { DashboardIsland } from './DashboardIsland'

const el = document.getElementById('dashboard-root')
if (el) {
  createRoot(el).render(
    <StrictMode>
      <DashboardIsland />
    </StrictMode>,
  )
}

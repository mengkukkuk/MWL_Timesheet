import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../styles.css'
import { DashboardIsland } from './DashboardIsland'
import { ExportControls } from './ExportControls'
import { TeamOverviewIsland } from './TeamOverviewIsland'

const el = document.getElementById('dashboard-root')
if (el) {
  createRoot(el).render(
    <StrictMode>
      <DashboardIsland />
    </StrictMode>,
  )
}

// PR4: the export buttons + month/bulk modals are now React (ExportControls),
// mounted at a dedicated node above #dashboard-root inside #dashboard-content.
const exportEl = document.getElementById('export-controls-root')
if (exportEl) {
  createRoot(exportEl).render(
    <StrictMode>
      <ExportControls />
    </StrictMode>,
  )
}

// Team Overview grid — the vanilla shell toggles #overall-dashboard visibility;
// this root owns the cards inside it.
const teamEl = document.getElementById('overall-member-grid')
if (teamEl) {
  createRoot(teamEl).render(
    <StrictMode>
      <TeamOverviewIsland />
    </StrictMode>,
  )
}

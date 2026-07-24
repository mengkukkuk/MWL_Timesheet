import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../styles.css'
import { WorklogIsland } from './WorklogIsland'

const el = document.getElementById('worklog-view-root')
if (el) {
  createRoot(el).render(
    <StrictMode>
      <WorklogIsland />
    </StrictMode>,
  )
}
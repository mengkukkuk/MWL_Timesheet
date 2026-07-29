import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import '../styles.css'
import { queryClient } from '../queryClient'
import { ProjectsSummaryIsland } from './ProjectsSummaryIsland'

// Separate Vite entry / React root (#projects-summary-root inside the SPA shell's
// #view-projects-summary), so it needs its own QueryClientProvider wired to the
// shared singleton in ../queryClient.
const el = document.getElementById('projects-summary-root')
if (el) {
  createRoot(el).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <ProjectsSummaryIsland />
      </QueryClientProvider>
    </StrictMode>,
  )
}

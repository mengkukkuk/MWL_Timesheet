import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import '../styles.css'
import { queryClient } from '../queryClient'
import { WorklogIsland } from './WorklogIsland'

// This island is a SEPARATE Vite entry / React root (#worklog-view-root), so
// it can't inherit a provider from the app shell root — it needs its own
// QueryClientProvider wired to the shared singleton in ../queryClient.
const el = document.getElementById('worklog-view-root')
if (el) {
  createRoot(el).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <WorklogIsland />
      </QueryClientProvider>
    </StrictMode>,
  )
}
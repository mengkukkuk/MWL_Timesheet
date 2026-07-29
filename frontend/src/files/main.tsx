import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import '../styles.css'
import { queryClient } from '../queryClient'
import { FilesIsland } from './FilesIsland'

// Separate Vite entry / React root (#files-root inside the SPA shell's
// #view-files), so it needs its own QueryClientProvider wired to the shared
// singleton in ../queryClient.
const el = document.getElementById('files-root')
if (el) {
  createRoot(el).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <FilesIsland />
      </QueryClientProvider>
    </StrictMode>,
  )
}

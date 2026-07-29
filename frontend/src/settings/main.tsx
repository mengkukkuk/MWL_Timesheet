import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import '../styles.css'
import { queryClient } from '../queryClient'
import { SettingsIsland } from './SettingsIsland'

// Separate Vite entry / React root (#settings-root inside the SPA shell's
// #view-settings), so it needs its own QueryClientProvider wired to the
// shared singleton in ../queryClient.
const el = document.getElementById('settings-root')
if (el) {
  createRoot(el).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <SettingsIsland />
      </QueryClientProvider>
    </StrictMode>,
  )
}

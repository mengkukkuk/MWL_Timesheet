// Entry point for the SPA, mounted into #root in templates/app.html.
// Full-teardown cutover: router.tsx renders <AppShell>, the single React tree
// that owns the nav, selector bar, tab switching, and every tab island. There
// is no more vanilla showTab/LegacyRoute bridge.
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from 'react-router'
import './styles.css'
import { queryClient } from './queryClient'
import { router } from './router'

declare global {
  interface Window {
    mwlNavigate?: (tab: string, opts?: { replace?: boolean }) => void
  }
}

// Exposed for the vanilla shell: nav buttons/cross-links in templates/app.html
// call onclick="mwlNavigate('worklog')" instead of the old showTab(...) so
// URL/history stay in sync with the visible tab (see router.tsx).
window.mwlNavigate = (tab, opts) => {
  void router.navigate(
    { pathname: '/' + tab, search: window.location.search },
    { replace: opts?.replace ?? false },
  )
}

const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('#root element not found')

createRoot(rootEl).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
)

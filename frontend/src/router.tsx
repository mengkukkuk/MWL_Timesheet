// react-router route table for the SPA shell. Navigation and the browser
// URL are now real (PR1 cutover) — each tab has its own path, driven through
// <LegacyRoute>, which hands the tab name to the existing vanilla
// showTab(name) (static/app/core.js). Member/year context lives in
// `?member=&y=` search params, synced to/from #member-select / #year-select
// by useLegacyContextSync() (see src/lib/legacyBridge.ts).
//
// Tab *internals* still migrate to React one PR at a time (PR2-PR9) — this
// file only makes routing/URL state real; it does not change what renders
// inside any tab.
import { createBrowserRouter, Outlet, redirect } from 'react-router'
import { LegacyRoute } from './components/LegacyRoute'
import { useLegacyContextSync } from './lib/legacyBridge'

const TAB_NAMES = ['dashboard', 'worklog', 'allowance', 'files', 'projects-summary', 'settings'] as const

// Mirrors core.js's own lastTab fallback logic (static/app/core.js
// initializeApp()) so a cold load and the router agree on the default path.
function defaultTabPath(): string {
  const last = localStorage.getItem('lastTab')
  const isKnownTab = (TAB_NAMES as readonly string[]).includes(last ?? '')
  return '/' + (isKnownTab ? (last as string) : 'dashboard')
}

function RootLayout() {
  useLegacyContextSync()
  return <Outlet />
}

export const router = createBrowserRouter([
  {
    path: '/',
    element: <RootLayout />,
    children: [
      { index: true, loader: () => redirect(defaultTabPath()) },
      ...TAB_NAMES.map((tab) => ({ path: tab, element: <LegacyRoute tab={tab} /> })),
      { path: '*', loader: () => redirect(defaultTabPath()) },
    ],
  },
])

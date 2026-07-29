// react-router route table for the SPA shell. Full-teardown cutover: the whole
// app is now a single React tree rooted at <AppShell>, which owns the top nav,
// member/year selector bar, tab switching, and all tab islands (see
// src/shell/AppShell.tsx). There is no more LegacyRoute/showTab bridge or
// vanilla legacyBridge sync — AppShell reads the URL path as the active tab and
// `?member=&y=` search params as the shared context (via useShellState).
//
// A single catch-all route renders AppShell for every path; index/unknown
// paths redirect to the last-visited tab.
import { createBrowserRouter, redirect } from 'react-router'
import { AppShell } from './shell/AppShell'

const TAB_NAMES = ['dashboard', 'worklog', 'allowance', 'files', 'projects-summary', 'settings'] as const

// A cold load at "/" or an unknown path resolves to the last-visited tab
// (persisted in localStorage) or the dashboard.
function defaultTabPath(): string {
  const last = localStorage.getItem('lastTab')
  const isKnownTab = (TAB_NAMES as readonly string[]).includes(last ?? '')
  return '/' + (isKnownTab ? (last as string) : 'dashboard')
}

export const router = createBrowserRouter([
  { index: true, loader: () => redirect(defaultTabPath()) },
  ...TAB_NAMES.map((tab) => ({ path: tab, element: <AppShell /> })),
  { path: '*', loader: () => redirect(defaultTabPath()) },
])

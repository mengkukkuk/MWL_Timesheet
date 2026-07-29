// Single shared TanStack Query client for the SPA. Replaces static/app/core.js's
// cachedApi() Map + invalidateCache() + the window.__mwlWorklogs /
// 'mwl:worklogs' CustomEvent stash (see plan: Data layer decision).
//
// Per-query staleTime is set at the useQuery call site; the tiers are:
//   ['me']                         10m  — current user identity, shared across ~11 call sites
//   ['employees']                  10m  — near-static HR directory
//   ['projects']                   10m  — near-static
//   ['worklogs', member, y, m]     30s
//   ['dashboard', member, y, m]    30s
//   ['holidays', y, m]             Infinity — fixed calendar data
//   ['projects-summary', y, m]     60s
//   ['files', folderId]            60s
import { QueryClient } from '@tanstack/react-query'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})

// Data layer for the Work Log tab: the single fetcher for /api/worklogs +
// /api/holidays, via TanStack Query.
//
// The context (member/year/month) is passed in by the caller — AppShell owns it
// as URL search params (?member=&y=&m=) in useShellState and threads it down as
// props. It is deliberately NOT read back off the #member-select/#month-select
// DOM nodes: those are React-controlled, so their .value lags behind state
// (empty until /api/members resolves) and React never fires a `change` event
// when it updates them, which left the island permanently blank.
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { api } from '../lib'
import type { Holiday, Worklog, WorklogsPayload } from './types'

export interface WorklogContext {
  member: string
  year: number
  month: number
}

// Row shape from GET /api/description (app/projects.py#_load_projects_description).
export interface ProjectDescription {
  Projectcode: string
  Description: string
  ProjectDepartment: string
  Status: string
}

export function worklogsQueryKey(ctx: WorklogContext): [string, string, number, number] {
  return ['worklogs', ctx.member, ctx.year, ctx.month]
}

async function fetchWorklogs(ctx: WorklogContext): Promise<WorklogsPayload> {
  const qs = `member_id=${encodeURIComponent(ctx.member)}&year=${ctx.year}&month=${ctx.month}`
  const [wl, hol] = await Promise.all([
    api<Worklog[]>(`/api/worklogs?${qs}`),
    api<Holiday[]>(`/api/holidays?${qs}`),
  ])
  return {
    worklogs: Array.isArray(wl.data) ? wl.data : [],
    holidays: Array.isArray(hol.data) ? hol.data : [],
    year: ctx.year,
    month: ctx.month,
  }
}

export function useWorklogsData(ctx: WorklogContext) {
  return useQuery({
    queryKey: worklogsQueryKey(ctx),
    queryFn: () => fetchWorklogs(ctx),
    enabled: !!ctx.member,
    staleTime: 30_000,
    // Keep the previous month's rows on screen while the next month loads,
    // instead of flashing an empty table on every month change.
    placeholderData: keepPreviousData,
  })
}

export function useDescriptions() {
  return useQuery({
    queryKey: ['descriptions'],
    queryFn: async () => {
      const r = await api<ProjectDescription[]>('/api/description')
      return Array.isArray(r.data) ? r.data : []
    },
    staleTime: 10 * 60_000,
  })
}
